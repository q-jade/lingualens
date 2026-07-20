import { useEffect, useRef, useState } from 'react';
import type { AppSettings } from './types';

export function ProviderPicker({
  settings,
  onChange,
  triggerClassName = '',
}: {
  settings: AppSettings | null;
  onChange: (providerId: string) => void;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const providers = settings?.providers ?? [];
  const currentProvider = providers.find((p) => p.id === settings?.defaultProvider);

  useEffect(() => {
    if (!open) return;

    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onBlur = () => setOpen(false);

    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', onBlur);
    };
  }, [open]);

  return (
    <div className="relative min-w-0" ref={ref}>
      <button
        type="button"
        disabled={providers.length === 0}
        onClick={() => setOpen((v) => !v)}
        className={`flex min-w-0 items-center gap-1 text-left text-[11px] text-gray-400 hover:text-blue-500 disabled:cursor-default disabled:hover:text-gray-400 ${triggerClassName}`}
      >
        <span className="truncate">{currentProvider?.name ?? '-'}</span>
        {providers.length > 0 && (
          <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        )}
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-20 mb-1 max-h-64 w-56 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          {providers.map((provider) => {
            const active = provider.id === settings?.defaultProvider;
            return (
              <button
                key={provider.id}
                type="button"
                onClick={() => {
                  setOpen(false);
                  if (!active) onChange(provider.id);
                }}
                className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm ${active
                  ? 'bg-blue-50 text-blue-600'
                  : 'text-gray-700 hover:bg-blue-50 hover:text-blue-600'
                  }`}
              >
                <span className="truncate">{provider.name}</span>
                {active && <span className="text-xs">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
