import type { ReactNode } from 'react';
import type { SelectionTriggerMode } from './types';

const ICON_PATHS: Record<SelectionTriggerMode, ReactNode> = {
  icon: (
    <>
      <path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
      <path d="m13 13 6 6" />
    </>
  ),
  instant: <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />,
  modifier: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M10 14h4" />
    </>
  ),
  off: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m4.9 4.9 14.2 14.2" />
    </>
  ),
};

/** Selection-trigger mode icon (mouse-pointer / zap / keyboard / off). */
export function ModeIcon({
  mode,
  size = 14,
  className,
}: {
  mode: SelectionTriggerMode;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {ICON_PATHS[mode]}
    </svg>
  );
}
