import ReactDOM from 'react-dom/client';
import { ContentApp, type ContentAppHandle } from './App';
import './style.css';

const OVERLAY_Z = '2147483647';

/**
 * Block page compositing from affecting the host, and force top stacking.
 * WXT's `:host { all: initial !important }` resets z-index; inline z-index from WXT
 * cannot beat it without !important — page rails (huggingface.co) then paint on top.
 */
function shieldOverlayHost(host: HTMLElement) {
  for (const [prop, value] of [
    ['z-index', OVERLAY_Z],
    ['position', 'fixed'],
    ['top', '0'],
    ['left', '0'],
    ['width', '0'],
    ['height', '0'],
    ['overflow', 'visible'],
    ['pointer-events', 'none'],
    ['opacity', '1'],
    ['mix-blend-mode', 'normal'],
    ['filter', 'none'],
    ['backdrop-filter', 'none'],
    ['-webkit-backdrop-filter', 'none'],
    ['isolation', 'isolate'],
  ] as const) {
    host.style.setProperty(prop, value, 'important');
  }
}

/** Full-viewport portal inside shadow so `position:fixed` UI is not trapped under page layers. */
function shieldShadowPortal(shadow: ShadowRoot, container: HTMLElement) {
  const innerHtml = shadow.querySelector('html');
  if (innerHtml instanceof HTMLElement) {
    for (const [prop, value] of [
      ['position', 'fixed'],
      ['inset', '0'],
      ['width', '100vw'],
      ['height', '100vh'],
      ['overflow', 'visible'],
      ['pointer-events', 'none'],
      ['z-index', OVERLAY_Z],
    ] as const) {
      innerHtml.style.setProperty(prop, value, 'important');
    }
  }
  container.style.setProperty('pointer-events', 'none', 'important');
}

/** Get corners of the selection. */
function getSelectionCorners(range: Range): { x: number, y: number }[] {
  const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
  const rect = range.getBoundingClientRect();
  let corners = [{ x: rect.left, y: rect.top },
  { x: rect.right, y: rect.top },
  { x: rect.left, y: rect.bottom },
  { x: rect.right, y: rect.bottom }];

  if (rects.length < 2) return corners;
  corners[0].x = Math.max(corners[0].x, rects[0].left);
  corners[1].x = Math.min(corners[1].x, rects[0].right);
  corners[2].x = Math.max(corners[2].x, rects[rects.length - 1].left);
  corners[3].x = Math.min(corners[3].x, rects[rects.length - 1].right);

  return corners;
}

function computePositionByCorners(corners: { x: number, y: number }[], mouseX: number, mouseY: number): { x: number; y: number } {
  // sort corners by distance to mouse: left-top, right-top, left-bottom, right-bottom
  const prio = [0, 1, 2, 3].sort((a, b) => {
    const da = (mouseX - corners[a].x) ** 2 + (mouseY - corners[a].y) ** 2;
    const db = (mouseX - corners[b].x) ** 2 + (mouseY - corners[b].y) ** 2;
    return da - db;
  });
  const ICON_SIZE = 24;
  const TRIGGER_MARGIN = 8;
  const TRIGGER_OFFSET = 5; // distance from the corner to the trigger
  for (const i of prio) {
    switch (i) {
      case 0: // left-top
        {
          const x = corners[i].x - TRIGGER_OFFSET - ICON_SIZE;
          const y = corners[i].y - TRIGGER_OFFSET - ICON_SIZE;
          if (x < TRIGGER_MARGIN && y < TRIGGER_MARGIN) break; // if the trigger would be off-screen, try the next corner
          return { x: Math.max(x, TRIGGER_MARGIN), y: Math.max(y, TRIGGER_MARGIN) };
        }
      case 1: // right-top
        {
          const x = corners[i].x + TRIGGER_OFFSET;
          const y = corners[i].y - TRIGGER_OFFSET - ICON_SIZE;
          if (x > window.innerWidth - TRIGGER_MARGIN - ICON_SIZE && y < TRIGGER_MARGIN) break;
          return {
            x: Math.min(x, window.innerWidth - TRIGGER_MARGIN - ICON_SIZE),
            y: Math.max(y, TRIGGER_MARGIN)
          };
        }
      case 2: // left-bottom
        {
          const x = corners[i].x - TRIGGER_OFFSET - ICON_SIZE;
          const y = corners[i].y + TRIGGER_OFFSET;
          if (x < TRIGGER_MARGIN && y > window.innerHeight - TRIGGER_MARGIN - ICON_SIZE) break;
          return {
            x: Math.max(x, TRIGGER_MARGIN),
            y: Math.min(y, window.innerHeight - TRIGGER_MARGIN - ICON_SIZE)
          };
        }
      case 3: // right-bottom
        {
          const x = corners[i].x + TRIGGER_OFFSET;
          const y = corners[i].y + TRIGGER_OFFSET;
          if (x > window.innerWidth - TRIGGER_MARGIN - ICON_SIZE && y > window.innerHeight - TRIGGER_MARGIN - ICON_SIZE) break;
          return {
            x: Math.min(x, window.innerWidth - TRIGGER_MARGIN - ICON_SIZE),
            y: Math.min(y, window.innerHeight - TRIGGER_MARGIN - ICON_SIZE)
          };
        }
    }
  }
  // If all corners are off-screen, just put the trigger near the mouse point (but still try to keep it close to the selection).
  const x = Math.min(Math.max(0, mouseX), window.innerWidth);
  const y = Math.min(Math.max(0, mouseY), window.innerHeight);
  return { x, y };
}

/** Place the trigger just outside the selection, near the mouse release point. */
function computeTriggerPosition(range: Range, mouseX: number, mouseY: number): { x: number; y: number } {
  const corners = getSelectionCorners(range);
  return computePositionByCorners(corners, mouseX, mouseY);
}

/** True when the event originated inside the extension shadow UI host. */
function isInsideOurUI(e: Event): boolean {
  return e.composedPath().some(
    (el) => el instanceof HTMLElement && el.tagName?.toLowerCase() === 'lingua-lens',
  );
}

export default defineContentScript({
  matches: ['<all_urls>'],
  cssInjectionMode: 'ui',

  async main(ctx) {
    let appHandle: ContentAppHandle | null = null;
    type PendingSelection = { text: string; position: { x: number; y: number } };
    const pendingSelection: PendingSelection[] = [];
    const pendingTranslateNow: string[] = [];

    const flushPendingSelection = () => {
      if (!appHandle) return;
      while (pendingSelection.length > 0) {
        const p = pendingSelection.shift()!;
        appHandle.showTrigger(p.text, p.position);
      }
      while (pendingTranslateNow.length > 0) {
        const t = pendingTranslateNow.shift()!;
        appHandle.translateNow(t);
      }
    };

    const ui = await createShadowRootUi(ctx, {
      name: 'lingua-lens',
      // `modal` makes the inner <html> a full-viewport fixed layer (better than `overlay`).
      position: 'modal',
      zIndex: 2147483647,
      anchor: () => document.documentElement,
      append: 'last',
      onMount(container, shadow, shadowHost) {
        shieldOverlayHost(shadowHost);
        shieldShadowPortal(shadow, container);
        const wrapper = document.createElement('div');
        wrapper.style.setProperty('pointer-events', 'auto', 'important');
        container.append(wrapper);
        const root = ReactDOM.createRoot(wrapper);
        root.render(
          <ContentApp
            onReady={(handle) => {
              appHandle = handle;
              flushPendingSelection();
            }}
          />,
        );
        return { root, wrapper };
      },
      onRemove(elements) {
        elements?.root.unmount();
        elements?.wrapper.remove();
      },
    });

    ui.mount();

    // Selection-based translation trigger
    document.addEventListener('mouseup', (e) => {
      if (isInsideOurUI(e)) return;

      const mouseX = e.clientX;
      const mouseY = e.clientY;

      setTimeout(() => {
        const selection = window.getSelection();
        const text = selection?.toString().trim();
        if (text && text.length > 1) {
          const range = selection!.getRangeAt(0);
          appHandle?.showTrigger(text, computeTriggerPosition(range, mouseX, mouseY));
        }
      }, 10);
    });

    document.addEventListener('mousedown', (e) => {
      if (!isInsideOurUI(e)) {
        appHandle?.hide();
      }
    });

    // Listen for commands from popup / background / keyboard shortcuts
    browser.runtime.onMessage.addListener((message: Record<string, unknown>, _sender, sendResponse) => {
      switch (message.type) {
        case 'PING':
          sendResponse({ ok: true });
          break;
        case 'PAGE_TRANSLATE_START':
          appHandle?.startPageTranslation();
          sendResponse({ ok: true });
          break;
        case 'PAGE_TRANSLATE_STATUS':
          sendResponse({ active: appHandle?.isPageTranslationActive() ?? false });
          break;
        case 'PAGE_TRANSLATE_STOP':
          appHandle?.stopPageTranslation();
          sendResponse({ ok: true });
          break;
        case 'PAGE_TRANSLATE_RESTORE':
          appHandle?.restorePageTranslation();
          sendResponse({ ok: true });
          break;
        case 'TRANSLATE_SELECTION': {
          // Sent when the shortcut could not read the selection from the background (e.g. shadow DOM).
          // If the page still has a live selection, translate immediately — same as TRANSLATE_SELECTION_TEXT.
          const tryTranslateFromSelection = (): boolean => {
            const selection = window.getSelection();
            const text = selection?.toString().trim() ?? '';
            if (!text || text.length <= 1) return false;
            if (!selection?.rangeCount) return false;
            if (appHandle) {
              appHandle.translateNow(text);
            } else {
              pendingTranslateNow.push(text);
            }
            return true;
          };
          if (!tryTranslateFromSelection()) {
            requestAnimationFrame(() => {
              if (!tryTranslateFromSelection()) setTimeout(() => tryTranslateFromSelection(), 50);
            });
          }
          break;
        }
        case 'TRANSLATE_SELECTION_TEXT': {
          const payload = message.payload as { text: string };
          const text = (payload?.text ?? '').trim();
          if (!text) break;
          if (appHandle) {
            appHandle.translateNow(text);
          } else {
            pendingTranslateNow.push(text);
          }
          break;
        }
      }
    });
  },
});
