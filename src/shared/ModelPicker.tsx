import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProviderConfig, MessageResponse } from './types';

/**
 * Editable model field with an optional fetchable list of the provider's
 * available models (LLM providers only — via the background LIST_MODELS
 * message). The text input stays the source of truth so a model name can
 * always be typed manually; the dropdown only fills it in.
 *
 * The fetched list is cached in component state (never persisted): the first
 * dropdown open fetches it, later opens reuse it, and editing baseUrl/apiKey
 * invalidates it automatically so a stale list never survives a config
 * change. The refresh button forces a re-fetch regardless.
 */
export function ModelPicker({
  provider,
  value,
  onChange,
}: {
  provider: ProviderConfig;
  value: string;
  onChange: (model: string) => void;
}) {
  const { t } = useTranslation();
  const [models, setModels] = useState<string[] | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Any edit to connection settings invalidates the cached list: the next
  // open fetches against the new values instead of serving stale results.
  const connRef = useRef({ baseUrl: provider.baseUrl, apiKey: provider.apiKey });
  useEffect(() => {
    if (connRef.current.baseUrl === provider.baseUrl && connRef.current.apiKey === provider.apiKey) return;
    connRef.current = { baseUrl: provider.baseUrl, apiKey: provider.apiKey };
    setModels(null);
    setStatus('idle');
    setError('');
    setOpen(false);
  }, [provider.baseUrl, provider.apiKey]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  const fetchModels = async () => {
    setStatus('loading');
    setError('');
    setOpen(true);
    try {
      const res: MessageResponse<string[]> = await browser.runtime.sendMessage({
        type: 'LIST_MODELS',
        payload: { providerConfig: provider },
      });
      if (!res) {
        setError(t('options.noResponseFromBackground'));
        setStatus('error');
        return;
      }
      if (!res.success) {
        setError(res.error);
        setStatus('error');
        return;
      }
      setModels(res.data);
      setStatus('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('options.modelsFetchFailed', { error: '' }).trim());
      setStatus('error');
    }
  };

  const toggleDropdown = () => {
    if (open) {
      setOpen(false);
      return;
    }
    if (models !== null) {
      setOpen(true);
      return;
    }
    void fetchModels();
  };

  const filtered = (models ?? []).filter((m) =>
    m.toLowerCase().includes(value.trim().toLowerCase()),
  );

  return (
    <div ref={containerRef}>
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={provider.type === 'lmstudio' || provider.type === 'ollama'
            ? undefined
            : 'gpt-5.4-mini'}
          className="input font-mono flex-1 min-w-0"
        />
        <button
          type="button"
          onClick={toggleDropdown}
          disabled={status === 'loading'}
          aria-label={t('options.fetchModels')}
          aria-expanded={open}
          title={t('options.fetchModels')}
          className="shrink-0 px-2 border border-gray-200 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50 transition-colors"
        >
          {status === 'loading' ? (
            <span className="ll-spinner" aria-hidden="true" />
          ) : (
            <svg className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
          )}
        </button>
      </div>

      {open && (
        <div className="relative">
          <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-md">
            {status === 'ready' && models !== null && (
              <div className="sticky top-0 flex justify-end px-2 py-1 bg-white/95 border-b border-gray-100 backdrop-blur-sm">
                <button
                  type="button"
                  onClick={() => void fetchModels()}
                  aria-label={t('options.refreshModels')}
                  title={t('options.refreshModels')}
                  className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-50 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" />
                  </svg>
                </button>
              </div>
            )}
            {status === 'error' ? (
              <p className="px-3 py-2 text-xs text-red-500 break-all">{t('options.modelsFetchFailed', { error })}</p>
            ) : models !== null && models.length === 0 ? (
              <p className="px-3 py-2 text-xs text-gray-400">{t('options.noModelsFound')}</p>
            ) : filtered.length === 0 ? (
              <p className="px-3 py-2 text-xs text-gray-400">{t('options.noModelsMatch')}</p>
            ) : (
              filtered.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    onChange(m);
                    setOpen(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-sm font-mono truncate hover:bg-indigo-50 transition-colors ${m === value ? 'text-indigo-600 bg-indigo-50' : 'text-gray-700'}`}
                >
                  {m}
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {status === 'error' && !open && (
        <p className="ll-hint mt-1 text-red-500">{t('options.modelsFetchFailed', { error })}</p>
      )}
    </div>
  );
}
