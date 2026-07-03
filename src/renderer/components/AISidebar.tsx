/**
 * Space Browser – AI Sidebar Component (Spaceship Engine)
 * ─────────────────────────────────────────────────────────
 * Full-featured AI chat panel with:
 *  - Model selector / loader  ·  Multi-turn streaming chat
 *  - Page summarization  ·  Context-aware prompting
 *  - Engine status indicator  ·  Token counter
 *  - Conversation export (Markdown)  ·  Keyboard shortcut hints
 *  - Generation parameter controls
 *
 * Visual identity: amber / teal cockpit – clearly distinct from Space cobalt blue.
 */

import React, {
  useState, useEffect, useRef, useCallback, useId
} from 'react';
import { ModelSelector }  from './ModelSelector';
import { ChatMessages }   from './ChatMessages';
import { ChatInput }      from './ChatInput';
import { AISettings }     from './AISettings';
import styles             from '../styles/AISidebar.module.scss';

export interface Message {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  error?: string;
  timestamp: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  arch: string;
  fileSizeBytes: number;
  nCtxTrain: number;
  description: string;
}

type SidebarView = 'chat' | 'models' | 'settings';

const api = (window as any).spaceAPI ?? null;

interface Props {
  pageUrl?: string;
  pageTitle?: string;
  onClose: () => void;
}

export const AISidebar: React.FC<Props> = ({ pageUrl, pageTitle, onClose }) => {
  const [view, setView]                 = useState<SidebarView>('chat');
  const [models, setModels]             = useState<ModelInfo[]>([]);
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [isLoadingModel, setIsLoadingModel] = useState(false);
  const [messages, setMessages]         = useState<Message[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [tokenCount, setTokenCount]     = useState(0);
  const [exportFlash, setExportFlash]   = useState(false);
  const [systemPrompt, setSystemPrompt] = useState(
    'You are a helpful AI assistant embedded in the Space browser. ' +
    'Be concise, accurate, and helpful. When the user shares a URL or page title, ' +
    'you can reference it in your response. ' +
    'Respond directly to the user — do not narrate your reasoning process, ' +
    'do not ask yourself questions, and never output template tokens like ' +
    '<|im_start|>, <|im_end|>, [INST], or similar markers.'
  );

  const requestIdRef = useRef<string>('');
  const abortCleanupRef = useRef<(() => void) | null>(null);

  // ── Bootstrap ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!api) return;
    loadModelsAndState();

    // Subscribe to AI token stream
    const cleanup = api.ai.onToken((data: any) => {
      if (data.requestId !== requestIdRef.current) return;

      if (data.error) {
        setMessages(prev => prev.map(m =>
          m.isStreaming ? { ...m, isStreaming: false, error: data.error } : m
        ));
        setIsGenerating(false);
        return;
      }

      if (data.isFinal) {
        setMessages(prev => prev.map(m =>
          m.isStreaming ? { ...m, isStreaming: false } : m
        ));
        setIsGenerating(false);
      } else {
        setMessages(prev => prev.map(m =>
          m.isStreaming
            ? { ...m, content: m.content + data.token }
            : m
        ));
      }
    });

    abortCleanupRef.current = cleanup;
    return () => cleanup?.();
  }, []);

  const loadModelsAndState = async () => {
    if (!api) return;
    const [modelList, loaded, activeId, ollamaAvailable] = await Promise.all([
      api.ai.listModels(),
      api.ai.isLoaded(),
      api.ai.getActiveModelId(),
      api.ai.ollamaAvailable?.() ?? Promise.resolve(false),
    ]);

    let allModels = [...modelList];

    // Merge in Ollama models so the quick-load list in the no-model prompt is complete
    if (ollamaAvailable) {
      try {
        const ollamaList = await api.ai.ollamaModels();
        // Map OllamaModelInfo shape to the ModelInfo shape expected by NoModelPrompt
        const mapped = ollamaList.map((m: any) => ({
          id: m.id,
          name: m.name,
          arch: m.arch,
          fileSizeBytes: m.fileSizeBytes,
          nCtxTrain: 0,
          description: m.description,
        }));
        allModels = [...allModels, ...mapped];
      } catch { /* non-critical */ }
    }

    setModels(allModels);
    setIsModelLoaded(loaded);
    setActiveModelId(activeId);
  };

  // ── Model Loading ──────────────────────────────────────────────────────────

  const handleLoadModel = useCallback(async (modelId: string) => {
    setIsLoadingModel(true);
    try {
      // Route to the correct IPC handler based on model ID prefix
      const ok = modelId.startsWith('ollama:')
        ? await api.ai.loadOllamaModel(modelId)
        : await api.ai.loadModel(modelId);
      if (ok) {
        setActiveModelId(modelId);
        setIsModelLoaded(true);
        setMessages([]); // Reset chat on model change
      }
    } finally {
      setIsLoadingModel(false);
    }
  }, []);

  const handleImportModel = useCallback(async () => {
    const filePath = await api.dialog.openGGUF();
    if (!filePath) return;
    const info = await api.ai.addModel(filePath);
    if (info) {
      const refreshed = await api.ai.listModels();
      setModels(refreshed);
    }
  }, []);

  // ── Chat ───────────────────────────────────────────────────────────────────

  const handleSend = useCallback(async (userText: string) => {
    if (!userText.trim() || isGenerating) return;
    if (!isModelLoaded) return;

    const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    requestIdRef.current = requestId;

    // Build messages array
    const userMsg: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: userText.trim(),
      timestamp: Date.now(),
    };

    const assistantMsg: Message = {
      id: `msg-${Date.now() + 1}`,
      role: 'assistant',
      content: '',
      isStreaming: true,
      timestamp: Date.now() + 1,
    };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setIsGenerating(true);

    // Construct messages for the API
    const apiMessages = [
      { role: 'system', content: buildSystemPrompt(systemPrompt, pageUrl, pageTitle) },
      ...messages
        .filter(m => !m.isStreaming && !m.error && m.role !== 'system')
        .map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: userText.trim() },
    ];

    await api.ai.chat(apiMessages, { nPredict: 1024, stream: true }, requestId);
  }, [isGenerating, isModelLoaded, messages, systemPrompt, pageUrl, pageTitle]);

  const handleAbort = useCallback(async () => {
    await api.ai.abort();
    setMessages(prev => prev.map(m =>
      m.isStreaming ? { ...m, isStreaming: false, content: m.content + ' [stopped]' } : m
    ));
    setIsGenerating(false);
  }, []);

  const handleClearChat = useCallback(() => {
    setMessages([]);
    setTokenCount(0);
  }, []);

  const handleSummarizePage = useCallback(() => {
    if (!pageUrl || !pageTitle) return;
    handleSend(`Please summarize the page I'm currently viewing:\n\nTitle: ${pageTitle}\nURL: ${pageUrl}`);
  }, [pageUrl, pageTitle, handleSend]);

  // ── Token counter (estimate from visible messages) ─────────────────────────

  useEffect(() => {
    const total = messages
      .filter(m => !m.isStreaming && m.role !== 'system')
      .reduce((acc, m) => acc + Math.ceil(m.content.length / 4), 0);
    setTokenCount(total);
  }, [messages]);

  // ── Conversation export ────────────────────────────────────────────────────

  const handleExport = useCallback(() => {
    const visible = messages.filter(m => m.role !== 'system' && !m.isStreaming && !m.error);
    if (visible.length === 0) return;
    const md = visible.map(m => {
      const who = m.role === 'user' ? '**You**' : '**Spaceship AI**';
      return `${who}\n\n${m.content}`;
    }).join('\n\n---\n\n');

    const blob = new Blob([`# Space AI Conversation\n\n_Exported from Space Browser_\n\n---\n\n${md}`], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `space-ai-chat-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);

    setExportFlash(true);
    setTimeout(() => setExportFlash(false), 1200);
  }, [messages]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const userMsgCount = messages.filter(m => m.role === 'user').length;

  return (
    <div className={styles.sidebar}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <SidebarSparkIcon />
          <span className={styles.headerTitle}>Spaceship</span>
          {activeModelId && (
            <span className={styles.modelBadge} title={activeModelId}>
              {getShortModelName(activeModelId)}
            </span>
          )}
        </div>
        <div className={styles.headerActions}>
          {/* Export conversation */}
          {messages.filter(m => m.role !== 'system').length > 0 && (
            <button
              className={`${styles.iconBtn} ${exportFlash ? styles.exportFlash : ''}`}
              onClick={handleExport}
              title="Export conversation as Markdown"
              aria-label="Export conversation"
            >
              <ExportIcon />
            </button>
          )}
          <button
            className={styles.iconBtn}
            onClick={handleClearChat}
            title="Clear conversation"
            aria-label="Clear conversation"
          >
            <TrashIcon />
          </button>
          <button
            className={styles.iconBtn}
            onClick={onClose}
            title="Close sidebar (Ctrl+Shift+A)"
            aria-label="Close sidebar"
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      {/* Engine status bar */}
      <div className={styles.statusBar}>
        <span className={`${styles.statusDot} ${isModelLoaded ? (isGenerating ? styles.statusGenerating : styles.statusReady) : styles.statusIdle}`} />
        <span className={styles.statusLabel}>
          {isGenerating ? 'Generating…' : isModelLoaded ? 'Ready' : 'No model'}
        </span>
        {tokenCount > 0 && (
          <span className={styles.tokenCounter} title="Estimated tokens in conversation">
            ~{tokenCount.toLocaleString()} tokens
          </span>
        )}
      </div>

      {/* Navigation tabs */}
      <div className={styles.navTabs} role="tablist">
        {(['chat', 'models', 'settings'] as SidebarView[]).map(v => (
          <button
            key={v}
            className={`${styles.navTab} ${view === v ? styles.active : ''}`}
            onClick={() => setView(v)}
            role="tab"
            aria-selected={view === v}
          >
            {v === 'chat' ? <ChatTabIcon /> : v === 'models' ? <ModelsTabIcon /> : <SettingsTabIcon />}
            <span>{v.charAt(0).toUpperCase() + v.slice(1)}</span>
            {v === 'chat' && userMsgCount > 0 && (
              <span className={styles.tabBadge}>{userMsgCount}</span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className={styles.content}>

        {view === 'chat' && (
          <>
            {!isModelLoaded ? (
              <NoModelPrompt
                models={models}
                isLoading={isLoadingModel}
                onLoadModel={handleLoadModel}
                onImport={handleImportModel}
                onGoToModels={() => setView('models')}
              />
            ) : (
              <div className={styles.chatLayout}>
                {/* Page context actions */}
                {pageUrl && (
                  <div className={styles.pageContext}>
                    <button
                      className={styles.contextBtn}
                      onClick={handleSummarizePage}
                      disabled={isGenerating}
                    >
                      <SummarizeIcon /> Summarize this page
                    </button>
                  </div>
                )}

                {/* Messages */}
                <ChatMessages messages={messages} />

                {/* Input */}
                <ChatInput
                  onSend={handleSend}
                  onAbort={handleAbort}
                  isGenerating={isGenerating}
                  disabled={!isModelLoaded}
                  placeholder={
                    isModelLoaded
                      ? 'Ask anything…'
                      : 'Load a model to start chatting'
                  }
                />
              </div>
            )}
          </>
        )}

        {view === 'models' && (
          <ModelSelector
            models={models}
            activeModelId={activeModelId}
            isLoading={isLoadingModel}
            onLoadModel={handleLoadModel}
            onImport={handleImportModel}
            onRefresh={loadModelsAndState}
          />
        )}

        {view === 'settings' && (
          <AISettings
            systemPrompt={systemPrompt}
            onSystemPromptChange={setSystemPrompt}
          />
        )}
      </div>

      {/* Footer: keyboard hint */}
      <div className={styles.footer}>
        <span className={styles.footerHint}>
          <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd> to toggle
        </span>
      </div>
    </div>
  );
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildSystemPrompt(base: string, pageUrl?: string, pageTitle?: string): string {
  let prompt = base;
  if (pageUrl || pageTitle) {
    prompt += '\n\nCurrent browser context:';
    if (pageTitle) prompt += `\n- Page title: "${pageTitle}"`;
    if (pageUrl)   prompt += `\n- URL: ${pageUrl}`;
  }
  return prompt;
}

function getShortModelName(id: string): string {
  return id.split('-').slice(0, 3).join('-');
}

// ── Sub-components ─────────────────────────────────────────────────────────────

interface NoModelProps {
  models: ModelInfo[];
  isLoading: boolean;
  onLoadModel: (id: string) => void;
  onImport: () => void;
  onGoToModels: () => void;
}

const NoModelPrompt: React.FC<NoModelProps> = ({
  models, isLoading, onLoadModel, onImport, onGoToModels
}) => (
  <div className={styles.noModel}>
    <div className={styles.noModelIcon}><SidebarSparkIcon large /></div>
    <h3>No model loaded</h3>
    {models.length > 0 ? (
      <>
        <p>Load a model to start chatting locally.</p>
        <div className={styles.quickModelList}>
          {models.slice(0, 5).map(m => (
            <button
              key={m.id}
              className={styles.quickModelBtn}
              onClick={() => onLoadModel(m.id)}
              disabled={isLoading}
            >
              <span className={styles.qmName}>{m.name}</span>
              <span className={styles.qmSize}>{formatFileSize(m.fileSizeBytes)}</span>
              {isLoading ? <span className={styles.spinner} /> : <LoadIcon />}
            </button>
          ))}
        </div>
        {models.length > 5 && (
          <button className={styles.viewAllBtn} onClick={onGoToModels}>
            View all {models.length} models →
          </button>
        )}
      </>
    ) : (
      <>
        <p>Import a GGUF model file to get started.</p>
        <button className={styles.importBtn} onClick={onImport}>
          <PlusIcon /> Import GGUF Model
        </button>
      </>
    )}
  </div>
);

function formatFileSize(bytes: number): string {
  if (bytes > 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes > 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

// ── Icons ──────────────────────────────────────────────────────────────────────

const SidebarSparkIcon: React.FC<{ large?: boolean }> = ({ large }) => (
  <svg viewBox="0 0 24 24" width={large ? 40 : 16} height={large ? 40 : 16} fill="none" aria-hidden="true">
    {/* Four-pointed star / diamond – the "Spaceship" emblem */}
    <path d="M12 2 L14.4 8.8 L22 12 L14.4 15.2 L12 22 L9.6 15.2 L2 12 L9.6 8.8 Z"
          fill="url(#shipGrad)" />
    {/* Inner accent dot */}
    {large && <circle cx="12" cy="12" r="2.5" fill="rgba(253,211,77,0.55)" />}
    <defs>
      {/* Amber → teal gradient – no purple, no pink */}
      <linearGradient id="shipGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%"   stopColor="#fcd34d" />  {/* amber-300 */}
        <stop offset="55%"  stopColor="#d97706" />  {/* amber-600 */}
        <stop offset="100%" stopColor="#0d9488" />  {/* teal-600  */}
      </linearGradient>
    </defs>
  </svg>
);
const CloseIcon     = () => <svg viewBox="0 0 14 14" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="2" y1="2" x2="12" y2="12" /><line x1="12" y1="2" x2="2" y2="12" /></svg>;
const TrashIcon     = () => <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4"><polyline points="3,5 13,5" /><path d="M5 5V3h6v2" /><rect x="4" y="5" width="8" height="9" rx="1" /></svg>;
const SummarizeIcon = () => <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="2" y="2" width="12" height="12" rx="1.5" /><line x1="5" y1="6" x2="11" y2="6" /><line x1="5" y1="9" x2="9" y2="9" /></svg>;
const LoadIcon      = () => <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.4"><polyline points="5,2 9,7 5,12" /></svg>;
const PlusIcon      = () => <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="7" y1="2" x2="7" y2="12" /><line x1="2" y1="7" x2="12" y2="7" /></svg>;
const ExportIcon    = () => <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M9 2H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7L9 2z" /><polyline points="9,2 9,7 13,7" /><line x1="6" y1="10" x2="10" y2="10" /><line x1="6" y1="12" x2="8" y2="12" /></svg>;
const ChatTabIcon     = () => <svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 2h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H5l-3 2V3a1 1 0 0 1 1-1z" /></svg>;
const ModelsTabIcon   = () => <svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.4"><ellipse cx="7" cy="5" rx="4.5" ry="2.5" /><path d="M2.5 5v4c0 1.4 2 2.5 4.5 2.5S11.5 10.4 11.5 9V5" /><path d="M2.5 7c0 1.4 2 2.5 4.5 2.5S11.5 8.4 11.5 7" /></svg>;
const SettingsTabIcon = () => <svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.3"><circle cx="7" cy="7" r="2" /><path d="M7 1.5v1M7 11.5v1M1.5 7h1M11.5 7h1M3.1 3.1l.7.7M10.2 10.2l.7.7M10.9 3.1l-.7.7M3.8 10.2l-.7.7" /></svg>;
