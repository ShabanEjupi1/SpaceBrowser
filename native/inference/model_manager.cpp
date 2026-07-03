/**
 * Space Browser – Model Manager Implementation
 * -----------------------------------------------
 * Discovers, validates, and manages GGUF model files.
 */

#include "../include/model_manager.h"

// GGUF file format reader
// We read the GGUF header directly for fast metadata extraction
// without loading the entire model into memory.
#include "llama.cpp/include/llama.h"

#include <iostream>
#include <sstream>
#include <fstream>
#include <algorithm>
#include <cctype>
#include <ctime>
#include <unordered_map>

namespace fs = std::filesystem;

namespace space {

// ─────────────────────────────────────────────────────────────────────────────
// Constructor
// ─────────────────────────────────────────────────────────────────────────────

ModelManager::ModelManager(const std::string& models_dir)
    : m_models_dir(models_dir)
{
    // Ensure models directory exists
    if (!fs::exists(m_models_dir)) {
        fs::create_directories(m_models_dir);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Model Discovery
// ─────────────────────────────────────────────────────────────────────────────

int ModelManager::scan_models() {
    m_models.clear();

    if (!fs::exists(m_models_dir)) {
        return 0;
    }

    for (const auto& entry : fs::directory_iterator(m_models_dir)) {
        if (!entry.is_regular_file()) continue;
        const auto& path = entry.path();
        if (path.extension() != ".gguf") continue;

        try {
            ModelInfo info = extract_metadata(path.string());
            m_models.push_back(std::move(info));
        } catch (const std::exception& e) {
            std::cerr << "[Space::ModelManager] Failed to read: "
                      << path << " – " << e.what() << "\n";
        }
    }

    // Sort alphabetically by name
    std::sort(m_models.begin(), m_models.end(), [](const ModelInfo& a, const ModelInfo& b) {
        return a.name < b.name;
    });

    std::cout << "[Space::ModelManager] Found " << m_models.size() << " model(s)\n";
    return static_cast<int>(m_models.size());
}

std::vector<ModelInfo> ModelManager::list_models() const {
    return m_models;
}

std::optional<ModelInfo> ModelManager::find_model(const std::string& model_id) const {
    for (const auto& m : m_models) {
        if (m.id == model_id) return m;
    }
    return std::nullopt;
}

// ─────────────────────────────────────────────────────────────────────────────
// Metadata Extraction
// ─────────────────────────────────────────────────────────────────────────────

ModelInfo ModelManager::extract_metadata(const std::string& gguf_path) const {
    ModelInfo info;
    info.path = gguf_path;
    info.id   = sanitize_model_id(fs::path(gguf_path).stem().string());
    info.name = fs::path(gguf_path).stem().string();

    // File size
    std::error_code ec;
    info.file_size_bytes = fs::file_size(gguf_path, ec);

    // Use llama.cpp to load just the model metadata (very fast – no tensor loading)
    llama_model_params mparams = llama_model_default_params();
    mparams.n_gpu_layers = 0;
    mparams.use_mmap     = true;
    mparams.vocab_only   = true;  // Only load metadata + vocab, not tensors

    llama_model* model = llama_model_load_from_file(gguf_path.c_str(), mparams);
    if (!model) {
        // Return partial info if model can't be loaded
        return info;
    }

    info.n_vocab = static_cast<uint32_t>(llama_vocab_n_tokens(llama_model_get_vocab(model)));
    info.n_ctx_train = static_cast<uint32_t>(llama_model_n_ctx_train(model));

    // Extract metadata key-value pairs
    const int n_meta = llama_model_meta_count(model);
    for (int i = 0; i < n_meta; ++i) {
        char key_buf[512]  = {};
        char val_buf[8192] = {};
        llama_model_meta_key_by_index(model, i, key_buf, sizeof(key_buf));
        llama_model_meta_val_str_by_index(model, i, val_buf, sizeof(val_buf));

        std::string key(key_buf);
        std::string val(val_buf);

        if (key.find("general.architecture") != std::string::npos) {
            info.arch = format_arch_name(val);
        } else if (key.find("general.name") != std::string::npos) {
            info.name = val;
        } else if (key.find("general.description") != std::string::npos) {
            info.description = val;
        } else if (key.find("tokenizer.chat_template") != std::string::npos) {
            info.chat_template = val;
        } else if (key.find(".block_count") != std::string::npos) {
            // Approximate param count from layer count
            try {
                uint32_t n_layers = std::stoul(val);
                info.n_params = n_layers; // placeholder – real count needs embd dims
            } catch (...) {}
        }
    }

    // Use filename as name if general.name was not in metadata
    if (info.name.empty() || info.name == info.id) {
        info.name = fs::path(gguf_path).stem().string();
        // Convert underscores/hyphens to spaces and title-case
        std::replace(info.name.begin(), info.name.end(), '_', ' ');
        std::replace(info.name.begin(), info.name.end(), '-', ' ');
    }

    llama_model_free(model);
    return info;
}

// ─────────────────────────────────────────────────────────────────────────────
// Add / Remove
// ─────────────────────────────────────────────────────────────────────────────

ModelInfo ModelManager::add_model(const std::string& source_path, const std::string& model_id) {
    const fs::path src(source_path);
    if (!fs::exists(src)) {
        throw std::runtime_error("Source file does not exist: " + source_path);
    }

    std::string id = model_id.empty()
                   ? sanitize_model_id(src.stem().string())
                   : model_id;

    fs::path dest = fs::path(m_models_dir) / (id + ".gguf");

    // Copy if not already in models dir
    if (src != dest) {
        fs::copy_file(src, dest, fs::copy_options::overwrite_existing);
    }

    ModelInfo info = extract_metadata(dest.string());
    info.id = id;

    // Update registry
    auto it = std::find_if(m_models.begin(), m_models.end(), [&id](const ModelInfo& m) {
        return m.id == id;
    });
    if (it != m_models.end()) {
        *it = info;
    } else {
        m_models.push_back(info);
    }

    return info;
}

bool ModelManager::remove_model(const std::string& model_id) {
    auto it = std::find_if(m_models.begin(), m_models.end(), [&model_id](const ModelInfo& m) {
        return m.id == model_id;
    });
    if (it == m_models.end()) return false;

    const std::string path = it->path;
    m_models.erase(it);

    std::error_code ec;
    return fs::remove(path, ec);
}

uint64_t ModelManager::total_size_bytes() const {
    uint64_t total = 0;
    for (const auto& m : m_models) {
        total += m.file_size_bytes;
    }
    return total;
}

std::string ModelManager::models_dir() const {
    return m_models_dir;
}

// ─────────────────────────────────────────────────────────────────────────────
// Private Helpers
// ─────────────────────────────────────────────────────────────────────────────

std::string ModelManager::sanitize_model_id(const std::string& raw) const {
    std::string id = raw;
    std::transform(id.begin(), id.end(), id.begin(), ::tolower);
    for (char& c : id) {
        if (!std::isalnum(c) && c != '-') c = '-';
    }
    // Trim leading/trailing hyphens
    while (!id.empty() && id.front() == '-') id.erase(id.begin());
    while (!id.empty() && id.back()  == '-') id.pop_back();
    return id;
}

std::string ModelManager::format_arch_name(const std::string& raw_arch) const {
    // Map llama.cpp architecture identifiers to display names
    using StrMap = std::unordered_map<std::string, std::string>;
    static const StrMap arch_names = []() {
        StrMap m;
        m["llama"]     = "LLaMA";
        m["mistral"]   = "Mistral";
        m["mixtral"]   = "Mixtral";
        m["phi2"]      = "Phi-2";
        m["phi3"]      = "Phi-3";
        m["phi"]       = "Phi";
        m["falcon"]    = "Falcon";
        m["gpt2"]      = "GPT-2";
        m["gptj"]      = "GPT-J";
        m["gptneox"]   = "GPT-NeoX";
        m["bloom"]     = "BLOOM";
        m["mpt"]       = "MPT";
        m["stablelm"]  = "StableLM";
        m["qwen2"]     = "Qwen2";
        m["qwen"]      = "Qwen";
        m["gemma"]     = "Gemma";
        m["gemma2"]    = "Gemma 2";
        m["starcoder"] = "StarCoder";
        m["command-r"] = "Command R";
        m["cohere"]    = "Cohere";
        m["deepseek"]  = "DeepSeek";
        m["solar"]     = "SOLAR";
        m["yi"]        = "Yi";
        m["internlm"]  = "InternLM";
        m["wizardlm"]  = "WizardLM";
        return m;
    }();

    auto it = arch_names.find(raw_arch);
    return (it != arch_names.end()) ? it->second : raw_arch;
}

} // namespace space
