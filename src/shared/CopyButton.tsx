import { useEffect, useRef, useState } from 'react';

const COPY_ICON = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const CHECK_ICON = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

interface Props {
  /** Text to write to the clipboard. */
  text: string;
  /** Accessible name (and visible label for the 'text' variant). */
  label: string;
  /** 'text' = icon + label (popup / sidepanel); 'icon' = icon-only (content panel footer). */
  variant?: 'text' | 'icon';
  className?: string;
}

/**
 * Unified copy action across surfaces. On success the icon swaps to a green
 * check for 1.5 s (via `.ll-copied`) instead of replacing the label, so the
 * button keeps its size and the feedback is identical everywhere.
 */
export function CopyButton({ text, label, variant = 'text', className = '' }: Props) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Cleanup: cancel the "copied" reset timer if the component unmounts
    // before it fires (e.g. popup closes, or a new result remounts it via key).
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 1500);
  };

  const stateClass = copied ? 'll-copied' : '';

  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={handleCopy}
        className={`ll-copy-icon ${stateClass} ${className}`}
        title={label}
        aria-label={label}
      >
        {copied ? CHECK_ICON : COPY_ICON}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`ll-copy ${stateClass} ${className}`}
      aria-live="polite"
    >
      {copied ? CHECK_ICON : COPY_ICON}
      <span>{label}</span>
    </button>
  );
}
