/**
 * Space Browser – Native Inference Engine Header
 * -----------------------------------------------
 * Wraps llama.cpp context into a high-level C++ class.
 * Supports GGUF model loading, token streaming, and
 * multi-turn chat with configurable sampling parameters.
 *
 * Architecture:
 *   InferenceEngine  ←→  ModelManager  ←→  GGUF files on disk
 *        ↑
 *     Sampler (temperature, top-p, top-k, repetition penalty)
 *        ↑
 *   Node.js N-API Addon (addon.cpp)
 */

#pragma once

#include <string>
#include <vector>
#include <functional>
#include <memory>
#include <atomic>
#include <mutex>
#include <thread>

// Forward-declare llama.cpp types to avoid including the full header
// in every translation unit. The full header is included in .cpp files.
struct llama_model;
struct llama_context;
struct llama_token_data_array;

namespace space {

/**
 * Generation parameters passed per-request.
 */
struct GenerationParams {
    int         n_predict       = 512;    // Max tokens to generate
    float       temperature     = 0.7f;
    float       top_p           = 0.9f;
    int         top_k           = 40;
    float       repeat_penalty  = 1.1f;
    float       presence_penalty= 0.0f;
    float       frequency_penalty=0.0f;
    int         n_ctx           = 4096;   // Context window size
    int         n_threads       = -1;     // -1 = auto-detect
    int         n_gpu_layers    = 0;      // 0 = CPU only, -1 = all layers on GPU
    bool        stream          = true;
    std::string stop_token      = "";
    std::vector<std::string> stop_sequences;
};

/**
 * A single message in a chat history.
 */
struct ChatMessage {
    std::string role;     // "system" | "user" | "assistant"
    std::string content;
};

/**
 * Token callback: called for each generated token during streaming.
 * Return false to abort generation.
 */
using TokenCallback = std::function<bool(const std::string& token, bool is_final)>;

/**
 * The primary inference engine. One instance per loaded model.
 */
class InferenceEngine {
public:
    explicit InferenceEngine();
    ~InferenceEngine();

    // Non-copyable, non-movable
    InferenceEngine(const InferenceEngine&) = delete;
    InferenceEngine& operator=(const InferenceEngine&) = delete;

    /**
     * Load a GGUF model from disk.
     * @param model_path  Absolute path to .gguf file.
     * @param params      Initial generation params (n_ctx, n_gpu_layers).
     * @return true on success.
     */
    bool load_model(const std::string& model_path, const GenerationParams& params);

    /**
     * Unload the current model and free memory.
     */
    void unload_model();

    /**
     * Check if a model is currently loaded and ready.
     */
    bool is_loaded() const;

    /**
     * Get the path of the currently loaded model.
     */
    std::string get_model_path() const;

    /**
     * Generate a completion for a raw prompt (no chat template).
     * Calls token_cb for each token. Blocks until generation finishes
     * or is aborted.
     */
    bool generate(
        const std::string&  prompt,
        const GenerationParams& params,
        TokenCallback       token_cb
    );

    /**
     * Generate a chat completion using the model's chat template.
     * Automatically formats messages into the correct prompt format.
     */
    bool chat(
        const std::vector<ChatMessage>& messages,
        const GenerationParams&         params,
        TokenCallback                   token_cb
    );

    /**
     * Abort any in-progress generation immediately.
     */
    void abort();

    /**
     * Returns metadata from the loaded model (name, arch, parameters, etc.)
     */
    std::string get_model_metadata_json() const;

    /**
     * Tokenize a string and return token count (useful for context estimation).
     */
    int count_tokens(const std::string& text) const;

private:
    llama_model*   m_model   = nullptr;
    llama_context* m_ctx     = nullptr;
    std::string    m_model_path;
    std::atomic<bool> m_abort_flag{false};
    mutable std::mutex m_inference_mutex;

    // Internal helpers
    std::string apply_chat_template(const std::vector<ChatMessage>& messages) const;
    std::vector<int> tokenize(const std::string& text, bool add_bos) const;
    std::string token_to_piece(int token) const;
    bool eval_tokens(const std::vector<int>& tokens, int n_past);
    int sample_next_token(const GenerationParams& params);
    void log_system_info() const;
};

} // namespace space
