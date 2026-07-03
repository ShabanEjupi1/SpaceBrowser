/**
 * Space Browser – Model Manager Header
 * ----------------------------------------
 * Handles discovery, metadata extraction, downloading,
 * and lifecycle management of GGUF model files.
 */

#pragma once

#include <string>
#include <vector>
#include <optional>
#include <filesystem>

namespace space {

/**
 * Metadata for a discovered GGUF model.
 */
struct ModelInfo {
    std::string id;           // Unique identifier (filename stem)
    std::string name;         // Human-readable name
    std::string path;         // Absolute path to .gguf file
    std::string arch;         // Model architecture (llama, mistral, phi, etc.)
    std::string description;
    uint64_t    file_size_bytes = 0;
    uint32_t    n_params        = 0;  // Approximate parameter count
    uint32_t    n_ctx_train     = 0;  // Training context length
    uint32_t    n_vocab         = 0;
    bool        has_gpu_support = false;
    std::string chat_template;        // Jinja2/simple template string
    std::string last_used;            // ISO 8601 timestamp
};

/**
 * Manages the user's GGUF model library.
 */
class ModelManager {
public:
    explicit ModelManager(const std::string& models_dir);

    /**
     * Scan models_dir for all .gguf files and populate internal registry.
     * @return Number of models found.
     */
    int scan_models();

    /**
     * Get all known models.
     */
    std::vector<ModelInfo> list_models() const;

    /**
     * Find a model by ID (filename stem).
     */
    std::optional<ModelInfo> find_model(const std::string& model_id) const;

    /**
     * Extract metadata from a GGUF file without fully loading it.
     * Uses the GGUF file format's metadata section directly.
     */
    ModelInfo extract_metadata(const std::string& gguf_path) const;

    /**
     * Add a model by copying/moving a GGUF file into the models directory.
     * @param source_path  Path to the source .gguf file.
     * @param model_id     Optional custom ID (uses filename stem if empty).
     * @return ModelInfo of the added model.
     */
    ModelInfo add_model(const std::string& source_path, const std::string& model_id = "");

    /**
     * Remove a model from the library (deletes the file).
     */
    bool remove_model(const std::string& model_id);

    /**
     * Get total size of all models in bytes.
     */
    uint64_t total_size_bytes() const;

    /**
     * Returns the configured models directory.
     */
    std::string models_dir() const;

private:
    std::string m_models_dir;
    std::vector<ModelInfo> m_models;

    std::string sanitize_model_id(const std::string& raw) const;
    std::string format_arch_name(const std::string& raw_arch) const;
};

} // namespace space
