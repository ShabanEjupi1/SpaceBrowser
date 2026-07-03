/**
 * Space Browser – Tab Bar Component
 */

import React, { useRef, useState, useCallback, useEffect } from 'react';
import ReactDOM from 'react-dom';
import styles from '../styles/TabBar.module.scss';

interface Tab {
  id: string;
  title: string;
  favicon: string;
  url: string;
  isLoading: boolean;
  isActive: boolean;
  isPinned?: boolean;
  isMuted?: boolean;
  isSuspended?: boolean;
}

interface Props {
  tabs: Tab[];
  onNewTab: () => void;
  onCloseTab: (id: string) => void;
  onActivateTab: (id: string) => void;
  /** Reopen the most recently closed tab (Ctrl+Shift+T) */
  onReopenClosedTab?: () => void;
  /** Open a duplicate of the given tab */
  onDuplicateTab?: (id: string) => void;
  /** Number of recently closed tabs available to restore */
  closedTabCount?: number;
}

const api = (window as any).spaceAPI ?? null;

export const TabBar: React.FC<Props> = ({
  tabs, onNewTab, onCloseTab, onActivateTab, onReopenClosedTab, onDuplicateTab,
  closedTabCount = 0,
}) => {
  // Use native Electron Menu.popup for context menu — this renders above BrowserView
  const handleContextMenu = useCallback((e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    e.stopPropagation();
    api?.tabs?.showContextMenu?.(tabId, closedTabCount > 0);
  }, [closedTabCount]);

  return (
    <div className={styles.tabBar} role="tablist">
      <div className={styles.tabList}>
        {tabs.map(tab => (
          <TabItem
            key={tab.id}
            tab={tab}
            onActivate={() => onActivateTab(tab.id)}
            onClose={(e) => {
              e.stopPropagation();
              if (!tab.isPinned) onCloseTab(tab.id);
            }}
            onContextMenu={(e) => handleContextMenu(e, tab.id)}
          />
        ))}
      </div>
      <button
        className={styles.newTabBtn}
        onClick={onNewTab}
        title="New Tab (Ctrl+T)"
        aria-label="Open new tab"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
          <line x1="8" y1="2" x2="8" y2="14" />
          <line x1="2" y1="8" x2="14" y2="8" />
        </svg>
      </button>
    </div>
  );
};

interface TabItemProps {
  tab: Tab;
  onActivate: () => void;
  onClose: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

const TabItem: React.FC<TabItemProps> = ({ tab, onActivate, onClose, onContextMenu }) => {
  const getFaviconUrl = (url: string, favicon: string) => {
    if (favicon) return favicon;
    try {
      const origin = new URL(url).origin;
      return `${origin}/favicon.ico`;
    } catch {
      return null;
    }
  };

  const faviconUrl = getFaviconUrl(tab.url, tab.favicon);

  return (
    <div
      className={[
        styles.tab,
        tab.isActive ? styles.active : '',
        tab.isPinned ? styles.pinned : '',
        tab.isSuspended ? styles.suspended : '',
      ].filter(Boolean).join(' ')}
      onClick={onActivate}
      onContextMenu={onContextMenu}
      role="tab"
      aria-selected={tab.isActive}
      title={tab.title || tab.url}
    >
      <div className={styles.tabFavicon}>
        {tab.isLoading ? (
          <div className={styles.loadingSpinner} aria-hidden="true" />
        ) : faviconUrl ? (
          <img
            src={faviconUrl}
            width={14}
            height={14}
            alt=""
            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <DefaultFavicon />
        )}
      </div>

      {/* Pinned tabs show no title to save space */}
      {!tab.isPinned && (
        <>
          <span className={styles.tabTitle}>
            {tab.isMuted && <span className={styles.muteIcon} title="Muted">🔇</span>}
            {tab.title || 'New Tab'}
          </span>
          <button
            className={styles.tabClose}
            onClick={onClose}
            aria-label={`Close ${tab.title}`}
            title="Close tab"
          >
            <svg viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.5">
              <line x1="1.5" y1="1.5" x2="8.5" y2="8.5" />
              <line x1="8.5" y1="1.5" x2="1.5" y2="8.5" />
            </svg>
          </button>
        </>
      )}
    </div>
  );
};

const DefaultFavicon: React.FC = () => (
  <svg viewBox="0 0 14 14" width="14" height="14" fill="none">
    <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1" opacity="0.4" />
    <circle cx="7" cy="7" r="2" fill="currentColor" opacity="0.4" />
  </svg>
);
