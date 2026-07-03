/**
 * Space Browser – Chat Messages Component
 * Renders the message list with streaming indicator and markdown-like formatting.
 */

import React, { useEffect, useRef } from 'react';
import { Message } from './AISidebar';
import styles from '../styles/ChatMessages.module.scss';

interface Props {
  messages: Message[];
}

export const ChatMessages: React.FC<Props> = ({ messages }) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom during streaming
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className={styles.empty}>
        <p>Start a conversation or ask about the page you're browsing.</p>
        <div className={styles.suggestions}>
          {SUGGESTIONS.map(s => (
            <div key={s} className={styles.suggestion}>{s}</div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.messageList} role="log" aria-live="polite" aria-label="Chat messages">
      {messages.map(msg => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
};

const MessageBubble: React.FC<{ message: Message }> = ({ message: msg }) => {
  const isUser = msg.role === 'user';
  const displayContent = isUser ? msg.content : cleanAssistantOutput(msg.content);

  return (
    <div
      className={`${styles.message} ${isUser ? styles.user : styles.assistant} ${msg.isStreaming ? styles.streaming : ''}`}
      aria-label={`${msg.role}: ${displayContent}`}
    >
      <div className={styles.avatar}>
        {isUser ? <UserAvatar /> : <AIAvatar />}
      </div>
      <div className={styles.bubble}>
        {msg.error ? (
          <div className={styles.errorMsg}>
            <ErrorIcon /> {msg.error}
          </div>
        ) : (
          <div
            className={styles.content}
            dangerouslySetInnerHTML={{ __html: formatMessage(displayContent) }}
          />
        )}
        {msg.isStreaming && (
          <span className={styles.cursor} aria-hidden="true" />
        )}
      </div>
    </div>
  );
};

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Strip raw model artifacts from assistant output before rendering:
 *  - Chat-template special tokens: <|im_start|>, <|im_end|>, <|system|>, etc.
 *  - Common Llama / Mistral / ChatML role markers that leak into the output
 *  - Any remaining angle-bracket token patterns like <|...|>
 * The model itself should never emit these in well-configured inference, but
 * this acts as a safety net for models with misconfigured chat templates.
 */
function cleanAssistantOutput(text: string): string {
  if (!text) return '';

  return text
    // Remove ChatML / im tokens in any order / casing
    .replace(/<\|im_start\|>\s*(system|user|assistant)?\s*/gi, '')
    .replace(/<\|im_end\|>/gi, '')
    // Remove Llama-3 / Mistral special tokens
    .replace(/<\|start_header_id\|>[^<]*<\|end_header_id\|>/gi, '')
    .replace(/<\|eot_id\|>/gi, '')
    .replace(/\[INST\]|\[\/INST\]/gi, '')
    .replace(/<<SYS>>[\s\S]*?<<\/SYS>>/gi, '')
    // Remove any remaining generic angle-bracket tokens: <|...|>
    .replace(/<\|[^|>]+\|>/g, '')
    // Trim leading/trailing whitespace left behind by stripping
    .trim();
}

/**
 * Simple message formatter: escapes HTML then applies markdown-like transforms.
 * For production, replace with a proper sanitized markdown renderer.
 */
function formatMessage(text: string): string {
  if (!text) return '';

  let html = text
    // Escape HTML
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Code blocks
    .replace(/```([\w]*)\n?([\s\S]*?)```/g, '<pre><code class="lang-$1">$2</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Numbered lists
    .replace(/^\d+\.\s(.+)$/gm, '<li>$1</li>')
    // Bullet lists
    .replace(/^[-•]\s(.+)$/gm, '<li>$1</li>')
    // Newlines
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br/>');

  return `<p>${html}</p>`;
}

const SUGGESTIONS = [
  '"Summarize this article"',
  '"Explain this concept simply"',
  '"What are the key points?"',
  '"Translate this to English"',
];

// ── Icons ──────────────────────────────────────────────────────────────────────

const UserAvatar = () => (
  <svg viewBox="0 0 20 20" width="18" height="18" fill="currentColor" aria-hidden="true">
    <circle cx="10" cy="7" r="4" />
    <path d="M2 18c0-4.4 3.6-8 8-8s8 3.6 8 8" />
  </svg>
);

const AIAvatar = () => (
  <svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden="true">
    <path d="M10 1 L12 7 L18 10 L12 13 L10 19 L8 13 L2 10 L8 7 Z"
          fill="url(#aiAv)" />
    <defs>
      <linearGradient id="aiAv" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%"   stopColor="#a78bfa" />
        <stop offset="100%" stopColor="#6366f1" />
      </linearGradient>
    </defs>
  </svg>
);

const ErrorIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="#f87171" strokeWidth="1.5" aria-hidden="true">
    <circle cx="8" cy="8" r="6.5" />
    <line x1="8" y1="5" x2="8" y2="8.5" />
    <circle cx="8" cy="11" r="0.6" fill="#f87171" />
  </svg>
);
