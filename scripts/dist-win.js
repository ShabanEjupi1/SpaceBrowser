/**
 * dist-win.js
 *
 * Windows-specific distribution build script for Space Browser.
 *
 * Problem solved: electron-builder cannot overwrite release/win-unpacked/resources/app.asar
 * when VS Code's file watcher (or a prior Space process) holds the file open.
 *
 * Solution:
 *   1. Kill any running Space.exe processes.
 *   2. Delete the stale win-unpacked tree inside release/ so there is no locked file.
 *   3. Write a temporary electron-builder config that overrides only the output directory
 *      to a path outside the workspace (avoids VS Code file-watcher lock on app.asar).
 *   4. Run electron-builder with --config pointing at that temp config file.
 *      This is the ONLY reliable way to override the output dir; passing
 *      --config.directories.output=<path> as a CLI argument breaks when the
 *      path contains spaces (Windows 8.3 short-name issue).
 *   5. Copy the finished installer artifacts back to release/.
 *
 * Also regenerates icons before each build so the ICO is always up-to-date.
 */

'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

const ROOT     = path.resolve(__dirname, '..');
const RELEASE  = path.join(ROOT, 'release');
// Use a fixed short path in TEMP with no spaces so electron-builder never
// chokes on 8.3 short-name conversion under Windows.
const TEMP_OUT = path.join('C:\\', 'SpaceBuild');

// Read version from package.json dynamically so we never hardcode it
const pkg     = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const VERSION = pkg.version;

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(msg) {
  process.stdout.write(`[dist-win] ${msg}\n`);
}

function run(cmd, opts = {}) {
  log(`> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...opts });
}

// ── 0. Regenerate icons (ensures ICO is always a proper multi-res ICO) ───────

log('Regenerating icons...');
try {
  run('node scripts/generate-icons.js');
} catch (e) {
  log('Warning: icon generation failed (sharp may not be installed). Using existing icons.');
}

// ── 1. Ensure output directories exist ───────────────────────────────────────

fs.mkdirSync(RELEASE, { recursive: true });
fs.mkdirSync(TEMP_OUT, { recursive: true });

// ── 2. Kill stale Space processes and remove locked win-unpacked tree ─────────
//
// On Windows, VS Code's file watcher opens handles into any file it has indexed
// inside the workspace — including release/win-unpacked/resources/app.asar.
// electron-builder tries to delete that directory before writing the new asar,
// and fails with EBUSY when the handle is open.
//
// The fix is two-fold:
//   (a) Kill any Space.exe that might have app.asar mapped into its memory.
//   (b) Manually delete the win-unpacked tree from the workspace before building
//       so there is nothing for VS Code to lock during the build phase.
//       The actual packaging happens in TEMP_OUT, safely outside the workspace.

if (process.platform === 'win32') {
  log('Stopping any running Space processes...');
  try {
    execSync('taskkill /IM "Space.exe" /F', { stdio: 'ignore', cwd: ROOT });
    // Short sleep to let the OS release file handles
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  } catch { /* Space.exe not running – fine */ }

  const staleUnpacked = path.join(RELEASE, 'win-unpacked');
  if (fs.existsSync(staleUnpacked)) {
    log(`Removing stale ${staleUnpacked} ...`);
    try {
      fs.rmSync(staleUnpacked, { recursive: true, force: true });
      log('  Removed.');
    } catch (e) {
      log(`  Warning: could not fully remove win-unpacked (${e.message}). Build may still succeed.`);
    }
  }
}

// ── 3. Build to TEMP so VS Code's file watcher can never lock app.asar ───────
//
// We write a standalone electron-builder config JSON that inherits from
// package.json's "build" field (via "extends": "package.json") and overrides
// only the output directory.  Passing the path via --config <file> is the only
// reliable way to supply a directory path that contains spaces on Windows.

log(`\nBuilding Space v${VERSION}  →  ${TEMP_OUT}\n`);

// Build a self-contained electron-builder config by extracting the "build"
// section from package.json and merging in our output-directory override.
// We deliberately do NOT use `extends: 'package.json'` because electron-builder
// would then validate the *entire* package.json – including the "binary" key
// used by node-pre-gyp – and reject it with a ValidationError.
const pkgBuildCfg = JSON.parse(JSON.stringify(pkg.build || {}));
const overrideCfg = {
  ...pkgBuildCfg,
  directories: {
    ...(pkgBuildCfg.directories || {}),
    output: TEMP_OUT,
    buildResources: path.join(ROOT, 'assets'),
  },
};

const partialCfgPath = path.join(TEMP_OUT, 'eb-config-override.json');
fs.writeFileSync(partialCfgPath, JSON.stringify(overrideCfg, null, 2), 'utf-8');
log(`Config override written to: ${partialCfgPath}`);

// On Windows, .cmd wrappers (npx.cmd) require shell:true to be invoked by
// cmd.exe. Using shell:false causes EINVAL because Node tries to spawn the
// .cmd file as a native binary, which is not possible on Windows.
// We quote the config path to handle any spaces, and use execSync (which
// already uses shell:true under the hood on Windows) via the run() helper
// so we avoid the Node DEP0190 shell-concatenation deprecation warning.
run(`npx electron-builder --win --publish=never --config "${partialCfgPath}"`);

// run() calls execSync which throws on non-zero exit, so if we reach this
// point electron-builder succeeded.

// ── 4. Copy installer artifacts back to release/ ─────────────────────────────

log('\nCopying artifacts to release/ ...');

// Artifact names are computed from the version in package.json – never hardcoded.
const ARTIFACTS = [
  `Space-Setup-${VERSION}.exe`,
  `Space-Setup-${VERSION}.exe.blockmap`,
  `Space-Portable-${VERSION}.exe`,
  'builder-debug.yml',
  'builder-effective-config.yaml',
  // latest.yml is required by electron-updater to detect new releases
  'latest.yml',
];

let copied = 0;
for (const name of ARTIFACTS) {
  const src = path.join(TEMP_OUT, name);
  if (fs.existsSync(src)) {
    const dst = path.join(RELEASE, name);
    fs.copyFileSync(src, dst);
    const sizeMB = (fs.statSync(dst).size / 1024 / 1024).toFixed(1);
    log(`  \u2713 ${name}  (${sizeMB} MB)`);
    copied++;
  } else {
    log(`  - ${name} not found (skipped)`);
  }
}

if (copied === 0) {
  process.stderr.write('[dist-win] No artifacts found in temp output!\n');
  process.exit(1);
}

log(`\n\u2705  Build complete (v${VERSION}).  ${copied} artifact(s) in ${RELEASE}\n`);
log('Next steps:');
log(`  1. Upload Space-Setup-${VERSION}.exe, Space-Setup-${VERSION}.exe.blockmap`);
log('     and latest.yml to your GitHub release.');
log('  2. Increment the version in package.json for the next release.');
