cmake_minimum_required(VERSION 3.20)
project(space_inference VERSION 1.0.0 LANGUAGES CXX C)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# ── llama.cpp ─────────────────────────────────────────────────────────────────

set(LLAMA_DIR "${CMAKE_CURRENT_SOURCE_DIR}/include/llama.cpp")

# Build only what we need from llama.cpp (no examples, no tests, no CUDA by default)
set(LLAMA_BUILD_EXAMPLES      OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TESTS         OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER        OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_COMMON        OFF CACHE BOOL "" FORCE)
set(GGML_NATIVE               ON  CACHE BOOL "" FORCE)  # AVX2 / native arch
set(GGML_CUDA                 OFF CACHE BOOL "" FORCE)  # flip to ON for GPU
set(GGML_METAL                OFF CACHE BOOL "" FORCE)

# llama.cpp's own CMakeLists builds ggml + llama as targets we can link against
add_subdirectory("${LLAMA_DIR}" llama_build EXCLUDE_FROM_ALL)

# ── Node.js / N-API ───────────────────────────────────────────────────────────

# node-addon-api exposes its include path via an npm script; we use the value
# stored in the environment variable set by node-gyp / our build script.
# Fall back to a relative path for CMake-direct builds.
if(DEFINED ENV{NODE_ADDON_API_INCLUDE})
  set(NODE_ADDON_INCLUDE "$ENV{NODE_ADDON_API_INCLUDE}")
else()
  execute_process(
    COMMAND node -p "require('node-addon-api').include"
    OUTPUT_VARIABLE NODE_ADDON_INCLUDE
    OUTPUT_STRIP_TRAILING_WHITESPACE
    WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/.."
  )
  string(REPLACE "\"" "" NODE_ADDON_INCLUDE "${NODE_ADDON_INCLUDE}")
endif()

# Node headers – can be passed from build-native.js as -DNODE_HEADERS=...
if(NOT DEFINED NODE_HEADERS)
  execute_process(
    COMMAND node -p "require('path').join(process.env.LOCALAPPDATA || process.env.HOME, '.node-gyp', process.versions.node, 'include', 'node')"
    OUTPUT_VARIABLE NODE_HEADERS
    OUTPUT_STRIP_TRAILING_WHITESPACE
    WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/.."
  )
endif()
set(NODE_INCLUDE "${NODE_HEADERS}")

# ── Space Inference Shared Library (.node) ───────────────────────────────────

set(ADDON_SOURCES
  "${CMAKE_CURRENT_SOURCE_DIR}/inference/addon.cpp"
  "${CMAKE_CURRENT_SOURCE_DIR}/inference/inference_engine.cpp"
  "${CMAKE_CURRENT_SOURCE_DIR}/inference/model_manager.cpp"
  "${CMAKE_CURRENT_SOURCE_DIR}/inference/sampler.cpp"
)

# On Windows, include the delay-load hook that redirects node.exe symbol lookup
# to the current host process (electron.exe / node.exe) at runtime.
if(WIN32)
  list(APPEND ADDON_SOURCES
    "${CMAKE_CURRENT_SOURCE_DIR}/inference/win_delay_load_hook.cc"
  )
endif()

add_library(space_inference SHARED ${ADDON_SOURCES})

# Node.js addon shared libs must be .node, not .dll / .so / .dylib
set_target_properties(space_inference PROPERTIES
  PREFIX ""
  SUFFIX ".node"
  OUTPUT_NAME "space_inference"
  LIBRARY_OUTPUT_DIRECTORY         "${CMAKE_CURRENT_SOURCE_DIR}/../build/Release"
  LIBRARY_OUTPUT_DIRECTORY_RELEASE "${CMAKE_CURRENT_SOURCE_DIR}/../build/Release"
  RUNTIME_OUTPUT_DIRECTORY         "${CMAKE_CURRENT_SOURCE_DIR}/../build/Release"
  RUNTIME_OUTPUT_DIRECTORY_RELEASE "${CMAKE_CURRENT_SOURCE_DIR}/../build/Release"
  ARCHIVE_OUTPUT_DIRECTORY         "${CMAKE_CURRENT_SOURCE_DIR}/../build/Release"
  ARCHIVE_OUTPUT_DIRECTORY_RELEASE "${CMAKE_CURRENT_SOURCE_DIR}/../build/Release"
)

target_include_directories(space_inference PRIVATE
  "${CMAKE_CURRENT_SOURCE_DIR}/include"
  "${CMAKE_CURRENT_SOURCE_DIR}/inference"
  "${LLAMA_DIR}/include"
  "${LLAMA_DIR}/ggml/include"
  "${LLAMA_DIR}/src"
  "${LLAMA_DIR}/ggml/src"
  "${NODE_ADDON_INCLUDE}"
  "${NODE_INCLUDE}"
)

target_compile_definitions(space_inference PRIVATE
  NAPI_DISABLE_CPP_EXCEPTIONS
  NODE_ADDON_API_DISABLE_DEPRECATED
  _GLIBCXX_USE_CXX11_ABI=1
  # N-API version 9 is the max supported by Electron 28 (Node.js v20)
  # This must match the headers used at build time
  $<IF:$<BOOL:${NAPI_VERSION}>,NAPI_VERSION=${NAPI_VERSION},NAPI_VERSION=9>
)

# Link against llama.cpp static libs (built by add_subdirectory above)
target_link_libraries(space_inference PRIVATE
  llama
  ggml
)

if(WIN32)
  target_compile_options(space_inference PRIVATE /std:c++17 /EHsc /O2 /arch:AVX2)
  target_compile_definitions(space_inference PRIVATE
    NOMINMAX WIN32_LEAN_AND_MEAN _CRT_SECURE_NO_WARNINGS
    # HOST_BINARY is used by win_delay_load_hook.cc to know which DLL to intercept.
    # node.exe is the default name used by node-gyp's node.lib import stubs.
    HOST_BINARY="node.exe"
  )
  # Link against the Node.js import library (provides napi_* symbols).
  # Use /DELAYLOAD:node.exe so that at runtime the symbols are resolved from
  # the host process (electron.exe) instead of looking for a separate node.exe DLL.
  if(DEFINED NODE_LIB AND EXISTS "${NODE_LIB}")
    target_link_libraries(space_inference PRIVATE "${NODE_LIB}")
  else()
    execute_process(
      COMMAND node -p "require('path').join(process.env.LOCALAPPDATA, 'node-gyp', 'Cache', process.versions.node, 'x64', 'node.lib')"
      OUTPUT_VARIABLE NODE_LIB_PATH
      OUTPUT_STRIP_TRAILING_WHITESPACE
      WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/.."
    )
    if(EXISTS "${NODE_LIB_PATH}")
      target_link_libraries(space_inference PRIVATE "${NODE_LIB_PATH}")
    else()
      message(WARNING "node.lib not found – linker may fail. Run: node-gyp install")
    endif()
  endif()
  # Delay-load node.exe so napi_* symbols resolve from the Electron host process
  target_link_options(space_inference PRIVATE
    "/DELAYLOAD:node.exe"
    "delayimp.lib"
  )
elseif(APPLE)
  target_compile_options(space_inference PRIVATE -O3 -march=native)
  set_target_properties(space_inference PROPERTIES
    LINK_FLAGS "-undefined dynamic_lookup"
  )
  target_link_libraries(space_inference PRIVATE "-framework Accelerate")
else()
  # Linux: a shared object already permits undefined symbols by default;
  # napi_* symbols are resolved from the Electron host process at load time.
  # (The macOS-only "-undefined dynamic_lookup" flag is not valid for GNU ld.)
  target_compile_options(space_inference PRIVATE -O3 -march=native)
endif()
