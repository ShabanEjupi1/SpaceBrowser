/**
 * Space Browser – Inference Engine Implementation
 * ------------------------------------------------
 * This file implements the InferenceEngine class using llama.cpp.
 *
 * Build dependency: llama.cpp must be cloned into native/include/llama.cpp/
 * and the following source files must be compiled:
 *   native/include/llama.cpp/llama.cpp
 *   native/include/llama.cpp/ggml.c
 *   native/include/llama.cpp/ggml-alloc.c
 *   native/include/llama.cpp/ggml-backend.cpp
 *   native/include/llama.cpp/ggml-quants.c
 *   native/include/llama.cpp/unicode.cpp
 */

#include "../include/inference_engine.h"
#include "../include/sampler.h"

// llama.cpp public header – new layout: native/include/llama.cpp/include/llama.h
#include "llama.cpp/include/llama.h"

#include <iostream>
#include <sstream>
#include <algorithm>
#include <cassert>
#include <cstring>
#include <stdexcept>

// ── JSON helper (single-header, vendored) ────────────────────────────────────
#include "nlohmann/json.hpp"
using json = nlohmann::json;

namespace space {

// ─────────────────────────────────────────────────────────────────────────────
// Constructor / Destructor
// ─────────────────────────────────────────────────────────────────────────────

InferenceEngine::InferenceEngine() {
    // Initialize llama backend once per process
    llama_backend_init();
    log_system_info();
}

InferenceEngine::~InferenceEngine() {
    unload_model();
    llama_backend_free();
}

// ─────────────────────────────────────────────────────────────────────────────
// Model Loading
// ─────────────────────────────────────────────────────────────────────────────

bool InferenceEngine::load_model(const std::string& model_path, const GenerationParams& params) {
    std::lock_guard<std::mutex> lock(m_inference_mutex);

    // Unload any previously loaded model
    if (m_model) {
        unload_model();
    }

    llama_model_params mparams = llama_model_default_params();
    mparams.n_gpu_layers = params.n_gpu_layers;
    mparams.use_mmap     = true;
    mparams.use_mlock    = false;

    m_model = llama_model_load_from_file(model_path.c_str(), mparams);
    if (!m_model) {
        std::cerr << "[Space::InferenceEngine] Failed to load model: " << model_path << "\n";
        return false;
    }

    llama_context_params cparams = llama_context_default_params();
    cparams.n_ctx     = static_cast<uint32_t>(params.n_ctx);
    cparams.n_threads = (params.n_threads == -1)
                          ? static_cast<int>(std::thread::hardware_concurrency())
                          : params.n_threads;
    cparams.n_threads_batch = cparams.n_threads;
    cparams.flash_attn_type = LLAMA_FLASH_ATTN_TYPE_AUTO; // Enable Flash Attention when supported

    m_ctx = llama_init_from_model(m_model, cparams);
    if (!m_ctx) {
        std::cerr << "[Space::InferenceEngine] Failed to create context\n";
        llama_model_free(m_model);
        m_model = nullptr;
        return false;
    }

    m_model_path = model_path;
    std::cout << "[Space::InferenceEngine] Loaded: " << model_path
              << " | ctx=" << params.n_ctx
              << " | threads=" << cparams.n_threads
              << " | gpu_layers=" << params.n_gpu_layers << "\n";
    return true;
}

void InferenceEngine::unload_model() {
    if (m_ctx) {
        llama_free(m_ctx);
        m_ctx = nullptr;
    }
    if (m_model) {
        llama_model_free(m_model);
        m_model = nullptr;
    }
    m_model_path.clear();
}

bool InferenceEngine::is_loaded() const {
    return m_model != nullptr && m_ctx != nullptr;
}

std::string InferenceEngine::get_model_path() const {
    return m_model_path;
}

// ─────────────────────────────────────────────────────────────────────────────
// Generation
// ─────────────────────────────────────────────────────────────────────────────

bool InferenceEngine::generate(
    const std::string&      prompt,
    const GenerationParams& params,
    TokenCallback           token_cb
) {
    std::lock_guard<std::mutex> lock(m_inference_mutex);

    if (!is_loaded()) {
        std::cerr << "[Space::InferenceEngine] No model loaded\n";
        return false;
    }

    m_abort_flag.store(false);

    // Tokenize the prompt
    auto tokens = tokenize(prompt, /*add_bos=*/true);
    if (tokens.empty()) {
        return false;
    }

    // Trim to context window
    const int n_ctx = static_cast<int>(llama_n_ctx(m_ctx));
    const int max_prompt_tokens = n_ctx - params.n_predict - 4;
    if (static_cast<int>(tokens.size()) > max_prompt_tokens) {
        tokens.erase(tokens.begin(), tokens.begin() + (tokens.size() - max_prompt_tokens));
    }

    // Clear memory/KV cache
    llama_memory_clear(llama_get_memory(m_ctx), /*data=*/false);

    // Evaluate prompt tokens in batches
    int n_past = 0;
    const int batch_size = 512;
    for (int i = 0; i < static_cast<int>(tokens.size()); i += batch_size) {
        const int end = std::min(i + batch_size, static_cast<int>(tokens.size()));
        std::vector<int> batch(tokens.begin() + i, tokens.begin() + end);
        if (!eval_tokens(batch, n_past)) {
            return false;
        }
        n_past += static_cast<int>(batch.size());
    }

    // Generate tokens
    const llama_token eos_token = llama_vocab_eos(llama_model_get_vocab(m_model));
    const llama_token nl_token  = llama_vocab_nl (llama_model_get_vocab(m_model));
    (void)nl_token;

    std::vector<int> recent_tokens(tokens.begin(), tokens.end());
    std::string      generated_text;

    SamplerConfig sampler_cfg;
    sampler_cfg.temperature       = params.temperature;
    sampler_cfg.top_p             = params.top_p;
    sampler_cfg.top_k             = params.top_k;
    sampler_cfg.repeat_penalty    = params.repeat_penalty;
    sampler_cfg.presence_penalty  = params.presence_penalty;
    sampler_cfg.frequency_penalty = params.frequency_penalty;

    for (int i = 0; i < params.n_predict; ++i) {
        if (m_abort_flag.load()) {
            token_cb("", /*is_final=*/true);
            return true;
        }

        // Get logits from the context
        float* logits_ptr = llama_get_logits(m_ctx);
        const int vocab_size = llama_vocab_n_tokens(llama_model_get_vocab(m_model));
        std::vector<float> logits(logits_ptr, logits_ptr + vocab_size);

        // Sample next token
        int next_token = sample_token(logits, recent_tokens, sampler_cfg, static_cast<int>(eos_token));

        // Check for EOS
        if (next_token == static_cast<int>(eos_token)) {
            break;
        }

        // Decode token to string
        std::string piece = token_to_piece(next_token);
        generated_text += piece;
        recent_tokens.push_back(next_token);
        if (static_cast<int>(recent_tokens.size()) > sampler_cfg.repeat_last_n + 64) {
            recent_tokens.erase(recent_tokens.begin());
        }

        // Check stop sequences
        bool should_stop = false;
        if (!params.stop_token.empty() && generated_text.find(params.stop_token) != std::string::npos) {
            should_stop = true;
        }
        for (const auto& stop : params.stop_sequences) {
            if (!stop.empty() && generated_text.find(stop) != std::string::npos) {
                should_stop = true;
                break;
            }
        }

        // Stream the token
        if (params.stream) {
            bool cont = token_cb(piece, /*is_final=*/false);
            if (!cont || should_stop) break;
        }

        if (should_stop) break;

        // Evaluate next token
        std::vector<int> next_tokens = {next_token};
        if (!eval_tokens(next_tokens, n_past)) break;
        n_past++;
    }

    if (params.stream) {
        token_cb("", /*is_final=*/true);
    } else {
        token_cb(generated_text, /*is_final=*/true);
    }

    return true;
}

bool InferenceEngine::chat(
    const std::vector<ChatMessage>& messages,
    const GenerationParams&         params,
    TokenCallback                   token_cb
) {
    const std::string prompt = apply_chat_template(messages);
    return generate(prompt, params, token_cb);
}

// ─────────────────────────────────────────────────────────────────────────────
// Abort
// ─────────────────────────────────────────────────────────────────────────────

void InferenceEngine::abort() {
    m_abort_flag.store(true);
}

// ─────────────────────────────────────────────────────────────────────────────
// Metadata
// ─────────────────────────────────────────────────────────────────────────────

std::string InferenceEngine::get_model_metadata_json() const {
    if (!is_loaded()) return "{}";

    json meta;
    meta["n_vocab"]   = llama_vocab_n_tokens(llama_model_get_vocab(m_model));
    meta["n_ctx"]     = llama_n_ctx(m_ctx);
    meta["n_embd"]    = llama_model_n_embd(m_model);

    // llama.cpp model metadata key-value iteration
    const int n_meta = llama_model_meta_count(m_model);
    for (int i = 0; i < n_meta; ++i) {
        char key_buf[256]  = {};
        char val_buf[4096] = {};
        llama_model_meta_key_by_index(m_model, i, key_buf, sizeof(key_buf));
        llama_model_meta_val_str_by_index(m_model, i, val_buf, sizeof(val_buf));
        // Use last component of dotted key as JSON key
        std::string key(key_buf);
        auto dot = key.rfind('.');
        if (dot != std::string::npos) key = key.substr(dot + 1);
        meta[key] = std::string(val_buf);
    }

    return meta.dump(2);
}

int InferenceEngine::count_tokens(const std::string& text) const {
    if (!is_loaded()) return 0;
    return static_cast<int>(tokenize(text, false).size());
}

// ─────────────────────────────────────────────────────────────────────────────
// Private Helpers
// ─────────────────────────────────────────────────────────────────────────────

std::string InferenceEngine::apply_chat_template(const std::vector<ChatMessage>& messages) const {
    // Use llama.cpp's built-in chat template support (from the model's metadata)
    std::vector<llama_chat_message> llama_messages;
    llama_messages.reserve(messages.size());
    for (const auto& m : messages) {
        llama_messages.push_back({m.role.c_str(), m.content.c_str()});
    }

    // Try to use the model's embedded chat template
    std::vector<char> buf(32768);
    // Retrieve the model's embedded chat template (if any)
    char tmpl_buf[4096] = {};
    int tmpl_len = llama_model_meta_val_str(m_model, "tokenizer.chat_template", tmpl_buf, sizeof(tmpl_buf));
    const char* tmpl_ptr = (tmpl_len > 0) ? tmpl_buf : nullptr;

    int actual = llama_chat_apply_template(
        tmpl_ptr,
        llama_messages.data(),
        llama_messages.size(),
        /*add_ass=*/true,
        buf.data(),
        static_cast<int>(buf.size())
    );

    if (actual > 0 && actual < static_cast<int>(buf.size())) {
        return std::string(buf.data(), actual);
    }

    // Fallback: manually build a ChatML prompt
    std::ostringstream ss;
    for (const auto& m : messages) {
        ss << "<|im_start|>" << m.role << "\n" << m.content << "<|im_end|>\n";
    }
    ss << "<|im_start|>assistant\n";
    return ss.str();
}

std::vector<int> InferenceEngine::tokenize(const std::string& text, bool add_bos) const {
    const int n_tokens_max = static_cast<int>(text.size()) + (add_bos ? 4 : 0) + 64;
    std::vector<llama_token> tokens(n_tokens_max);
    const llama_vocab* vocab = llama_model_get_vocab(m_model);
    int n = llama_tokenize(
        vocab,
        text.c_str(),
        static_cast<int>(text.size()),
        tokens.data(),
        n_tokens_max,
        add_bos,
        /*special=*/true
    );
    if (n < 0) {
        // Buffer too small – retry with exact size
        tokens.resize(-n);
        n = llama_tokenize(
            vocab,
            text.c_str(),
            static_cast<int>(text.size()),
            tokens.data(),
            static_cast<int>(tokens.size()),
            add_bos,
            /*special=*/true
        );
    }
    tokens.resize(std::max(0, n));
    return std::vector<int>(tokens.begin(), tokens.end());
}

std::string InferenceEngine::token_to_piece(int token) const {
    std::vector<char> buf(64);
    const llama_vocab* vocab = llama_model_get_vocab(m_model);
    int n = llama_token_to_piece(vocab, token, buf.data(), static_cast<int>(buf.size()), 0, true);
    if (n < 0) {
        buf.resize(-n);
        n = llama_token_to_piece(vocab, token, buf.data(), static_cast<int>(buf.size()), 0, true);
    }
    if (n > 0) {
        return std::string(buf.data(), n);
    }
    return "";
}

bool InferenceEngine::eval_tokens(const std::vector<int>& tokens, int n_past) {
    llama_batch batch = llama_batch_init(static_cast<int>(tokens.size()), 0, 1);
    for (int i = 0; i < static_cast<int>(tokens.size()); ++i) {
        batch.token   [i] = tokens[i];
        batch.pos     [i] = n_past + i;
        batch.n_seq_id[i] = 1;
        batch.seq_id  [i][0] = 0;
        batch.logits  [i] = (i == static_cast<int>(tokens.size()) - 1) ? 1 : 0;
    }
    batch.n_tokens = static_cast<int>(tokens.size());

    int ret = llama_decode(m_ctx, batch);
    llama_batch_free(batch);
    if (ret != 0) {
        std::cerr << "[Space::InferenceEngine] llama_decode failed: " << ret << "\n";
        return false;
    }
    return true;
}

void InferenceEngine::log_system_info() const {
    std::cout << "[Space::InferenceEngine] " << llama_print_system_info() << "\n";
}

} // namespace space
