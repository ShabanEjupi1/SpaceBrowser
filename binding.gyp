{
  "targets": [
    {
      "target_name": "space_inference",
      "sources": [
        "native/inference/addon.cpp",
        "native/inference/inference_engine.cpp",
        "native/inference/model_manager.cpp",
        "native/inference/tokenizer.cpp",
        "native/inference/sampler.cpp"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "native/include",
        "native/include/llama.cpp"
      ],
      "libraries": [],
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "cflags_cc": ["-std=c++17", "-O3", "-march=native", "-DNDEBUG", "-DGGML_USE_K_QUANTS"],
      "conditions": [
        ["OS=='win'", {
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1,
              "Optimization": 3,
              "AdditionalOptions": ["/std:c++17", "/arch:AVX2"],
              "PreprocessorDefinitions": ["NOMINMAX", "WIN32_LEAN_AND_MEAN", "GGML_USE_K_QUANTS"]
            }
          },
          "libraries": ["kernel32.lib", "user32.lib"]
        }],
        ["OS=='mac'", {
          "xcode_settings": {
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
            "CLANG_CXX_LIBRARY": "libc++",
            "MACOSX_DEPLOYMENT_TARGET": "12.0",
            "OTHER_CFLAGS": ["-O3", "-march=native"],
            "OTHER_CPLUSPLUSFLAGS": ["-O3", "-march=native", "-DGGML_USE_ACCELERATE"]
          },
          "libraries": ["-framework Accelerate", "-framework Foundation"]
        }],
        ["OS=='linux'", {
          "cflags": ["-O3", "-march=native"],
          "libraries": ["-lpthread", "-lm"]
        }]
      ],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"]
    }
  ]
}
