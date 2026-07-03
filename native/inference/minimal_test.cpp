/**
 * Minimal NAPI test addon
 * Build with: node-gyp configure build
 * Or just test concept in the space project
 */
#include <napi.h>

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("hello", Napi::String::New(env, "world"));
  return exports;
}

NODE_API_MODULE(minimal_test, Init)
