/**
 * Space Browser – Sampler Header
 * ----------------------------------
 * Implements various sampling strategies for token generation:
 *   - Greedy
 *   - Temperature
 *   - Top-K
 *   - Top-P (nucleus)
 *   - Repetition Penalty
 *   - Min-P
 *   - Tail-free sampling
 *
 * Uses llama.cpp's token_data_array as input.
 */

#pragma once

#include <vector>
#include <string>
#include <unordered_set>

namespace space {

struct SamplerConfig {
    float temperature       = 0.7f;
    float top_p             = 0.9f;
    int   top_k             = 40;
    float min_p             = 0.05f;
    float repeat_penalty    = 1.1f;
    float presence_penalty  = 0.0f;
    float frequency_penalty = 0.0f;
    int   repeat_last_n     = 64;    // How many recent tokens to check for repetition
    bool  penalize_newline  = false;
};

/**
 * Applies sampling pipeline to raw logits.
 * token_logits: raw logit vector (size = vocab_size)
 * recent_tokens: recently generated token IDs for repetition penalty
 * Returns the sampled token ID.
 */
int sample_token(
    std::vector<float>&         token_logits,
    const std::vector<int>&     recent_tokens,
    const SamplerConfig&        config,
    int                         eos_token_id
);

/**
 * Apply temperature scaling to logits (in-place).
 */
void apply_temperature(std::vector<float>& logits, float temperature);

/**
 * Apply top-K filtering (in-place, sets non-top-K logits to -inf).
 */
void apply_top_k(std::vector<float>& logits, int k);

/**
 * Apply nucleus (top-P) sampling (in-place).
 */
void apply_top_p(std::vector<float>& logits, float p);

/**
 * Apply min-P sampling (in-place).
 */
void apply_min_p(std::vector<float>& logits, float min_p);

/**
 * Apply repetition, presence, and frequency penalties.
 */
void apply_repetition_penalty(
    std::vector<float>&     logits,
    const std::vector<int>& recent_tokens,
    float                   repeat_penalty,
    float                   presence_penalty,
    float                   frequency_penalty,
    bool                    penalize_newline,
    int                     newline_token_id
);

/**
 * Softmax transform.
 */
void softmax(std::vector<float>& logits);

/**
 * Sample from a probability distribution.
 */
int sample_from_probs(const std::vector<float>& probs);

} // namespace space
