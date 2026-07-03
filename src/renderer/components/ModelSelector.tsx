/**
 * Space Browser – Model Selector Component
 * ----------------------------------------
 * Lists and manages GGUF models, including models
 * discovered from a local Ollama installation.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { ModelInfo } from './AISidebar';
import styles from '../styles/ModelSelector.module.scss';

interface OllamaModelInfo {
  id: string;
  name: string;
  blobPath: string;
  fileSizeBytes: number;
  arch: string;
  description: string;
  tag: string;
  family: string;
}

interface Props {
  models: ModelInfo[];
  activeModelId: string | null;
  isLoading: boolean;
  onLoadModel: (id: string) => void;
  onImport: () => void;
  onRefresh: () => void;
}

const api = (window as any).spaceAPI;

export const ModelSelector: React.FC<Props> = ({
  models, activeModelId, isLoading, onLoadModel, onImport, onRefresh,
}) => {
  const [searchQuery, setSearchQuery]         = useState('');
  const [ollamaModels, setOllamaModels]       = useState<OllamaModelInfo[]>([]);
  const [ollamaAvailable, setOllamaAvailable] = useState(false);
  const [ollamaLoading, setOllamaLoading]     = useState(false);
  const [ollamaError, setOllamaError]         = useState('');
  const [loadingOllamaId, setLoadingOllamaId] = useState<string | null>(null);

  // ── Bootstrap: check if Ollama is installed ──────────────────────────────

  useEffect(() => {
    api?.ai?.ollamaAvailable?.()
      .then((available: boolean) => {
        setOllamaAvailable(available);
        if (available) loadOllamaModels();
      })
      .catch(() => {});
  }, []);

  const loadOllamaModels = useCallback(async () => {
    setOllamaLoading(true);
    setOllamaError('');
    try {
      const list: OllamaModelInfo[] = await api.ai.ollamaModels();
      setOllamaModels(list);
    } catch (err: any) {
      setOllamaError(err?.message ?? 'Failed to load Ollama models');
    } finally {
      setOllamaLoading(false);
    }
  }, []);

  const handleLoadOllamaModel = useCallback(async (id: string) => {
    setLoadingOllamaId(id);
    try {
      const ok = await api.ai.loadOllamaModel(id);
      if (ok) onRefresh();
    } finally {
      setLoadingOllamaId(null);
    }
  }, [onRefresh]);

  // ── Filtering ─────────────────────────────────────────────────────────────

  const q = searchQuery.toLowerCase();

  const filteredLocal = models.filter(m =>
    m.name.toLowerCase().includes(q) || m.arch.toLowerCase().includes(q)
  );

  const filteredOllama = ollamaModels.filter(m =>
    m.name.toLowerCase().includes(q) ||
    m.family.toLowerCase().includes(q) ||
    m.arch.toLowerCase().includes(q) ||
    m.tag.toLowerCase().includes(q)
  );

  return (
    <div className={styles.modelSelector}>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <SearchIcon />
          <input
            className={styles.searchInput}
            type="text"
            placeholder="Search models…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            aria-label="Search models"
          />
        </div>
        <button
          className={styles.iconBtn}
          onClick={() => { onRefresh(); if (ollamaAvailable) loadOllamaModels(); }}
          title="Refresh model list"
          aria-label="Refresh"
        >
          <RefreshIcon />
        </button>
        <button className={styles.importBtn} onClick={onImport} title="Import GGUF file" aria-label="Import model">
          <PlusIcon /> Import
        </button>
      </div>

      {/* ── Ollama Section ─────────────────────────────────────────────────── */}
      {ollamaAvailable && (
        <section className={styles.ollamaSection}>
          <div className={styles.sectionHeader}>
            <OllamaIcon />
            <span className={styles.sectionTitle}>Ollama Models</span>
            <span className={styles.sectionCount}>{ollamaModels.length}</span>
          </div>

          {ollamaLoading && (
            <div className={styles.ollamaStatus}>
              <span className={styles.spinner} /> Scanning Ollama…
            </div>
          )}

          {ollamaError && (
            <div className={styles.ollamaError}>{ollamaError}</div>
          )}

          {!ollamaLoading && filteredOllama.length === 0 && !ollamaError && (
            <div className={styles.empty}>
              {ollamaModels.length === 0
                ? <p className={styles.hint}>No Ollama models found. Pull a model with <code>ollama pull llama3.2</code>.</p>
                : <p>No models match "{searchQuery}"</p>
              }
            </div>
          )}

          {!ollamaLoading && filteredOllama.length > 0 && (
            <div className={styles.modelList} role="list">
              {filteredOllama.map(m => (
                <OllamaModelCard
                  key={m.id}
                  model={m}
                  isActive={m.id === activeModelId}
                  isLoading={loadingOllamaId === m.id}
                  onLoad={() => handleLoadOllamaModel(m.id)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Local GGUF Section ──────────────────────────────────────────────── */}
      <section className={styles.localSection}>
        <div className={styles.sectionHeader}>
          <GGUFIcon />
          <span className={styles.sectionTitle}>Local GGUF Models</span>
          <span className={styles.sectionCount}>{models.length}</span>
        </div>

        {filteredLocal.length === 0 ? (
          <div className={styles.empty}>
            {models.length === 0 ? (
              <>
                <p>No GGUF models in models directory.</p>
                <p className={styles.hint}>
                  Import a <code>.gguf</code> file or download from{' '}
                  <a href="https://huggingface.co/models?library=gguf" target="_blank" rel="noreferrer">
                    HuggingFace
                  </a>.
                </p>
              </>
            ) : (
              <p>No models match "{searchQuery}"</p>
            )}
          </div>
        ) : (
          <div className={styles.modelList} role="list">
            {filteredLocal.map(model => (
              <ModelCard
                key={model.id}
                model={model}
                isActive={model.id === activeModelId}
                isLoading={isLoading}
                onLoad={() => onLoadModel(model.id)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Storage footer */}
      {(models.length + ollamaModels.length) > 0 && (
        <div className={styles.storageInfo}>
          {models.length + ollamaModels.length} model{(models.length + ollamaModels.length) !== 1 ? 's' : ''} ·{' '}
          {formatTotalSize(
            [...models, ...ollamaModels].reduce((sum, m) => sum + m.fileSizeBytes, 0)
          )}
        </div>
      )}
    </div>
  );
};

// ── Local GGUF model card ─────────────────────────────────────────────────────

interface CardProps {
  model: ModelInfo;
  isActive: boolean;
  isLoading: boolean;
  onLoad: () => void;
}

const ModelCard: React.FC<CardProps> = ({ model, isActive, isLoading, onLoad }) => (
  <div
    className={`${styles.modelCard} ${isActive ? styles.active : ''}`}
    role="listitem"
    aria-current={isActive ? 'true' : 'false'}
  >
    <div className={styles.modelInfo}>
      <div className={styles.modelHeader}>
        <span className={styles.modelName}>{model.name}</span>
        {isActive && <span className={styles.activeBadge}>Loaded</span>}
      </div>
      <div className={styles.modelMeta}>
        {model.arch && <span className={styles.metaTag}>{model.arch}</span>}
        <span className={styles.metaTag}>{formatFileSize(model.fileSizeBytes)}</span>
        {model.nCtxTrain > 0 && (
          <span className={styles.metaTag}>{formatCtx(model.nCtxTrain)} ctx</span>
        )}
      </div>
      {model.description && (
        <p className={styles.modelDesc}>{model.description}</p>
      )}
    </div>
    {!isActive && (
      <button
        className={styles.loadBtn}
        onClick={onLoad}
        disabled={isLoading}
        aria-label={`Load ${model.name}`}
      >
        {isLoading ? <span className={styles.spinner} /> : 'Load'}
      </button>
    )}
  </div>
);

// ── Ollama model card ─────────────────────────────────────────────────────────

interface OllamaCardProps {
  model: OllamaModelInfo;
  isActive: boolean;
  isLoading: boolean;
  onLoad: () => void;
}

const OllamaModelCard: React.FC<OllamaCardProps> = ({ model, isActive, isLoading, onLoad }) => (
  <div
    className={`${styles.modelCard} ${styles.ollamaCard} ${isActive ? styles.active : ''}`}
    role="listitem"
    aria-current={isActive ? 'true' : 'false'}
  >
    <div className={styles.modelInfo}>
      <div className={styles.modelHeader}>
        <span className={styles.modelName}>{model.name}</span>
        <span className={styles.ollamaBadge}>Ollama</span>
        {isActive && <span className={styles.activeBadge}>Loaded</span>}
      </div>
      <div className={styles.modelMeta}>
        {model.arch && <span className={styles.metaTag}>{model.arch}</span>}
        <span className={styles.metaTag}>{formatFileSize(model.fileSizeBytes)}</span>
        <span className={`${styles.metaTag} ${styles.metaTagMono}`}>{model.family}:{model.tag}</span>
      </div>
    </div>
    {!isActive && (
      <button
        className={styles.loadBtn}
        onClick={onLoad}
        disabled={isLoading}
        aria-label={`Load ${model.name}`}
      >
        {isLoading ? <span className={styles.spinner} /> : 'Load'}
      </button>
    )}
  </div>
);

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

function formatTotalSize(bytes: number): string {
  return formatFileSize(bytes) + ' total';
}

function formatCtx(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
  return `${n}`;
}

// ── Icons ──────────────────────────────────────────────────────────────────────

const SearchIcon  = () => <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="6.5" cy="6.5" r="4.5" /><line x1="10" y1="10" x2="14" y2="14" /></svg>;
const RefreshIcon = () => <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M13 8A5 5 0 1 1 8 3h3m0 0V1m0 2H9" /></svg>;
const PlusIcon    = () => <svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="7" y1="2" x2="7" y2="12" /><line x1="2" y1="7" x2="12" y2="7" /></svg>;

const OllamaIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="10" stroke="#34d399" strokeWidth="1.5" />
    <path d="M8 12a4 4 0 0 1 8 0" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="9" cy="13.5" r="1.2" fill="#34d399" />
    <circle cx="15" cy="13.5" r="1.2" fill="#34d399" />
  </svg>
);

const GGUFIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
    <rect x="4" y="3" width="12" height="16" rx="1.5" stroke="#a78bfa" strokeWidth="1.5" />
    <path d="M8 8h6M8 11h4M8 14h5" stroke="#a78bfa" strokeWidth="1.3" strokeLinecap="round" />
    <path d="M14 3v4h4" stroke="#a78bfa" strokeWidth="1.3" strokeLinejoin="round" />
  </svg>
);


