import ReactDOM from 'react-dom/client';
import { ContentApp, type ContentAppHandle } from './App';
import './style.css';

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
      position: 'overlay',
      zIndex: 2147483647,
      onMount(container) {
        const wrapper = document.createElement('div');
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
      if ((e.target as Element)?.closest?.('lingua-lens')) return;

      setTimeout(() => {
        const selection = window.getSelection();
        const text = selection?.toString().trim();
        if (text && text.length > 1) {
          const range = selection!.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          appHandle?.showTrigger(text, { x: rect.right, y: rect.top });
        }
      }, 10);
    });

    document.addEventListener('mousedown', (e) => {
      const path = e.composedPath();
      const isInsideOurUI = path.some(
        (el) => el instanceof HTMLElement && el.tagName?.toLowerCase() === 'lingua-lens',
      );
      if (!isInsideOurUI) {
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
          const selection = window.getSelection();
          const text = selection?.toString().trim();
          if (!text || text.length <= 1) break;
          const range = selection!.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          const position = { x: rect.right, y: rect.top };
          if (appHandle) {
            appHandle.showTrigger(text, position);
          } else {
            pendingSelection.push({ text, position });
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
