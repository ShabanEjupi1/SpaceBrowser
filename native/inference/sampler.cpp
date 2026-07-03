/**
 * Space Browser – Sampler Implementation
 * ----------------------------------------
 * Implements the token sampling pipeline.
 */

#include "../include/sampler.h"

#include <algorithm>
#include <cmath>
#include <numeric>
#include <random>
#include <stdexcept>
#include <unordered_map>

namespace space {

// Thread-local RNG for deterministic sampling within a thread
static thread_local std::mt19937 s_rng{std::random_device{}()};

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline entry point
// ─────────────────────────────────────────────────────────────────────────────

int sample_token(
    std::vector<float>&         logits,
    const std::vector<int>&     recent_tokens,
    const SamplerConfig&        cfg,
    int                         eos_token_id
) {
    // 1. Apply repetition/presence/frequency penalties
    apply_repetition_penalty(
        logits, recent_tokens,
        cfg.repeat_penalty, cfg.presence_penalty, cfg.frequency_penalty,
        cfg.penalize_newline, /*newline_token_id=*/-1
    );

    // 2. Greedy if temperature == 0
    if (cfg.temperature <= 0.0f || cfg.temperature < 1e-6f) {
        return static_cast<int>(
            std::max_element(logits.begin(), logits.end()) - logits.begin()
        );
    }

    // 3. Temperature scaling
    apply_temperature(logits, cfg.temperature);

    // 4. Top-K filtering
    if (cfg.top_k > 0 && cfg.top_k < static_cast<int>(logits.size())) {
        apply_top_k(logits, cfg.top_k);
    }

    // 5. Min-P filtering
    if (cfg.min_p > 0.0f) {
        apply_min_p(logits, cfg.min_p);
    }

    // 6. Top-P (nucleus) filtering
    if (cfg.top_p < 1.0f) {
        apply_top_p(logits, cfg.top_p);
    }

    // 7. Softmax to get probabilities
    softmax(logits);

    // 8. Multinomial sampling
    return sample_from_probs(logits);
}

// ─────────────────────────────────────────────────────────────────────────────
// Individual sampling operations
// ─────────────────────────────────────────────────────────────────────────────

void apply_temperature(std::vector<float>& logits, float temperature) {
    const float inv_temp = 1.0f / temperature;
    for (float& v : logits) {
        v *= inv_temp;
    }
}

void apply_top_k(std::vector<float>& logits, int k) {
    if (k <= 0 || k >= static_cast<int>(logits.size())) return;

    // Find the k-th largest value
    std::vector<float> sorted = logits;
    std::nth_element(sorted.begin(), sorted.begin() + k, sorted.end(), std::greater<float>());
    const float threshold = sorted[k];

    // Set all logits below threshold to -infinity
    for (float& v : logits) {
        if (v < threshold) {
            v = -std::numeric_limits<float>::infinity();
        }
    }
}

void apply_top_p(std::vector<float>& logits, float p) {
    // Convert to probabilities first
    std::vector<float> probs = logits;
    softmax(probs);

    // Sort indices by probability descending
    std::vector<int> indices(logits.size());
    std::iota(indices.begin(), indices.end(), 0);
    std::sort(indices.begin(), indices.end(), [&probs](int a, int b) {
        return probs[a] > probs[b];
    });

    // Find cutoff
    float cumsum = 0.0f;
    int cutoff = static_cast<int>(indices.size());
    for (int i = 0; i < static_cast<int>(indices.size()); ++i) {
        cumsum += probs[indices[i]];
        if (cumsum >= p) {
            cutoff = i + 1;
            break;
        }
    }

    // Mask tokens beyond cutoff
    for (int i = cutoff; i < static_cast<int>(indices.size()); ++i) {
        logits[indices[i]] = -std::numeric_limits<float>::infinity();
    }
}

void apply_min_p(std::vector<float>& logits, float min_p) {
    // Convert to probs to find max prob
    std::vector<float> probs = logits;
    softmax(probs);
    float max_prob = *std::max_element(probs.begin(), probs.end());
    float threshold = min_p * max_prob;

    for (int i = 0; i < static_cast<int>(logits.size()); ++i) {
        if (probs[i] < threshold) {
            logits[i] = -std::numeric_limits<float>::infinity();
        }
    }
}

void apply_repetition_penalty(
    std::vector<float>&     logits,
    const std::vector<int>& recent_tokens,
    float                   repeat_penalty,
    float                   presence_penalty,
    float                   frequency_penalty,
    bool                    penalize_newline,
    int                     newline_token_id
) {
    if (recent_tokens.empty()) return;

    // Count token frequencies
    std::unordered_map<int, int> token_freq;
    for (int tok : recent_tokens) {
        token_freq[tok]++;
    }

    for (auto& [tok, freq] : token_freq) {
        if (tok < 0 || tok >= static_cast<int>(logits.size())) continue;
        if (!penalize_newline && tok == newline_token_id) continue;

        // Repetition penalty: divide positive logits, multiply negative
        if (repeat_penalty != 1.0f) {
            if (logits[tok] > 0) {
                logits[tok] /= repeat_penalty;
            } else {
                logits[tok] *= repeat_penalty;
            }
        }

        // Presence penalty: flat penalty if token appeared at all
        if (presence_penalty != 0.0f) {
            logits[tok] -= presence_penalty;
        }

        // Frequency penalty: scaled by how often the token appeared
        if (frequency_penalty != 0.0f) {
            logits[tok] -= frequency_penalty * static_cast<float>(freq);
        }
    }
}

void softmax(std::vector<float>& logits) {
    if (logits.empty()) return;

    // Numerically stable softmax
    float max_val = *std::max_element(logits.begin(), logits.end());
    float sum     = 0.0f;

    for (float& v : logits) {
        v = std::exp(v - max_val);
        sum += v;
    }
    if (sum > 0.0f) {
        for (float& v : logits) {
            v /= sum;
        }
    }
}

int sample_from_probs(const std::vector<float>& probs) {
    std::discrete_distribution<int> dist(probs.begin(), probs.end());
    return dist(s_rng);
}

} // namespace space
