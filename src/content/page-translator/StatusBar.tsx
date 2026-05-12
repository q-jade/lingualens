import { type TranslateProgress, type DisplayMode } from './engine';

interface Props {
  progress: TranslateProgress | null;
  running: boolean;
  displayMode: DisplayMode;
  onStop: () => void;
  onRestore: () => void;
  onToggleMode: () => void;
}

export function StatusBar({ progress, running, displayMode, onStop, onRestore, onToggleMode }: Props) {
  if (!progress) return null;

  const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const done = !running && progress.done > 0;

  return (
    <div className="st-status-bar">
      <div className="st-status-left">
        <svg className="st-status-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m5 8 6 6" /><path d="m4 14 6-6 2-3" /><path d="M2 5h12" /><path d="M7 2h1" />
          <path d="m22 22-5-10-5 10" /><path d="M14 18h6" />
        </svg>
        {running ? (
          <span className="st-status-text">
            Translating… {progress.done}/{progress.total} ({percent}%)
            {progress.errors > 0 && <span className="st-status-err"> · {progress.errors} errors</span>}
          </span>
        ) : done ? (
          <span className="st-status-text">
            Translated {progress.done}/{progress.total}
            {progress.errors > 0 && <span className="st-status-err"> · {progress.errors} errors</span>}
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
          <button onClick={onToggleMode} className="st-status-btn" title="Switch display mode">
            {displayMode === 'bilingual' ? 'Replace' : 'Bilingual'}
          </button>
        )}
        {running && (
          <button onClick={onStop} className="st-status-btn st-status-btn-warn">Stop</button>
        )}
        {done && (
          <button onClick={onRestore} className="st-status-btn">Restore</button>
        )}
      </div>
    </div>
  );
}
