import { useTranslation } from 'react-i18next';
import { type TranslateProgress, type DisplayMode } from './engine';
import { AppLogo } from '../../shared/AppLogo';

interface Props {
  progress: TranslateProgress | null;
  running: boolean;
  displayMode: DisplayMode;
  collapsed: boolean;
  onStop: () => void;
  onRestore: () => void;
  onToggleMode: () => void;
  onToggleCollapse: () => void;
}

export function StatusBar({ progress, running, displayMode, collapsed, onStop, onRestore, onToggleMode, onToggleCollapse }: Props) {
  const { t } = useTranslation();

  if (!progress) return null;

  const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const done = !running && progress.done > 0;

  if (collapsed) {
    return (
      <button onClick={onToggleCollapse} className="st-status-collapsed" title={t('statusBar.expand')}>
        <span className="st-status-collapsed-mark">
          <AppLogo className="st-status-collapsed-icon" />
        </span>
        {running && (
          <span className="st-status-collapsed-badge">{percent}%</span>
        )}
      </button>
    );
  }

  return (
    <div className="st-status-bar">
      <div className="st-status-left">
        <AppLogo className="st-status-icon" />
        {running ? (
          <span className="st-status-text">
            {t('statusBar.translatingProgress', { done: progress.done, total: progress.total, percent })}
            {progress.errors > 0 && <span className="st-status-err"> {t('statusBar.errors', { count: progress.errors })}</span>}
          </span>
        ) : done ? (
          <span className="st-status-text">
            {t('statusBar.translatedProgress', { done: progress.done, total: progress.total })}
            {progress.errors > 0 && <span className="st-status-err"> {t('statusBar.errors', { count: progress.errors })}</span>}
          </span>
        ) : null}
      </div>

      {running && (
        <div className="st-status-progress">
          <div className="st-status-progress-fill" style={{ width: `${percent}%` }} />
        </div>
      )}

      <div className="st-status-actions">
        {done && (
          <button onClick={onToggleMode} className="st-status-btn" title={t('statusBar.switchMode')}>
            {displayMode === 'bilingual' ? t('statusBar.replace') : t('statusBar.bilingual')}
          </button>
        )}
        {running && (
          <button onClick={onStop} className="st-status-btn st-status-btn-warn">
            {t('statusBar.stop')}
          </button>
        )}
        {done && (
          <button onClick={onRestore} className="st-status-btn">
            {t('statusBar.restore')}
          </button>
        )}
        <button onClick={onToggleCollapse} className="st-status-btn-icon" title={t('statusBar.minimize')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M5 12h14" />
          </svg>
        </button>
      </div>
    </div>
  );
}
