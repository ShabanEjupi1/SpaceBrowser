/**
 * Space Browser – AI Settings Component
 */

import React, { useState, useEffect } from 'react';
import styles from '../styles/AISettings.module.scss';

interface SearchEngineOption { key: string; name: string; }

interface Props {
  systemPrompt: string;
  onSystemPromptChange: (prompt: string) => void;
}

export const AISettings: React.FC<Props> = ({ systemPrompt, onSystemPromptChange }) => {
  const api = (window as any).spaceAPI;

  const [temperature, setTemperature] = useState(0.7);
  const [topP, setTopP]               = useState(0.9);
  const [topK, setTopK]               = useState(40);
  const [nPredict, setNPredict]       = useState(512);
  const [nCtx, setNCtx]               = useState(4096);
  const [nGpuLayers, setNGpuLayers]   = useState(0);
  const [systemPromptLocal, setSystemPromptLocal] = useState(systemPrompt);
  const [modelsDir, setModelsDir]     = useState('');
  const [saved, setSaved]             = useState(false);
  const [searchEngines, setSearchEngines] = useState<SearchEngineOption[]>([]);
  const [currentEngine, setCurrentEngine] = useState('space');

  useEffect(() => {
    if (!api?.browser) return;
    Promise.all([
      api.browser.getSearchEngines(),
      api.browser.getSearchEngine(),
    ]).then(([engines, current]: [SearchEngineOption[], string]) => {
      setSearchEngines(engines);
      setCurrentEngine(current);
    }).catch(() => {});
  }, []);

  const handleSave = async () => {
    onSystemPromptChange(systemPromptLocal);
    await api.ai.updateSettings({
      defaultParams: { temperature, topP, topK, nPredict, nCtx },
      nGpuLayers,
      gpuEnabled: nGpuLayers > 0,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleSelectModelsDir = async () => {
    const dir = await api.dialog.selectModelsDir();
    if (dir) {
      setModelsDir(dir);
      await api.ai.updateSettings({ modelsDir: dir });
    }
  };

  const handleEngineChange = async (key: string) => {
    setCurrentEngine(key);
    await api.browser?.setSearchEngine(key);
  };

  return (
    <div className={styles.settings}>
      <h3 className={styles.sectionTitle}>Generation Parameters</h3>

      <div className={styles.field}>
        <label>Temperature: <strong>{temperature.toFixed(2)}</strong></label>
        <input type="range" min={0} max={2} step={0.05} value={temperature}
               onChange={e => setTemperature(parseFloat(e.target.value))} />
        <span className={styles.hint}>Controls creativity. 0 = deterministic, 1+ = more random.</span>
      </div>

      <div className={styles.field}>
        <label>Top-P: <strong>{topP.toFixed(2)}</strong></label>
        <input type="range" min={0} max={1} step={0.05} value={topP}
               onChange={e => setTopP(parseFloat(e.target.value))} />
      </div>

      <div className={styles.field}>
        <label>Top-K: <strong>{topK}</strong></label>
        <input type="range" min={1} max={100} step={1} value={topK}
               onChange={e => setTopK(parseInt(e.target.value))} />
      </div>

      <div className={styles.field}>
        <label>Max Tokens: <strong>{nPredict}</strong></label>
        <input type="range" min={64} max={4096} step={64} value={nPredict}
               onChange={e => setNPredict(parseInt(e.target.value))} />
      </div>

      <div className={styles.field}>
        <label>Context Window: <strong>{nCtx.toLocaleString()}</strong></label>
        <input type="range" min={512} max={32768} step={512} value={nCtx}
               onChange={e => setNCtx(parseInt(e.target.value))} />
        <span className={styles.hint}>Larger context uses more RAM.</span>
      </div>

      <h3 className={styles.sectionTitle}>Hardware</h3>

      <div className={styles.field}>
        <label>GPU Layers: <strong>{nGpuLayers === -1 ? 'All' : nGpuLayers}</strong></label>
        <input type="range" min={0} max={100} step={1} value={nGpuLayers === -1 ? 100 : nGpuLayers}
               onChange={e => setNGpuLayers(parseInt(e.target.value))} />
        <span className={styles.hint}>
          Number of layers to offload to GPU. Requires CUDA/Metal build. 0 = CPU only.
        </span>
      </div>

      <h3 className={styles.sectionTitle}>System Prompt</h3>
      <div className={styles.field}>
        <textarea
          className={styles.systemPromptArea}
          value={systemPromptLocal}
          onChange={e => setSystemPromptLocal(e.target.value)}
          rows={5}
          aria-label="System prompt"
          placeholder="Enter system prompt…"
        />
      </div>

      <h3 className={styles.sectionTitle}>Search Engine</h3>
      <div className={styles.field}>
        <label>Default search engine</label>
        <div className={styles.engineGrid}>
          {searchEngines.map(e => (
            <button
              key={e.key}
              className={`${styles.engineBtn} ${currentEngine === e.key ? styles.engineActive : ''}`}
              onClick={() => handleEngineChange(e.key)}
            >
              {e.name}
            </button>
          ))}
        </div>
        <span className={styles.hint}>Used when you type a search query in the address bar.</span>
      </div>

      <h3 className={styles.sectionTitle}>Storage</h3>
      <div className={styles.field}>
        <label>Models Directory</label>
        <div className={styles.dirRow}>
          <span className={styles.dirPath}>{modelsDir || '(default: userData/models)'}</span>
          <button className={styles.browseBtn} onClick={handleSelectModelsDir}>Browse…</button>
        </div>
      </div>

      <button
        className={`${styles.saveBtn} ${saved ? styles.saved : ''}`}
        onClick={handleSave}
      >
        {saved ? '✓ Saved' : 'Save Settings'}
      </button>
    </div>
  );
};
