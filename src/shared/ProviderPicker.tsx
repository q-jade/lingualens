import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { AppSettings } from './types';
import { ProviderIcon } from './ProviderIcon';

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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const providers = settings?.providers ?? [];
  const currentProvider = providers.find((p) => p.id === settings?.defaultProvider);

  // Focus the active item when the menu opens so keyboard users can navigate.
  useEffect(() => {
    if (!open) return;
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]');
    if (!items?.length) return;
    const active = Array.from(items).find((el) => el.getAttribute('aria-checked') === 'true');
    (active ?? items[0]).focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
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

  const handleMenuKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Tab') {
      // Close and keep focus on the trigger — deterministic across layouts.
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [],
    );
    if (items.length === 0) return;
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = 0;
    if (e.key === 'ArrowDown') next = idx < 0 ? 0 : (idx + 1) % items.length;
    else if (e.key === 'ArrowUp') next = idx < 0 ? items.length - 1 : (idx - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else next = items.length - 1;
    items[next].focus({ preventScroll: true });
  };

  return (
    <div className="relative min-w-0" ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        disabled={providers.length === 0}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !open && providers.length > 0) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        className={`flex min-w-0 items-center gap-1 text-left text-[11px] text-gray-400 hover:text-blue-500 disabled:cursor-default disabled:hover:text-gray-400 ${triggerClassName}`}
      >
        {currentProvider && (
          <ProviderIcon
            type={currentProvider.type}
            name={currentProvider.name}
            size={14}
            className="shrink-0"
          />
        )}
        <span className="truncate">{currentProvider?.name ?? '-'}</span>
        {providers.length > 0 && (
          <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        )}
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          onKeyDown={handleMenuKeyDown}
          className="absolute bottom-full left-0 z-20 mb-1 max-h-64 w-56 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
        >
          {providers.map((provider) => {
            const active = provider.id === settings?.defaultProvider;
            return (
              <button
                key={provider.id}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                tabIndex={-1}
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.focus();
                  if (!active) onChange(provider.id);
                }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${active
                  ? 'bg-blue-50 text-blue-600'
                  : 'text-gray-700 hover:bg-blue-50 hover:text-blue-600'
                  }`}
              >
                <span className="flex w-3.5 shrink-0 items-center justify-center">
                  <ProviderIcon
                    type={provider.type}
                    name={provider.name}
                    size={14}
                  />
                </span>
                <span className="min-w-0 flex-1 truncate text-left">{provider.name}</span>
                {active && <span className="shrink-0 text-xs">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
