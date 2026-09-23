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
 * Find an image covered by the current selection. Mixed selections (text +
 * image) prefer the image — the first <img> inside the range wins. Returns
 * the absolute URL (currentSrc resolves srcset; src resolves relative paths).
 */
function findImageInSelection(): string | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (range.collapsed) return null;

  const readUrl = (img: HTMLImageElement) => img.currentSrc || img.src || null;

  // Fast path: the cloned fragment literally contains the image.
  const fromFragment = range.cloneContents().querySelectorAll<HTMLImageElement>('img');
  if (fromFragment.length > 0) return readUrl(fromFragment[0]);

  // Fallback: the fragment can miss the image even when the selection covers
  // it — replaced elements anchor oddly, so the fragment may collapse to a
  // text node, or the <img> itself may be the range's common ancestor (empty
  // fragment, no descendants). Search from the common ancestor in BOTH
  // directions:
  // - up (`closest`): the ancestor IS the <img> — closest() includes self.
  // - down (`querySelectorAll`): the ancestor WRAPS the <img> (boundary
  //   points landed in surrounding nodes).
  // `intersectsNode` keeps both precise: without it, selecting "Hello" in
  // "Hello [img] world" resolves the ancestor to the <p> and would wrongly
  // match the unrelated inline image.
  const ancestor = range.commonAncestorContainer;
  const root = ancestor instanceof Element ? ancestor : ancestor.parentElement;
  const containing = root?.closest?.('img');
  if (containing && range.intersectsNode(containing)) return readUrl(containing);
  const candidates: HTMLImageElement[] = root
    ? Array.from(root.querySelectorAll<HTMLImageElement>('img'))
    : [];
  for (const img of candidates) {
    if (range.intersectsNode(img)) return readUrl(img);
  }

  return null;
}

/**
 * Rasterize a page image to a data URL via canvas. Only works for same-origin
 * or CORS-enabled images (cross-origin pixels taint the canvas); the
 * background fetch is the primary path, this is the fallback.
 */
function extractImageAsDataUrl(imageUrl: string): string | null {
  const img = document.querySelector<HTMLImageElement>(
    `img[src="${CSS.escape(imageUrl)}"], img[data-src="${CSS.escape(imageUrl)}"]`,
  );
  const source = img ?? new Image();
  if (!img) {
    source.crossOrigin = 'anonymous';
    source.src = imageUrl;
  }
  if (!source.complete || !source.naturalWidth) return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = source.naturalWidth;
    canvas.height = source.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    // Tainted canvas (cross-origin without CORS)
    return null;
  }
}

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

/**
 * Publish the browser's default font size as `--ll-root`, which
 * `tailwind.config.js` multiplies for every length in the overlay.
 *
 * The overlay must scale with the user's font-size setting
 * (chrome://settings/fonts) but NOT with the host page's root font-size. `rem`
 * cannot express that: on a page with `html { font-size: 100px }`
 * `rem` is 100px even inside our shadow root, because shadow DOM isolates
 * selectors, not units.
 *
 * `font-size: medium` is the correct probe. Absolute-size keywords resolve from
 * the user's default font size and never from the page root or an ancestor —
 * measured in Chromium, `medium` stayed 16px on a 100px-root page (even under a
 * 50px ancestor) while `1rem` read 100px, and `medium` tracked the setting at
 * 16 / 20 / 24px.
 *
 * Measured in the shadow root so no page selector can reach the probe. The
 * config's `var()` fallback covers the (brief) window before this runs.
 */
function publishUserFontSize(shadowHost: HTMLElement, shadow: ShadowRoot) {
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;font-size:medium;';
  shadow.append(probe);
  const userFontSize = window.getComputedStyle(probe).fontSize;
  probe.remove();
  if (userFontSize) shadowHost.style.setProperty('--ll-root', userFontSize);
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
    type PendingImageTrigger = { imageUrl: string; mouseX: number; mouseY: number; range: Range };
    const pendingImageTriggers: PendingImageTrigger[] = [];
    const pendingImageTranslateNow: string[] = [];

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
      while (pendingImageTriggers.length > 0) {
        const p = pendingImageTriggers.shift()!;
        appHandle.showImageTrigger(p.imageUrl, p.mouseX, p.mouseY, p.range);
      }
      while (pendingImageTranslateNow.length > 0) {
        const u = pendingImageTranslateNow.shift()!;
        appHandle.translateImageNow(u);
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
        publishUserFontSize(shadowHost, shadow);
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

    // Report presence on right-click so the background can synchronously tell
    // pages WITH a content script (in-page bubble) apart from pages without
    // one (route to side panel) in the context-menu click handler. Capture
    // phase fires before any page/PDF-viewer handler can stop the event.
    // The report also carries the selection's image state so the background
    // can switch the selection menu title to "Translate Image".
    const reportPresence = () => {
      const imageUrl = findImageInSelection();
      browser.runtime.sendMessage({
        type: 'CONTEXT_MENU_PRESENCE',
        payload: { hasImage: Boolean(imageUrl), imageUrl: imageUrl ?? '' },
      }).catch(() => {});
    };
    document.addEventListener('contextmenu', reportPresence, true);
    document.addEventListener('mousedown', (e) => {
      if (e.button === 2) reportPresence();
    }, true);

    // Selection-based translation trigger (mode-aware)
    document.addEventListener('mouseup', (e) => {
      if (isInsideOurUI(e)) return;

      const mouseX = e.clientX;
      const mouseY = e.clientY;

      setTimeout(() => {
        const selection = window.getSelection();
        const text = selection?.toString().trim();
        if (!selection?.rangeCount) return;
        const range = selection.getRangeAt(0);

        // Selection covers an image (mixed selections prefer the image).
        const imageUrl = findImageInSelection();
        if (imageUrl) {
          const mode = appHandle?.getSelectionTriggerMode() ?? 'icon';
          if (mode === 'instant') {
            if (appHandle) {
              appHandle.translateImageNow(imageUrl);
            } else {
              pendingImageTranslateNow.push(imageUrl);
            }
          } else if (mode === 'icon') {
            if (appHandle) {
              appHandle.showImageTrigger(imageUrl, mouseX, mouseY, range);
            } else {
              pendingImageTriggers.push({ imageUrl, mouseX, mouseY, range: range.cloneRange() });
            }
          }
          // 'modifier' and 'off': do nothing on mouseup
          return;
        }

        if (!text || text.length <= 1) return;

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
      if (!selection?.rangeCount) return;

      // Mixed selections prefer the image (same rule as mouseup).
      const imageUrl = findImageInSelection();
      if (imageUrl) {
        if (appHandle) {
          appHandle.translateImageNow(imageUrl);
        } else {
          pendingImageTranslateNow.push(imageUrl);
        }
        return;
      }

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
          sendResponse({ phase });
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
        case 'TRANSLATE_IMAGE_IN_TAB': {
          // Image context menu / image-in-selection from the background.
          const payload = message.payload as { imageUrl?: string };
          const imageUrl = payload?.imageUrl;
          if (!imageUrl || checkSelectionTranslateBlock()) break;
          if (appHandle) {
            appHandle.translateImageNow(imageUrl);
          } else {
            pendingImageTranslateNow.push(imageUrl);
          }
          break;
        }
        case 'EXTRACT_IMAGE_DATA_URL': {
          // Background fetch failed (page-scoped blob:, hotlink protection):
          // rasterize the image in the page via canvas.
          const payload = message.payload as { imageUrl?: string };
          const dataUrl = payload?.imageUrl ? extractImageAsDataUrl(payload.imageUrl) : null;
          sendResponse({ dataUrl });
          break;
        }
      }
    });
  },
});
