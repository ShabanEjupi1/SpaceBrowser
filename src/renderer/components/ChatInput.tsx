/**
 * Space Browser – Chat Input Component
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import styles from '../styles/ChatInput.module.scss';

interface Props {
  onSend: (text: string) => void;
  onAbort: () => void;
  isGenerating: boolean;
  disabled: boolean;
  placeholder: string;
}

export const ChatInput: React.FC<Props> = ({
  onSend, onAbort, isGenerating, disabled, placeholder,
}) => {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [value]);

  const handleSubmit = useCallback((e?: React.FormEvent) => {
    e?.preventDefault();
    if (isGenerating) {
      onAbort();
      return;
    }
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
  }, [value, isGenerating, disabled, onSend, onAbort]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  return (
    <form className={styles.inputForm} onSubmit={handleSubmit}>
      <div className={`${styles.inputWrapper} ${isGenerating ? styles.generating : ''}`}>
        <textarea
          ref={textareaRef}
          className={styles.textarea}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled && !isGenerating}
          rows={1}
          aria-label="Chat message input"
          aria-multiline="true"
        />
        <button
          type="submit"
          className={`${styles.sendBtn} ${isGenerating ? styles.stopBtn : ''}`}
          disabled={!isGenerating && (!value.trim() || disabled)}
          aria-label={isGenerating ? 'Stop generation' : 'Send message'}
          title={isGenerating ? 'Stop (Esc)' : 'Send (Enter)'}
        >
          {isGenerating ? <StopIcon /> : <SendIcon />}
        </button>
      </div>
      <div className={styles.hint}>
        <span>Enter to send · Shift+Enter for new line</span>
        {value.length > 100 && (
          <span className={styles.charCount}>{value.length}</span>
        )}
      </div>
    </form>
  );
};

const SendIcon = () => (
  <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true">
    <path d="M2 14 L14 8 L2 2 L2 6.5 L10 8 L2 9.5 Z"
          fill="currentColor" />
  </svg>
);

const StopIcon = () => (
  <svg viewBox="0 0 14 14" width="13" height="13" fill="currentColor" aria-hidden="true">
    <rect x="2.5" y="2.5" width="9" height="9" rx="1.5" />
  </svg>
);
