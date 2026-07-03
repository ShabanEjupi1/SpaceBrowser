const fs = require('fs');

let src = fs.readFileSync('dist/main/extension-manager.js', 'utf8');

let startIndex = src.indexOf('exports.BUILT_IN_EXTENSIONS = [');
let endIndex = src.indexOf('exports.extensionManager = new ExtensionManager();');

let extensionsArray = src.substring(startIndex, endIndex);

// We need to convert from JS to TS structure

let finalCode = \import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { prefsStore } from './main';

export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  category?: 'productivity' | 'developer' | 'ai' | 'privacy' | 'theme' | 'other';
  icon?: string;
  permissions?: string[];
  contentScript?: string;
  backgroundScript?: string;
  rating?: number;
  installs?: number;
  tags?: string[];
  _installed?: boolean;
  _enabled?: boolean;
}

export interface InstalledExtension {
  id: string;
  enabled: boolean;
  pinned: boolean; // Pinned to toolbar
}

export const BUILT_IN_EXTENSIONS: ExtensionManifest[] = [\;

// Let's get the array contents exactly (it was compiled from ts so it's close)
let arrStart = extensionsArray.indexOf('[');
let arrEnd = extensionsArray.lastIndexOf(';');
let arrString = extensionsArray.substring(arrStart, arrEnd);

// There are probably places where TS syntax is required but we can just use any type if needed
// Actually, let's just make it simple.
finalCode += arrString.substring(1) + \;

let marketplaceData = [...BUILT_IN_EXTENSIONS];

export class ExtensionManager {
  private exts = new Map<string, InstalledExtension>();

  constructor() {
    this.loadState();
  }

  private loadState() {
    const raw = (prefsStore.store as any).extensions || {};
    for (const [id, data] of Object.entries(raw)) {
      this.exts.set(id, data as InstalledExtension);
    }
  }

  private saveState() {
    prefsStore.set('extensions', Object.fromEntries(this.exts));
  }

  listMarketplace(): ExtensionManifest[] {
    return marketplaceData.map(ext => {
      const installed = this.exts.get(ext.id);
      return {
        ...ext,
        _installed: !!installed,
        _enabled: installed?.enabled ?? false,
      };
    });
  }

  listInstalled(): InstalledExtension[] {
    const installed = Array.from(this.exts.values());
    return installed.map(inst => {
      const mn = marketplaceData.find(m => m.id === inst.id);
      return { ...inst, ...mn };
    });
  }

  getInstalled(id: string): InstalledExtension | undefined {
    return this.exts.get(id);
  }

  install(id: string): InstalledExtension {
    if (this.exts.has(id)) return this.exts.get(id)!;
    const manifest = marketplaceData.find(m => m.id === id);
    if (!manifest) throw new Error(\\\Extension not found: \\\\);

    const newExt: InstalledExtension = {
      id: manifest.id,
      enabled: true,
      pinned: true,
    };
    this.exts.set(id, newExt);
    this.saveState();
    console.log(\\\[ExtensionManager] Installed \\\\);
    return newExt;
  }

  uninstall(id: string): void {
    if (this.exts.has(id)) {
      this.exts.delete(id);
      this.saveState();
      console.log(\\\[ExtensionManager] Uninstalled \\\\);
    }
  }

  toggle(id: string, forceEnabled?: boolean): InstalledExtension | undefined {
    const ext = this.exts.get(id);
    if (!ext) return;
    ext.enabled = forceEnabled ?? !ext.enabled;
    this.saveState();
    return ext;
  }

  setPin(id: string, pinned: boolean): InstalledExtension | undefined {
    const ext = this.exts.get(id);
    if (!ext) return;
    ext.pinned = pinned;
    this.saveState();
    return ext;
  }

  getEnabledContentScripts(): { id: string; code: string }[] {
    const active = [];
    for (const [id, ext] of this.exts.entries()) {
      if (ext.enabled) {
        const manifest = marketplaceData.find(m => m.id === id);
        if (manifest?.contentScript) {
          active.push({ id, code: manifest.contentScript });
        }
      }
    }
    return active;
  }
}

export const extensionManager = new ExtensionManager();
\;

fs.writeFileSync('src/main/extension-manager.ts', finalCode);
