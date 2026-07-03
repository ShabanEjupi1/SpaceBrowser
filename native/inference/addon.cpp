/**
 * Space Browser – N-API Native Addon
 * ------------------------------------
 * Exposes the InferenceEngine and ModelManager to Node.js
 * via the N-API (stable ABI) interface.
 *
 * JavaScript API surface:
 *
 *   const addon = require('./native/build/Release/space_inference');
 *
 *   // Model Management
 *   addon.scanModels(modelsDir)          → ModelInfo[]
 *   addon.listModels()                   → ModelInfo[]
 *   addon.addModel(srcPath, id?)         → ModelInfo
 *   addon.removeModel(id)                → boolean
 *   addon.getModelMetadata()             → object (JSON)
 *
 *   // Inference
 *   addon.loadModel(path, params)        → boolean
 *   addon.unloadModel()                  → void
 *   addon.isLoaded()                     → boolean
 *   addon.generate(prompt, params, cb)   → void  (cb called per token)
 *   addon.chat(messages, params, cb)     → void  (cb called per token)
 *   addon.abort()                        → void
 *   addon.countTokens(text)              → number
 */

#include <napi.h>
#include "../include/inference_engine.h"
#include "../include/model_manager.h"

#include <memory>
#include <thread>
#include <string>
#include <vector>

using namespace space;

// ─────────────────────────────────────────────────────────────────────────────
// Singleton instances (one engine + one manager per process)
// ─────────────────────────────────────────────────────────────────────────────

static std::unique_ptr<InferenceEngine> g_engine;
static std::unique_ptr<ModelManager>    g_manager;

// ─────────────────────────────────────────────────────────────────────────────
// Async Worker for streaming inference
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs inference on a background thread and streams tokens back
 * to the JS event loop via a ThreadSafeFunction.
 */
class InferenceWorker : public Napi::AsyncWorker {
public:
    // For raw generation
    InferenceWorker(
        Napi::Env             env,
        std::string           prompt,
        GenerationParams      params,
        Napi::ThreadSafeFunction tsfn
    ) : Napi::AsyncWorker(env),
        m_prompt(std::move(prompt)),
        m_params(std::move(params)),
        m_tsfn(std::move(tsfn)),
        m_is_chat(false)
    {}

    // For chat generation
    InferenceWorker(
        Napi::Env                    env,
        std::vector<ChatMessage>     messages,
        GenerationParams             params,
        Napi::ThreadSafeFunction     tsfn
    ) : Napi::AsyncWorker(env),
        m_messages(std::move(messages)),
        m_params(std::move(params)),
        m_tsfn(std::move(tsfn)),
        m_is_chat(true)
    {}

    void Execute() override {
        if (!g_engine) {
            SetError("No inference engine initialized");
            return;
        }

        auto token_cb = [this](const std::string& token, bool is_final) -> bool {
            struct TokenData {
                std::string token;
                bool is_final;
            };

            auto* data = new TokenData{token, is_final};
            napi_status status = m_tsfn.BlockingCall(
                data,
                [](Napi::Env env, Napi::Function js_cb, TokenData* td) {
                    js_cb.Call({
                        Napi::String::New(env, td->token),
                        Napi::Boolean::New(env, td->is_final)
                    });
                    delete td;
                }
            );
            return status == napi_ok;
        };

        bool success;
        if (m_is_chat) {
            success = g_engine->chat(m_messages, m_params, token_cb);
        } else {
            success = g_engine->generate(m_prompt, m_params, token_cb);
        }

        if (!success) {
            SetError("Inference failed");
        }
    }

    void OnOK() override {
        m_tsfn.Release();
    }

    void OnError(const Napi::Error& e) override {
        m_tsfn.Release();
        // Error is surfaced to JS through the promise rejection
        Napi::AsyncWorker::OnError(e);
    }

private:
    std::string              m_prompt;
    std::vector<ChatMessage> m_messages;
    GenerationParams         m_params;
    Napi::ThreadSafeFunction m_tsfn;
    bool                     m_is_chat;
};

// ─────────────────────────────────────────────────────────────────────────────
// Helper: parse GenerationParams from JS object
// ─────────────────────────────────────────────────────────────────────────────

static GenerationParams parse_generation_params(const Napi::Object& obj) {
    GenerationParams p;
    if (obj.Has("nPredict"))          p.n_predict        = obj.Get("nPredict").As<Napi::Number>().Int32Value();
    if (obj.Has("temperature"))       p.temperature      = obj.Get("temperature").As<Napi::Number>().FloatValue();
    if (obj.Has("topP"))              p.top_p            = obj.Get("topP").As<Napi::Number>().FloatValue();
    if (obj.Has("topK"))              p.top_k            = obj.Get("topK").As<Napi::Number>().Int32Value();
    if (obj.Has("repeatPenalty"))     p.repeat_penalty   = obj.Get("repeatPenalty").As<Napi::Number>().FloatValue();
    if (obj.Has("presencePenalty"))   p.presence_penalty = obj.Get("presencePenalty").As<Napi::Number>().FloatValue();
    if (obj.Has("frequencyPenalty"))  p.frequency_penalty= obj.Get("frequencyPenalty").As<Napi::Number>().FloatValue();
    if (obj.Has("nCtx"))              p.n_ctx            = obj.Get("nCtx").As<Napi::Number>().Int32Value();
    if (obj.Has("nThreads"))          p.n_threads        = obj.Get("nThreads").As<Napi::Number>().Int32Value();
    if (obj.Has("nGpuLayers"))        p.n_gpu_layers     = obj.Get("nGpuLayers").As<Napi::Number>().Int32Value();
    if (obj.Has("stream"))            p.stream           = obj.Get("stream").As<Napi::Boolean>().Value();
    if (obj.Has("stopToken"))         p.stop_token       = obj.Get("stopToken").As<Napi::String>().Utf8Value();
    if (obj.Has("stopSequences")) {
        Napi::Array arr = obj.Get("stopSequences").As<Napi::Array>();
        for (uint32_t i = 0; i < arr.Length(); ++i) {
            p.stop_sequences.push_back(arr.Get(i).As<Napi::String>().Utf8Value());
        }
    }
    return p;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: ModelInfo → JS object
// ─────────────────────────────────────────────────────────────────────────────

static Napi::Object model_info_to_js(Napi::Env env, const ModelInfo& m) {
    Napi::Object obj = Napi::Object::New(env);
    obj.Set("id",             Napi::String::New(env, m.id));
    obj.Set("name",           Napi::String::New(env, m.name));
    obj.Set("path",           Napi::String::New(env, m.path));
    obj.Set("arch",           Napi::String::New(env, m.arch));
    obj.Set("description",    Napi::String::New(env, m.description));
    obj.Set("fileSizeBytes",  Napi::Number::New(env, static_cast<double>(m.file_size_bytes)));
    obj.Set("nParams",        Napi::Number::New(env, static_cast<double>(m.n_params)));
    obj.Set("nCtxTrain",      Napi::Number::New(env, static_cast<double>(m.n_ctx_train)));
    obj.Set("nVocab",         Napi::Number::New(env, static_cast<double>(m.n_vocab)));
    obj.Set("hasGpuSupport",  Napi::Boolean::New(env, m.has_gpu_support));
    obj.Set("chatTemplate",   Napi::String::New(env, m.chat_template));
    obj.Set("lastUsed",       Napi::String::New(env, m.last_used));
    return obj;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exported Functions
// ─────────────────────────────────────────────────────────────────────────────

Napi::Value ScanModels(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "Expected models directory path (string)").ThrowAsJavaScriptException();
        return env.Null();
    }
    std::string models_dir = info[0].As<Napi::String>().Utf8Value();
    g_manager = std::make_unique<ModelManager>(models_dir);
    int count = g_manager->scan_models();

    const auto& models = g_manager->list_models();
    Napi::Array arr = Napi::Array::New(env, models.size());
    for (size_t i = 0; i < models.size(); ++i) {
        arr.Set(static_cast<uint32_t>(i), model_info_to_js(env, models[i]));
    }
    return arr;
}

Napi::Value ListModels(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!g_manager) return Napi::Array::New(env, 0);
    const auto& models = g_manager->list_models();
    Napi::Array arr = Napi::Array::New(env, models.size());
    for (size_t i = 0; i < models.size(); ++i) {
        arr.Set(static_cast<uint32_t>(i), model_info_to_js(env, models[i]));
    }
    return arr;
}

Napi::Value AddModel(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "Expected source file path (string)").ThrowAsJavaScriptException();
        return env.Null();
    }
    if (!g_manager) {
        Napi::Error::New(env, "ModelManager not initialized – call scanModels first").ThrowAsJavaScriptException();
        return env.Null();
    }
    std::string src = info[0].As<Napi::String>().Utf8Value();
    std::string id  = (info.Length() > 1 && info[1].IsString())
                    ? info[1].As<Napi::String>().Utf8Value()
                    : "";
    try {
        ModelInfo m = g_manager->add_model(src, id);
        return model_info_to_js(env, m);
    } catch (const std::exception& e) {
        Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
        return env.Null();
    }
}

Napi::Value RemoveModel(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "Expected model id (string)").ThrowAsJavaScriptException();
        return env.Null();
    }
    if (!g_manager) return Napi::Boolean::New(env, false);
    bool ok = g_manager->remove_model(info[0].As<Napi::String>().Utf8Value());
    return Napi::Boolean::New(env, ok);
}

Napi::Value LoadModel(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "Expected model path (string)").ThrowAsJavaScriptException();
        return env.Null();
    }
    std::string path = info[0].As<Napi::String>().Utf8Value();
    GenerationParams params;
    if (info.Length() > 1 && info[1].IsObject()) {
        params = parse_generation_params(info[1].As<Napi::Object>());
    }

    if (!g_engine) {
        g_engine = std::make_unique<InferenceEngine>();
    }
    bool ok = g_engine->load_model(path, params);
    return Napi::Boolean::New(env, ok);
}

Napi::Value UnloadModel(const Napi::CallbackInfo& info) {
    if (g_engine) g_engine->unload_model();
    return info.Env().Undefined();
}

Napi::Value IsLoaded(const Napi::CallbackInfo& info) {
    bool loaded = g_engine && g_engine->is_loaded();
    return Napi::Boolean::New(info.Env(), loaded);
}

Napi::Value GetModelMetadata(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!g_engine) return Napi::String::New(env, "{}");
    return Napi::String::New(env, g_engine->get_model_metadata_json());
}

Napi::Value CountTokens(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsString()) {
        return Napi::Number::New(env, 0);
    }
    if (!g_engine) return Napi::Number::New(env, 0);
    int count = g_engine->count_tokens(info[0].As<Napi::String>().Utf8Value());
    return Napi::Number::New(env, count);
}

Napi::Value Generate(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 3 || !info[0].IsString() || !info[1].IsObject() || !info[2].IsFunction()) {
        Napi::TypeError::New(env, "Expected (prompt: string, params: object, callback: function)").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    std::string      prompt = info[0].As<Napi::String>().Utf8Value();
    GenerationParams params = parse_generation_params(info[1].As<Napi::Object>());
    Napi::Function   js_cb  = info[2].As<Napi::Function>();

    Napi::ThreadSafeFunction tsfn = Napi::ThreadSafeFunction::New(
        env, js_cb, "SpaceInference", /*maxQueueSize=*/0, /*initialThreadCount=*/1
    );

    auto* worker = new InferenceWorker(env, std::move(prompt), std::move(params), std::move(tsfn));
    worker->Queue();

    return env.Undefined();
}

Napi::Value Chat(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 3 || !info[0].IsArray() || !info[1].IsObject() || !info[2].IsFunction()) {
        Napi::TypeError::New(env, "Expected (messages: array, params: object, callback: function)").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Array msg_arr = info[0].As<Napi::Array>();
    std::vector<ChatMessage> messages;
    for (uint32_t i = 0; i < msg_arr.Length(); ++i) {
        Napi::Object msg = msg_arr.Get(i).As<Napi::Object>();
        ChatMessage m;
        m.role    = msg.Get("role").As<Napi::String>().Utf8Value();
        m.content = msg.Get("content").As<Napi::String>().Utf8Value();
        messages.push_back(std::move(m));
    }

    GenerationParams params = parse_generation_params(info[1].As<Napi::Object>());
    Napi::Function   js_cb  = info[2].As<Napi::Function>();

    Napi::ThreadSafeFunction tsfn = Napi::ThreadSafeFunction::New(
        env, js_cb, "SpaceChatInference", /*maxQueueSize=*/0, /*initialThreadCount=*/1
    );

    auto* worker = new InferenceWorker(env, std::move(messages), std::move(params), std::move(tsfn));
    worker->Queue();

    return env.Undefined();
}

Napi::Value AbortGeneration(const Napi::CallbackInfo& info) {
    if (g_engine) g_engine->abort();
    return info.Env().Undefined();
}

// ─────────────────────────────────────────────────────────────────────────────
// Module Init
// ─────────────────────────────────────────────────────────────────────────────

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("scanModels",       Napi::Function::New(env, ScanModels));
    exports.Set("listModels",       Napi::Function::New(env, ListModels));
    exports.Set("addModel",         Napi::Function::New(env, AddModel));
    exports.Set("removeModel",      Napi::Function::New(env, RemoveModel));
    exports.Set("loadModel",        Napi::Function::New(env, LoadModel));
    exports.Set("unloadModel",      Napi::Function::New(env, UnloadModel));
    exports.Set("isLoaded",         Napi::Function::New(env, IsLoaded));
    exports.Set("getModelMetadata", Napi::Function::New(env, GetModelMetadata));
    exports.Set("countTokens",      Napi::Function::New(env, CountTokens));
    exports.Set("generate",         Napi::Function::New(env, Generate));
    exports.Set("chat",             Napi::Function::New(env, Chat));
    exports.Set("abort",            Napi::Function::New(env, AbortGeneration));
    return exports;
}

NODE_API_MODULE(space_inference, Init)
