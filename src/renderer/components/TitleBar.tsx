/**
 * Space Browser – TitleBar Component
 * Custom frameless window titlebar with Space logo and window controls.
 */

import React from 'react';
import styles from '../styles/TitleBar.module.scss';

interface Props {
  windowState: string;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
}

export const TitleBar: React.FC<Props> = ({
  windowState, sidebarOpen, onToggleSidebar, onMinimize, onMaximize, onClose,
}) => {
  const isMax = windowState === 'maximized';

  return (
    <div className={styles.titleBar}>
      {/* Draggable region */}
      <div className={`${styles.dragRegion} electron-drag`} />

      {/* Space logo / wordmark */}
      <div className={styles.logo}>
        <SpaceLogo />
        <span className={styles.logoText}>Space</span>
      </div>

      {/* Window controls */}
      <div className={styles.windowControls}>
        <button
          className={`${styles.wcBtn} ${styles.wcMin}`}
          onClick={onMinimize}
          title="Minimize"
          aria-label="Minimize window"
        >
          <svg viewBox="0 0 12 12" width="12" height="12">
            <rect x="1" y="5.5" width="10" height="1" fill="currentColor" />
          </svg>
        </button>
        <button
          className={`${styles.wcBtn} ${styles.wcMax}`}
          onClick={onMaximize}
          title={isMax ? 'Restore' : 'Maximize'}
          aria-label={isMax ? 'Restore window' : 'Maximize window'}
        >
          {isMax ? (
            <svg viewBox="0 0 12 12" width="12" height="12">
              <path d="M2 4h6v6H2z" fill="none" stroke="currentColor" strokeWidth="1.2" />
              <path d="M4 2h6v6" fill="none" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          ) : (
            <svg viewBox="0 0 12 12" width="12" height="12">
              <rect x="1.5" y="1.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          )}
        </button>
        <button
          className={`${styles.wcBtn} ${styles.wcClose}`}
          onClick={onClose}
          title="Close"
          aria-label="Close window"
        >
          <svg viewBox="0 0 12 12" width="12" height="12">
            <line x1="1.5" y1="1.5" x2="10.5" y2="10.5" stroke="currentColor" strokeWidth="1.4" />
            <line x1="10.5" y1="1.5" x2="1.5" y2="10.5" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        </button>
      </div>
    </div>
  );
};

const SpaceLogo: React.FC = () => (
  <svg
    viewBox="0 0 32 32"
    width="22"
    height="22"
    className={styles.logoIcon}
    aria-hidden="true"
  >
    <defs>
      <radialGradient id="sg" cx="40%" cy="40%" r="70%">
        <stop offset="0%"   stopColor="#60a5fa" />
        <stop offset="50%"  stopColor="#2563eb" />
        <stop offset="100%" stopColor="#1e3a8a" />
      </radialGradient>
    </defs>
    <circle cx="16" cy="16" r="15" fill="url(#sg)" />
    {/* Saturn ring */}
    <ellipse cx="16" cy="16" rx="14" ry="5"
      fill="none" stroke="rgba(96,165,250,0.6)" strokeWidth="1.5"
      transform="rotate(-20 16 16)" />
    {/* Stars */}
    <circle cx="8"  cy="8"  r="1.2" fill="white" opacity="0.9" />
    <circle cx="24" cy="6"  r="0.8" fill="white" opacity="0.7" />
    <circle cx="26" cy="24" r="1"   fill="white" opacity="0.8" />
    <circle cx="6"  cy="22" r="0.6" fill="white" opacity="0.6" />
  </svg>
);
