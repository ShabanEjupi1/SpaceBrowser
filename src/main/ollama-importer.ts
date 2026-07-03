/**
 * Space Browser – Ollama Model Importer
 * -----------------------------------------------
 * Discovers locally installed Ollama models and
 * maps their binary blobs to usable GGUF file paths.
 *
 * Ollama stores models as content-addressed blobs under:
 *   %USERPROFILE%\.ollama\models\blobs\sha256-<hash>
 * and manifests under:
 *   %USERPROFILE%\.ollama\models\manifests\registry.ollama.ai\library\<name>\<tag>
 *
 * The GGUF layer has mediaType:
 *   application/vnd.ollama.image.model
 *
 * This module reads all manifests, locates the GGUF blobs,
 * and returns ModelInfo-compatible objects that can be fed
 * directly into the AIEngine.
 */

import fs   from 'fs';
import path from 'path';
import os   from 'os';

export interface OllamaModelInfo {
  /** Stable ID that AIEngine will use (e.g. "llama3.2:3b") */
  id: string;
  /** Human-readable name */
  name: string;
  /** Absolute path to the GGUF blob */
  blobPath: string;
  /** Byte size of the blob */
  fileSizeBytes: number;
  /** e.g. "llama" derived from the model family */
  arch: string;
  /** Human description */
  description: string;
  /** Short tag (e.g. "3b", "latest", "7b") */
  tag: string;
  /** Registry library name (e.g. "llama3.2") */
  family: string;
}

// ── Path resolution ────────────────────────────────────────────────────────────

function getOllamaRootDir(): string {
  // Windows: %USERPROFILE%\.ollama
  // macOS/Linux: $HOME/.ollama
  return path.join(os.homedir(), '.ollama');
}

export function getOllamaManifestsDir(): string {
  return path.join(getOllamaRootDir(), 'models', 'manifests');
}

export function getOllamaBlobsDir(): string {
  return path.join(getOllamaRootDir(), 'models', 'blobs');
}

/** True if Ollama appears to be installed on this machine */
export function isOllamaInstalled(): boolean {
  return fs.existsSync(getOllamaBlobsDir());
}

// ── Manifest parsing ───────────────────────────────────────────────────────────

interface ManifestLayer {
  mediaType: string;
  digest: string;   // "sha256:<hex>"
  size: number;
}

interface OllamaManifest {
  schemaVersion: number;
  mediaType: string;
  config: ManifestLayer;
  layers: ManifestLayer[];
}

/** Convert "sha256:abcd1234..." → "sha256-abcd1234..." (Ollama blob file naming) */
function digestToFilename(digest: string): string {
  return digest.replace(':', '-');
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Scans all Ollama manifests and returns info about every model
 * that has a GGUF blob present on disk.
 */
export function scanOllamaModels(): OllamaModelInfo[] {
  const manifestsRoot = getOllamaManifestsDir();
  const blobsDir      = getOllamaBlobsDir();
  const results: OllamaModelInfo[] = [];

  if (!fs.existsSync(manifestsRoot) || !fs.existsSync(blobsDir)) {
    return results;
  }

  // Walk: <manifestsRoot>/<registry>/<namespace>/<family>/<tag>
  try {
    const registries = readdirSafe(manifestsRoot);
    for (const registry of registries) {
      const regPath = path.join(manifestsRoot, registry);
      if (!isDir(regPath)) continue;

      const namespaces = readdirSafe(regPath);
      for (const ns of namespaces) {
        const nsPath = path.join(regPath, ns);
        if (!isDir(nsPath)) continue;

        const families = readdirSafe(nsPath);
        for (const family of families) {
          const familyPath = path.join(nsPath, family);
          if (!isDir(familyPath)) continue;

          const tags = readdirSafe(familyPath);
          for (const tag of tags) {
            const manifestPath = path.join(familyPath, tag);
            if (isDir(manifestPath)) continue; // skip sub-dirs

            const info = parseManifestFile(manifestPath, family, tag, blobsDir);
            if (info) results.push(info);
          }
        }
      }
    }
  } catch (err) {
    console.error('[OllamaImporter] Scan error:', err);
  }

  return results;
}

/**
 * Given a family+tag and the blobs dir, parse a single manifest
 * and return an OllamaModelInfo if a GGUF blob exists.
 */
function parseManifestFile(
  manifestPath: string,
  family: string,
  tag: string,
  blobsDir: string,
): OllamaModelInfo | null {
  try {
    const raw: OllamaManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

    // Find the GGUF model layer
    const modelLayer = raw.layers?.find(
      l => l.mediaType === 'application/vnd.ollama.image.model'
    );
    if (!modelLayer) return null;

    const blobFileName = digestToFilename(modelLayer.digest);
    const blobPath     = path.join(blobsDir, blobFileName);
    if (!fs.existsSync(blobPath)) return null;

    const id   = `ollama:${family}:${tag}`;
    const name = formatModelName(family, tag);
    const arch = inferArch(family);

    return {
      id,
      name,
      blobPath,
      fileSizeBytes: modelLayer.size,
      arch,
      description: buildDescription(family, tag, modelLayer.size),
      tag,
      family,
    };
  } catch {
    return null;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function readdirSafe(dir: string): string[] {
  try { return fs.readdirSync(dir); } catch { return []; }
}

function isDir(p: string): boolean {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function formatModelName(family: string, tag: string): string {
  // "llama3.2" + "3b" → "Llama 3.2 3B"
  const familyFormatted = family
    .replace(/(\d)(\d)/g, '$1.$2')  // separate digit sequences with a dot
    .replace(/[-_]/g, ' ')
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  const tagFormatted = tag === 'latest'
    ? ''
    : ' ' + tag.toUpperCase().replace(/B$/, 'B');

  return `${familyFormatted}${tagFormatted}`.trim();
}

function inferArch(family: string): string {
  const f = family.toLowerCase();
  if (f.startsWith('llama'))          return 'llama';
  if (f.startsWith('mistral'))        return 'mistral';
  if (f.startsWith('phi'))            return 'phi';
  if (f.startsWith('qwen'))           return 'qwen2';
  if (f.startsWith('deepseek'))       return 'deepseek';
  if (f.startsWith('codellama'))      return 'llama';
  if (f.startsWith('llava'))          return 'llava';
  if (f.startsWith('nemotron'))       return 'llama';
  if (f.startsWith('gemma'))          return 'gemma';
  if (f.startsWith('falcon'))         return 'falcon';
  if (f.startsWith('vicuna'))         return 'llama';
  if (f.startsWith('gpt'))            return 'gpt2';
  return family.toLowerCase().split(/[-_\d]/)[0] || 'unknown';
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

function buildDescription(family: string, tag: string, sizeBytes: number): string {
  return `Ollama · ${family}:${tag} · ${formatBytes(sizeBytes)}`;
}
