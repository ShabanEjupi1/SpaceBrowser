/**
 * Space Browser – AI Engine (TypeScript wrapper)
 * ------------------------------------------------
 * Wraps the native GGUF inference addon.
 * Runs in the Electron main process.
 * Communicates with renderers via IPC.
 */

import path from 'path';
import fs   from 'fs';
import { app } from 'electron';
import Store from 'electron-store';
import {
  scanOllamaModels,
  isOllamaInstalled,
  OllamaModelInfo,
} from '../main/ollama-importer';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ModelInfo {
  id: string;
  name: string;
  path: string;
  arch: string;
  description: string;
  fileSizeBytes: number;
  nParams: number;
  nCtxTrain: number;
  nVocab: number;
  hasGpuSupport: boolean;
  chatTemplate: string;
  lastUsed: string;
}

export interface GenerationParams {
  nPredict?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  repeatPenalty?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  nCtx?: number;
  nThreads?: number;
  nGpuLayers?: number;
  stream?: boolean;
  stopToken?: string;
  stopSequences?: string[];
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type TokenCallback = (token: string, isFinal: boolean) => void;

interface AIEngineSettings {
  modelsDir: string;
  activeModelId: string | null;
  defaultParams: GenerationParams;
  gpuEnabled: boolean;
  nGpuLayers: number;
}

// ── Default settings ──────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: AIEngineSettings = {
  modelsDir: '',
  activeModelId: null,
  defaultParams: {
    nPredict: 512,
    temperature: 0.7,
    topP: 0.9,
    topK: 40,
    repeatPenalty: 1.1,
    nCtx: 4096,
    nGpuLayers: 0,
    stream: true,
  },
  gpuEnabled: false,
  nGpuLayers: 0,
};

// ── AIEngine class ────────────────────────────────────────────────────────────

export class AIEngine {
  private addon: any;
  private settings: Store<AIEngineSettings>;
  private modelsDir: string;
  private isGenerating = false;

  constructor() {
    // Resolve the native addon path
    const addonPath = this.resolveAddonPath();
    const addonDir  = path.dirname(addonPath);

    // On Windows, add the addon directory AND the extraResources directory to
    // the DLL search path so that ggml-base.dll, ggml-cpu.dll, ggml.dll and
    // llama.dll are found regardless of whether they are in extraResources or
    // in the asarUnpacked path.
    if (process.platform === 'win32') {
      try {
        const extraResourcesDllDir = app.isPackaged
          ? path.join(process.resourcesPath, 'build', 'Release')
          : addonDir;
        const asarUnpackedDllDir = app.isPackaged
          ? path.join(process.resourcesPath, 'app.asar.unpacked', 'build', 'Release')
          : addonDir;
        const pathParts = [addonDir, extraResourcesDllDir, asarUnpackedDllDir, process.env.PATH || ''];
        process.env.PATH = [...new Set(pathParts)].join(';');
      } catch { /* non-critical */ }
    }

    try {
      this.addon = require(addonPath);
      console.log('[AIEngine] Native inference addon loaded from:', addonPath);
    } catch (err) {
      console.error('[AIEngine] Failed to load native addon:', err);
      console.error('[AIEngine] Run: npm run build:native');
      this.addon = null;
    }

    // Persistent settings via electron-store
    this.settings = new Store<AIEngineSettings>({
      name: 'ai-engine',
      defaults: DEFAULT_SETTINGS,
    });

    // Default models directory: <userData>/models
    const defaultModelsDir = path.join(app.getPath('userData'), 'models');
    this.modelsDir = this.settings.get('modelsDir') || defaultModelsDir;
    this.settings.set('modelsDir', this.modelsDir);
  }

  // ── Initialization ──────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (!this.addon) {
      console.warn('[AIEngine] Addon not available – inference disabled');
      return;
    }
    await this.scanModels();

    const activeId = this.settings.get('activeModelId');
    if (activeId) {
      const models = this.listModels();
      const model = models.find(m => m.id === activeId);
      if (model) {
        await this.loadModel(model.id);
      }
    }
  }

  // ── Model Management ────────────────────────────────────────────────────────

  async scanModels(): Promise<ModelInfo[]> {
    if (!this.addon) return [];
    try {
      return this.addon.scanModels(this.modelsDir) as ModelInfo[];
    } catch (err) {
      console.error('[AIEngine] scanModels failed:', err);
      return [];
    }
  }

  // ── Ollama Integration ──────────────────────────────────────────────────────

  /** Whether Ollama is installed on this machine */
  hasOllama(): boolean {
    return isOllamaInstalled();
  }

  /**
   * Returns all models found in Ollama's local blob store.
   * Does NOT require the addon – metadata is read from Ollama manifests.
   */
  getOllamaModels(): OllamaModelInfo[] {
    return scanOllamaModels();
  }

  /**
   * Loads an Ollama model by pointing the addon at its GGUF blob path.
   * Ollama blob files ARE valid GGUF files – they are the raw model weights.
   */
  async loadOllamaModel(
    ollamaId: string,
    params?: Partial<GenerationParams>,
  ): Promise<boolean> {
    if (!this.addon) return false;

    const ollamaModels = this.getOllamaModels();
    const om = ollamaModels.find(m => m.id === ollamaId);
    if (!om) {
      console.error('[AIEngine] Ollama model not found:', ollamaId);
      return false;
    }

    if (!fs.existsSync(om.blobPath)) {
      console.error('[AIEngine] Ollama blob missing at:', om.blobPath);
      return false;
    }

    const defaultParams = this.settings.get('defaultParams');
    const mergedParams: GenerationParams = {
      ...defaultParams,
      ...params,
      nGpuLayers: this.settings.get('gpuEnabled') ? this.settings.get('nGpuLayers') : 0,
    };

    console.log(`[AIEngine] Loading Ollama model: ${om.name} from ${om.blobPath}`);
    const ok = this.addon.loadModel(om.blobPath, mergedParams) as boolean;
    if (ok) {
      this.settings.set('activeModelId', ollamaId);
    }
    return ok;
  }

  listModels(): ModelInfo[] {
    if (!this.addon) return [];
    try {
      return this.addon.listModels() as ModelInfo[];
    } catch {
      return [];
    }
  }

  async addModel(sourcePath: string, modelId?: string): Promise<ModelInfo | null> {
    if (!this.addon) return null;
    try {
      return this.addon.addModel(sourcePath, modelId ?? '') as ModelInfo;
    } catch (err) {
      console.error('[AIEngine] addModel failed:', err);
      return null;
    }
  }

  async removeModel(modelId: string): Promise<boolean> {
    if (!this.addon) return false;
    if (this.addon.isLoaded() && this.getActiveModelId() === modelId) {
      this.addon.unloadModel();
      this.settings.set('activeModelId', null);
    }
    return this.addon.removeModel(modelId) as boolean;
  }

  async loadModel(modelId: string, params?: Partial<GenerationParams>): Promise<boolean> {
    if (!this.addon) return false;

    const models = this.listModels();
    const model = models.find(m => m.id === modelId);
    if (!model) {
      console.error('[AIEngine] Model not found:', modelId);
      return false;
    }

    const defaultParams = this.settings.get('defaultParams');
    const mergedParams: GenerationParams = {
      ...defaultParams,
      ...params,
      nGpuLayers: this.settings.get('gpuEnabled') ? this.settings.get('nGpuLayers') : 0,
    };

    console.log(`[AIEngine] Loading model: ${model.name} (${model.arch})`);
    const ok = this.addon.loadModel(model.path, mergedParams) as boolean;
    if (ok) {
      this.settings.set('activeModelId', modelId);
    }
    return ok;
  }

  unloadModel(): void {
    if (this.addon) {
      this.addon.unloadModel();
      this.settings.set('activeModelId', null);
    }
  }

  isLoaded(): boolean {
    return this.addon?.isLoaded() ?? false;
  }

  getActiveModelId(): string | null {
    return this.settings.get('activeModelId');
  }

  getModelMetadata(): Record<string, unknown> {
    if (!this.addon) return {};
    try {
      const json = this.addon.getModelMetadata() as string;
      return JSON.parse(json);
    } catch {
      return {};
    }
  }

  // ── Inference ───────────────────────────────────────────────────────────────

  async generate(
    prompt: string,
    params: Partial<GenerationParams>,
    onToken: TokenCallback
  ): Promise<void> {
    if (!this.addon || !this.isLoaded()) {
      throw new Error('No model loaded. Load a model first.');
    }
    if (this.isGenerating) {
      throw new Error('Already generating. Call abort() first.');
    }

    this.isGenerating = true;
    const mergedParams = { ...this.settings.get('defaultParams'), ...params };

    return new Promise<void>((resolve, reject) => {
      try {
        this.addon.generate(prompt, mergedParams, (token: string, isFinal: boolean) => {
          onToken(token, isFinal);
          if (isFinal) {
            this.isGenerating = false;
            resolve();
          }
        });
      } catch (err) {
        this.isGenerating = false;
        reject(err);
      }
    });
  }

  async chat(
    messages: ChatMessage[],
    params: Partial<GenerationParams>,
    onToken: TokenCallback
  ): Promise<void> {
    if (!this.addon || !this.isLoaded()) {
      throw new Error('No model loaded. Load a model first.');
    }
    if (this.isGenerating) {
      throw new Error('Already generating. Call abort() first.');
    }

    this.isGenerating = true;
    const mergedParams = { ...this.settings.get('defaultParams'), ...params };

    return new Promise<void>((resolve, reject) => {
      try {
        this.addon.chat(messages, mergedParams, (token: string, isFinal: boolean) => {
          onToken(token, isFinal);
          if (isFinal) {
            this.isGenerating = false;
            resolve();
          }
        });
      } catch (err) {
        this.isGenerating = false;
        reject(err);
      }
    });
  }

  abort(): void {
    if (this.addon) {
      this.addon.abort();
      this.isGenerating = false;
    }
  }

  countTokens(text: string): number {
    if (!this.addon) return 0;
    return this.addon.countTokens(text) as number;
  }

  // ── Settings ────────────────────────────────────────────────────────────────

  getSettings(): AIEngineSettings {
    return {
      modelsDir: this.modelsDir,
      activeModelId: this.settings.get('activeModelId'),
      defaultParams: this.settings.get('defaultParams'),
      gpuEnabled: this.settings.get('gpuEnabled'),
      nGpuLayers: this.settings.get('nGpuLayers'),
    };
  }

  updateSettings(patch: Partial<AIEngineSettings>): void {
    if (patch.modelsDir) {
      this.modelsDir = patch.modelsDir;
      this.settings.set('modelsDir', patch.modelsDir);
    }
    if (patch.defaultParams) {
      this.settings.set('defaultParams', { ...this.settings.get('defaultParams'), ...patch.defaultParams });
    }
    if (patch.gpuEnabled !== undefined) {
      this.settings.set('gpuEnabled', patch.gpuEnabled);
    }
    if (patch.nGpuLayers !== undefined) {
      this.settings.set('nGpuLayers', patch.nGpuLayers);
    }
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private resolveAddonPath(): string {
    if (app.isPackaged) {
      // electron-builder places extraResources at <resourcesPath>/build/Release/
      // (the "to" field in the extraResources config is "build/Release").
      const resourcesPath = path.join(
        process.resourcesPath,
        'build',
        'Release',
        'space_inference.node',
      );
      if (fs.existsSync(resourcesPath)) return resourcesPath;

      // Fallback: asarUnpack path inside app.asar.unpacked
      const asarUnpackedPath = path.join(
        process.resourcesPath,
        'app.asar.unpacked',
        'build',
        'Release',
        'space_inference.node',
      );
      if (fs.existsSync(asarUnpackedPath)) return asarUnpackedPath;

      // Last resort: beside the executable
      return resourcesPath;
    }
    // In development – addon is built at <project-root>/build/Release/
    return path.join(__dirname, '..', '..', 'build', 'Release', 'space_inference.node');
  }
}

// Singleton export
export const aiEngine = new AIEngine();
