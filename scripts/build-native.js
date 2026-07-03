#!/usr/bin/env node
/**
 * Space Browser – Native Addon Build Script
 * ------------------------------------------
 * Builds the space_inference.node N-API addon using CMake.
 * Requires:
 *  - Visual Studio 2022 (Windows) / Xcode (macOS) / GCC (Linux)
 *  - CMake 3.20+ (bundled with VS on Windows)
 *  - Node.js headers
 *  - llama.cpp cloned to native/include/llama.cpp/
 */

const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

const ROOT        = path.join(__dirname, '..');
const NATIVE_DIR  = path.join(ROOT, 'native');
const BUILD_DIR   = path.join(NATIVE_DIR, 'build_cmake');
const OUTPUT_DIR  = path.join(ROOT, 'build', 'Release');
const LLAMA_DIR   = path.join(NATIVE_DIR, 'include', 'llama.cpp');

// ── Pre-flight checks ─────────────────────────────────────────────────────────

if (!fs.existsSync(path.join(LLAMA_DIR, 'include', 'llama.h'))) {
  console.error('\n❌ llama.cpp not found at native/include/llama.cpp/');
  console.error('   Run: git clone --depth=1 https://github.com/ggerganov/llama.cpp.git native/include/llama.cpp');
  process.exit(1);
}

// Locate cmake
function findCmake() {
  if (process.platform === 'win32') {
    const vsPaths = [
      'C:\\Program Files\\Microsoft Visual Studio\\18\\Community\\Common7\\IDE\\CommonExtensions\\Microsoft\\CMake\\CMake\\bin\\cmake.exe',
      'C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\Common7\\IDE\\CommonExtensions\\Microsoft\\CMake\\CMake\\bin\\cmake.exe',
      'C:\\Program Files\\CMake\\bin\\cmake.exe',
    ];
    for (const p of vsPaths) {
      if (fs.existsSync(p)) return `"${p}"`;
    }
    // Try cmake in PATH
    try { execSync('cmake --version', { stdio: 'ignore' }); return 'cmake'; } catch {}
    console.error('❌ CMake not found. Install Visual Studio 2022 with C++ workload or CMake separately.');
    process.exit(1);
  }
  try { execSync('cmake --version', { stdio: 'ignore' }); return 'cmake'; } catch {}
  console.error('❌ cmake not found in PATH');
  process.exit(1);
}

const cmake = findCmake();

// Get node-addon-api include path
const nodeAddonInclude = execSync('node -p "require(\'node-addon-api\').include"', {
  cwd: ROOT, encoding: 'utf8'
}).trim().replace(/"/g, '');

// ── Electron target configuration ─────────────────────────────────────────────
// Space Browser uses Electron 28, which embeds Node.js v20.x (modules ABI 125).
// We MUST build space_inference.node against Electron's Node.js headers,
// NOT the system Node.js headers, otherwise Node.js ABI mismatch causes crash.
const ELECTRON_VERSION = '28.3.3';
const electronHeadersRoot = path.join(
  process.env.LOCALAPPDATA || os.homedir(),
  'node-gyp', 'Cache', ELECTRON_VERSION
);
let nodeHeaders = path.join(electronHeadersRoot, 'include', 'node');
let nodeLib     = path.join(electronHeadersRoot, 'x64', 'node.lib');

// If Electron headers are not cached yet, download them now
if (!fs.existsSync(path.join(nodeHeaders, 'node_api.h'))) {
  console.log(`📥 Downloading Electron ${ELECTRON_VERSION} Node.js headers…`);
  execSync(
    `npx node-gyp install --target=${ELECTRON_VERSION} --arch=x64 --dist-url=https://electronjs.org/headers`,
    { cwd: ROOT, stdio: 'inherit' }
  );
}

if (!fs.existsSync(path.join(nodeHeaders, 'node_api.h'))) {
  console.error(`❌ Electron Node.js headers not found at: ${nodeHeaders}`);
  process.exit(1);
}
if (process.platform === 'win32' && !fs.existsSync(nodeLib)) {
  console.error(`❌ Electron node.lib not found at: ${nodeLib}`);
  process.exit(1);
}

console.log(`  Using Electron ${ELECTRON_VERSION} headers: ${nodeHeaders}`);
if (process.platform === 'win32') {
  console.log(`  node.lib: ${nodeLib}`);
}

// ── Create build directories ──────────────────────────────────────────────────

fs.mkdirSync(BUILD_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// ── Configure ─────────────────────────────────────────────────────────────────

console.log('\n🔧 Configuring CMake build…');

const configArgs = [
  cmake,
  `"${NATIVE_DIR}"`,
  `-B "${BUILD_DIR}"`,
  '-DCMAKE_BUILD_TYPE=Release',
  `-DNODE_ADDON_API_INCLUDE="${nodeAddonInclude}"`,
  `-DNODE_HEADERS="${nodeHeaders}"`,
  nodeLib ? `-DNODE_LIB="${nodeLib}"` : '',
  '-DLLAMA_BUILD_EXAMPLES=OFF',
  '-DLLAMA_BUILD_TESTS=OFF',
  '-DLLAMA_BUILD_SERVER=OFF',
  '-DGGML_NATIVE=ON',
  '-DGGML_CUDA=OFF',
  // N-API version 9 is supported by Electron 28 (Node.js v20)
  '-DNAPI_VERSION=9',
].filter(Boolean);

if (process.platform === 'win32') {
  // Detect installed VS version
  const vsGenerators = [
    { path: 'C:\\Program Files\\Microsoft Visual Studio\\18\\Community', gen: 'Visual Studio 18 2026' },
    { path: 'C:\\Program Files\\Microsoft Visual Studio\\18\\Professional', gen: 'Visual Studio 18 2026' },
    { path: 'C:\\Program Files\\Microsoft Visual Studio\\18\\Enterprise', gen: 'Visual Studio 18 2026' },
    { path: 'C:\\Program Files\\Microsoft Visual Studio\\2022\\Community', gen: 'Visual Studio 17 2022' },
    { path: 'C:\\Program Files\\Microsoft Visual Studio\\2022\\Professional', gen: 'Visual Studio 17 2022' },
    { path: 'C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise', gen: 'Visual Studio 17 2022' },
  ];
  let generator = 'Visual Studio 17 2022'; // default fallback
  for (const vs of vsGenerators) {
    if (fs.existsSync(vs.path)) {
      generator = vs.gen;
      break;
    }
  }
  configArgs.push(`-G "${generator}"`, '-A x64');
} else if (process.platform === 'darwin') {
  configArgs.push('-DGGML_METAL=ON');
}

const configCmd = configArgs.join(' ');
console.log(`  ${configCmd}\n`);

const configResult = spawnSync(configCmd, {
  shell: true, cwd: ROOT, stdio: 'inherit',
  env: { ...process.env, NODE_ADDON_API_INCLUDE: nodeAddonInclude }
});
if (configResult.status !== 0) {
  console.error('❌ CMake configure failed');
  process.exit(1);
}

// ── Build ─────────────────────────────────────────────────────────────────────

const cpuCount = os.cpus().length;
const buildCmd = process.platform === 'win32'
  ? `${cmake} --build "${BUILD_DIR}" --config Release --target space_inference -- /maxcpucount:${cpuCount}`
  : `${cmake} --build "${BUILD_DIR}" --config Release --target space_inference -- -j${cpuCount}`;
console.log('\n🔨 Building space_inference.node…');
console.log(`  ${buildCmd}\n`);

const buildResult = spawnSync(buildCmd, {
  shell: true, cwd: ROOT, stdio: 'inherit'
});
if (buildResult.status !== 0) {
  console.error('❌ CMake build failed');
  process.exit(1);
}

// ── Verify output ─────────────────────────────────────────────────────────────

const nodeFile = path.join(OUTPUT_DIR, 'space_inference.node');
if (fs.existsSync(nodeFile)) {
  const size = (fs.statSync(nodeFile).size / 1024 / 1024).toFixed(1);
  console.log(`\n✅ Built successfully: ${nodeFile} (${size} MB)`);
  // Copy llama/ggml DLLs (Windows shared libs) into the same output dir
  if (process.platform === 'win32') {
    const dllSourceDirs = [
      path.join(BUILD_DIR, 'bin', 'Release'),
      path.join(BUILD_DIR, 'Release'),
    ];
    for (const dllDir of dllSourceDirs) {
      if (!fs.existsSync(dllDir)) continue;
      for (const f of fs.readdirSync(dllDir)) {
        if (f.endsWith('.dll')) {
          const dest = path.join(OUTPUT_DIR, f);
          if (!fs.existsSync(dest)) {
            fs.copyFileSync(path.join(dllDir, f), dest);
            console.log(`  Copied DLL: ${f}`);
          }
        }
      }
    }
  }
} else {
  // CMake on Windows places output in build/Release/Release/ (Debug/Release config subfolder)
  const altPaths = [
    path.join(OUTPUT_DIR, 'Release', 'space_inference.node'),
    path.join(BUILD_DIR, 'Release', 'space_inference.node'),
    path.join(BUILD_DIR, 'bin', 'Release', 'space_inference.node'),
  ];
  let found = false;
  for (const alt of altPaths) {
    if (fs.existsSync(alt)) {
      fs.copyFileSync(alt, nodeFile);
      // Also copy llama/ggml DLLs that llama.cpp built as shared libs
      const altDir = path.dirname(alt);
      for (const f of fs.readdirSync(altDir)) {
        if (f.endsWith('.dll') || f.endsWith('.pdb')) {
          fs.copyFileSync(path.join(altDir, f), path.join(OUTPUT_DIR, f));
        }
      }
      const size = (fs.statSync(nodeFile).size / 1024 / 1024).toFixed(1);
      console.log(`\n✅ Built and copied to: ${nodeFile} (${size} MB)`);
      found = true;
      break;
    }
  }
  if (!found) {
    console.error('❌ space_inference.node not found after build! Searched:');
    altPaths.forEach(p => console.error('  ' + p));
    process.exit(1);
  }
}
