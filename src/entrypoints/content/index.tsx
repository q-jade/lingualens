import ReactDOM from 'react-dom/client';
import { ContentApp, type ContentAppHandle } from './App';
import {
  checkSelectionTranslateBlock,
  clearContextMenuSelectionBlock,
  isInsideOurUI,
  markContextMenuInExtensionUI,
} from './selection-ui-guard';
import { initI18n } from '../../shared/i18n';
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

export default defineContentScript({
  matches: ['<all_urls>'],
  cssInjectionMode: 'ui',

  async main(ctx) {
    await initI18n();
    let appHandle: ContentAppHandle | null = null;
    type PendingSelection = { text: string; mouseX: number; mouseY: number; range: Range };
    const pendingSelection: PendingSelection[] = [];
    const pendingTranslateNow: string[] = [];

    const flushPendingSelection = () => {
      if (!appHandle) return;
      while (pendingSelection.length > 0) {
        const p = pendingSelection.shift()!;
        appHandle.showTrigger(p.text, p.mouseX, p.mouseY, p.range);
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
        container.addEventListener('contextmenu', markContextMenuInExtensionUI, true);
        document.addEventListener('contextmenu', (e) => {
          if (!isInsideOurUI(e)) clearContextMenuSelectionBlock();
        }, true);
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

    // Selection-based translation trigger (mode-aware)
    document.addEventListener('mouseup', (e) => {
      if (isInsideOurUI(e)) return;

      const mouseX = e.clientX;
      const mouseY = e.clientY;

      setTimeout(() => {
        const selection = window.getSelection();
        const text = selection?.toString().trim();
        if (!text || text.length <= 1 || !selection?.rangeCount) return;
        const range = selection.getRangeAt(0);

        const mode = appHandle?.getSelectionTriggerMode() ?? 'icon';
        switch (mode) {
          case 'icon':
            if (appHandle) {
              appHandle.showTrigger(text, mouseX, mouseY, range);
            } else {
              pendingSelection.push({ text, mouseX, mouseY, range: range.cloneRange() });
            }
            break;
          case 'instant':
            if (appHandle) {
              appHandle.translateNow(text);
            } else {
              pendingTranslateNow.push(text);
            }
            break;
        // 'modifier' and 'off': do nothing on mouseup
        }
      }, 10);
    });

    // Modifier-key-alone listener for 'modifier' mode
    let modifierPending = false;

    document.addEventListener('keydown', (e) => {
      if (appHandle?.getSelectionTriggerMode() !== 'modifier') return;
      const configuredKey = appHandle?.getSelectionModifierKey() ?? 'ctrl';

      const isConfiguredModifier =
        (configuredKey === 'ctrl' && e.key === 'Control') ||
        (configuredKey === 'alt' && e.key === 'Alt') ||
        (configuredKey === 'shift' && e.key === 'Shift');

      if (isConfiguredModifier && !e.repeat) {
        modifierPending = true;
      } else if (modifierPending) {
        modifierPending = false;
      }
    }, true);

    document.addEventListener('keyup', (e) => {
      if (!modifierPending) return;
      const configuredKey = appHandle?.getSelectionModifierKey() ?? 'ctrl';

      const isConfiguredModifier =
        (configuredKey === 'ctrl' && e.key === 'Control') ||
        (configuredKey === 'alt' && e.key === 'Alt') ||
        (configuredKey === 'shift' && e.key === 'Shift');

      if (!isConfiguredModifier) return;
      modifierPending = false;

      const selection = window.getSelection();
      const text = selection?.toString().trim();
      if (!text || text.length <= 1) return;

      if (appHandle) {
        appHandle.translateNow(text);
      } else {
        pendingTranslateNow.push(text);
      }
    }, true);

    document.addEventListener('mousedown', (e) => {
      if (!isInsideOurUI(e)) {
        clearContextMenuSelectionBlock();
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
        case 'PAGE_TRANSLATE_STATUS': {
          const phase = appHandle?.getPageTranslatePhase() ?? 'idle';
          sendResponse({ phase, active: phase !== 'idle' });
          break;
        }
        case 'PAGE_TRANSLATE_STOP':
          appHandle?.stopPageTranslation();
          sendResponse({ ok: true });
          break;
        case 'PAGE_TRANSLATE_RESTORE':
          appHandle?.restorePageTranslation();
          sendResponse({ ok: true });
          break;
        case 'SHOULD_BLOCK_SELECTION_TRANSLATE':
          sendResponse({ block: checkSelectionTranslateBlock() });
          break;
        case 'TRANSLATE_SELECTION': {
          // Sent when the shortcut could not read the selection from the background (e.g. shadow DOM).
          // If the page still has a live selection, translate immediately — same as TRANSLATE_SELECTION_TEXT.
          if (checkSelectionTranslateBlock()) break;
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
        case 'SELECTION_MODE_CHANGED': {
          const payload = message.payload as { mode: string; modifierKey?: string };
          if (appHandle && payload?.mode) {
            appHandle.showModeToast(
              payload.mode as import('../../shared/types').SelectionTriggerMode,
              payload.modifierKey as import('../../shared/types').SelectionModifierKey | undefined,
            );
          }
          break;
        }
        case 'TRANSLATE_SELECTION_TEXT': {
          const payload = message.payload as { text: string };
          const text = (payload?.text ?? '').trim();
          if (!text || checkSelectionTranslateBlock()) break;
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
