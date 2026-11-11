import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppSettings, MessageResponse, RoutedSidepanelSelection } from '../../shared/types';
import { SUPPORTED_LANGUAGES } from '../../shared/constants';
import { getTranslatorLanguages, setTranslatorLanguages, subscribeTranslatorLanguages } from '../../shared/translator-languages';
import { ProviderPicker } from '../../shared/ProviderPicker';
import { CopyButton } from '../../shared/CopyButton';
import { shortcutLabel } from '../../shared/shortcut';
import { startImageStreamTranslate, startStreamTranslate } from '../../shared/stream-translate';
import { blobToDataUrl, downscaleImageBlob, fetchImageAsDataUrl, MAX_IMAGE_BYTES } from '../../shared/image-data';
import { NO_TEXT_IN_IMAGE, visibleImageStreamText } from '../../shared/image-translation';

interface HistoryEntry {
  id: number;
  source: string;
  translated: string;
  targetLang: string;
  provider: string;
  timestamp: number;
}

type InputMode = 'text' | 'image';

/** An image loaded from a file, the clipboard, or a web URL. */
interface LoadedImage {
  /** Decoded pixels — the provider payload AND the cache identity (no stable URL to key on). */
  dataUrl: string;
  /** File name, or the URL's last path segment. */
  name: string;
  /** Pixel dimensions; 0 when the probe failed (the image still translates). */
  width: number;
  height: number;
}

const ERROR_KEYS: Record<string, string> = {
  NO_PROVIDER: 'sidepanel.noProvider',
  TRANSLATION_FAILED: 'sidepanel.translationFailed',
  NO_IMAGE_PROVIDER: 'sidepanel.noImageProvider',
  IMAGE_FETCH_FAILED: 'sidepanel.imageFetchFailed',
  NOT_AN_IMAGE: 'sidepanel.notAnImage',
  IMAGE_TOO_LARGE: 'sidepanel.imageTooLarge',
  IMAGE_READ_FAILED: 'sidepanel.imageReadFailed',
};

/**
 * Text files dropped into the panel are a convenience, not a bulk-import
 * feature — the whole file becomes the input box.
 */
const MAX_TEXT_BYTES = 1024 * 1024;
const TEXT_FILE_EXTENSION = /\.(txt|md|markdown|json|csv|tsv|log|srt|vtt|ya?ml|xml|html?|ini|conf|properties)$/i;
const IMAGE_FILE_EXTENSION = /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i;

/**
 * How long a source-load failure stays on screen. A failed load leaves the
 * PREVIOUS source untouched, so a permanent banner would sit over a perfectly
 * usable text box or image and read as "this input is broken" — the failure
 * belongs to the attempt, not to what is currently loaded.
 */
const SOURCE_ERROR_MS = 5000;

/**
 * Whether a dropped file is one this panel can consume. A drag from a web page
 * can carry BOTH a URL and a synthetic "DownloadURL" file; the URL is preferred
 * when the file itself is not usable (see the drop handler).
 */
function isConsumableFile(file: File): boolean {
  return (
    file.type.startsWith('image/') ||
    IMAGE_FILE_EXTENSION.test(file.name) ||
    file.type.startsWith('text/') ||
    file.type === 'application/json' ||
    TEXT_FILE_EXTENSION.test(file.name)
  );
}

/** Name for an image dragged in from a web page, derived from its URL. */
function imageNameFromUrl(url: string): string {
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    const name = decodeURIComponent(segments[segments.length - 1] ?? '');
    return name || url;
  } catch {
    return url;
  }
}

/** Pixel dimensions of a data URL; resolves 0×0 when it cannot be decoded. */
function readImageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const probe = new Image();
    probe.onload = () => resolve({ width: probe.naturalWidth, height: probe.naturalHeight });
    probe.onerror = () => resolve({ width: 0, height: 0 });
    probe.src = dataUrl;
  });
}

export function App() {
  const { t } = useTranslation();

  const translateError = (err: string | undefined): string =>
    err ? (ERROR_KEYS[err] ? t(ERROR_KEYS[err]) : err) : t('sidepanel.translationFailed');

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [sourceLang, setSourceLang] = useState<string | null>(null);
  const [targetLang, setTargetLang] = useState<string | null>(null);
  const langsReady = sourceLang !== null && targetLang !== null;
  const [sourceText, setSourceText] = useState('');
  const [translation, setTranslation] = useState('');
  /**
   * A translation request is in flight (text OR image) — it drives the
   * translate button's spinner and the loading state of the result pane. Not
   * to be confused with `loadingImage`, which is only about reading pixels
   * into the source before any request exists.
   */
  const [translating, setTranslating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [splitRatio, setSplitRatio] = useState(0.5);
  /**
   * Text and image input keep separate state: switching modes never discards
   * what the other mode holds. The RESULT area is shared, so changing the
   * source (mode switch, new image, loaded text file) clears it.
   */
  const [inputMode, setInputMode] = useState<InputMode>('text');
  const [image, setImage] = useState<LoadedImage | null>(null);
  /**
   * Decoding/encoding an image into `image` (clipboard bitmap, local file, or
   * a fetched web URL) has not finished yet. Purely a source-side state — no
   * provider has been contacted, so `translating` stays false throughout.
   */
  const [loadingImage, setLoadingImage] = useState(false);
  /** Source-side failure (bad file, oversized, unreadable) — not a translation error. */
  const [sourceError, setSourceError] = useState<string | null>(null);
  /** True while a file or URL is dragged over the panel. */
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // Latest-state mirrors so the one-time runtime message listener can translate
  // selections that arrive from the background at any point.
  const sourceLangRef = useRef<string | null>(null);
  const targetLangRef = useRef<string | null>(null);
  const historyRef = useRef<HistoryEntry[]>([]);
  const inputModeRef = useRef<InputMode>('text');
  sourceLangRef.current = sourceLang;
  targetLangRef.current = targetLang;
  historyRef.current = history;
  inputModeRef.current = inputMode;
  // Cancel for the in-flight streaming request — a re-translate disconnects
  // the old port (background aborts the request) before starting a new one.
  const cancelStreamRef = useRef<(() => void) | null>(null);

  // Focus the input as soon as the panel opens so the user can start typing
  // immediately — and again whenever text mode becomes active, since the
  // textarea is not mounted while image mode is showing (focusing it from the
  // click handler would race that render).
  useEffect(() => {
    if (inputMode === 'text') textareaRef.current?.focus();
  }, [inputMode]);

  // Source-load failures are transient (see SOURCE_ERROR_MS). Every load path
  // clears the message when it starts, so this timer is for the cases where NO
  // further load follows — a drop that resolved to neither a file nor a URL
  // (the last branch of onDrop). Without it that one message would sit above a
  // still-valid text box or image indefinitely.
  useEffect(() => {
    if (!sourceError) return;
    const timer = setTimeout(() => setSourceError(null), SOURCE_ERROR_MS);
    return () => clearTimeout(timer);
  }, [sourceError]);

  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = contentRef.current;
    if (!container) return;

    const onMove = (ev: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const ratio = Math.min(0.8, Math.max(0.2, (ev.clientY - rect.top) / rect.height));
      setSplitRatio(ratio);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  useEffect(() => {
    browser.runtime.sendMessage({ type: 'GET_SETTINGS' }).then(
      async (res: MessageResponse<AppSettings>) => {
        if (res.success) setSettings(res.data);
        const langs = await getTranslatorLanguages(
          res.success
            ? { sourceLang: res.data.defaultSourceLang, targetLang: res.data.defaultTargetLang }
            : undefined,
        );
        setSourceLang(langs.sourceLang);
        setTargetLang(langs.targetLang);
      },
    );
    browser.storage.local.get('translationHistory').then((result) => {
      if (result.translationHistory) setHistory(result.translationHistory as HistoryEntry[]);
    });

    const onStorageChanged = (changes: Record<string, { newValue?: unknown }>) => {
      if (changes.settings) {
        const next = changes.settings.newValue as AppSettings | undefined;
        if (next) setSettings(next);
      }
    };
    browser.storage.onChanged.addListener(onStorageChanged);

    const unsubLangs = subscribeTranslatorLanguages((langs) => {
      setSourceLang(langs.sourceLang);
      setTargetLang(langs.targetLang);
    });

    return () => {
      browser.storage.onChanged.removeListener(onStorageChanged);
      unsubLangs();
    };
  }, []);

  const translateText = (
    text: string,
    explicitSourceLang?: string,
    explicitTargetLang?: string,
  ) => {
    const trimmed = text.trim();
    const srcLang = explicitSourceLang || sourceLangRef.current;
    const dstLang = explicitTargetLang || targetLangRef.current;
    if (!trimmed || !srcLang || !dstLang) return;

    // A newer request owns the panel: cancel the previous stream first so
    // the background aborts its request instead of racing this one.
    cancelStreamRef.current?.();
    setTranslating(true);
    setError(null);
    setTranslation('');

    cancelStreamRef.current = startStreamTranslate(
      { text: trimmed, sourceLang: srcLang, targetLang: dstLang, applyAdditionalPrompt: true },
      {
        // Incremental render — this is the point of streaming.
        onChunk: (delta) => setTranslation((prev) => prev + delta),
        // The done result carries the trim()'d full text and the provider
        // that ACTUALLY produced it (possibly a fallback) — overwrite the
        // accumulated deltas and record history exactly like the one-shot
        // path did.
        onDone: (result) => {
          setTranslation(result.translated);
          setTranslating(false);
          cancelStreamRef.current = null;

          const entry: HistoryEntry = {
            id: Date.now(),
            source: trimmed,
            translated: result.translated,
            targetLang: dstLang,
            provider: result.provider,
            timestamp: Date.now(),
          };
          const deduplicated = historyRef.current.filter(
            (h) => h.source !== trimmed || h.targetLang !== dstLang || h.provider !== result.provider,
          );
          const updated = [entry, ...deduplicated].slice(0, 50);
          setHistory(updated);
          void browser.storage.local.set({ translationHistory: updated }).catch((err: unknown) => {
            if (err instanceof Error && /quota/i.test(err.message)) {
              // Quota exceeded — keep only the most recent half
              const trimmedHistory = updated.slice(0, Math.max(1, Math.floor(updated.length / 2)));
              setHistory(trimmedHistory);
              void browser.storage.local.set({ translationHistory: trimmedHistory }).catch(() => {
                // Give up — in-memory history still works this session
              });
            }
          });
        },
        onError: (err) => {
          setError(translateError(err));
          setTranslating(false);
          cancelStreamRef.current = null;
        },
      },
    );
  };

  /**
   * Drop whatever the result area shows and abort its stream. Source and
   * result are one surface: replacing the source invalidates the result.
   */
  const resetResult = () => {
    cancelStreamRef.current?.();
    cancelStreamRef.current = null;
    setTranslating(false);
    setTranslation('');
    setError(null);
  };

  const switchInputMode = (next: InputMode) => {
    if (next === inputModeRef.current) return;
    // A load failure belongs to the mode that produced it: leaving that mode
    // must not leave a stale "could not read the image" over the text box.
    setSourceError(null);
    resetResult();
    setInputMode(next);
  };

  const loadImageFile = async (file: File) => {
    setSourceError(null);
    if (file.size > MAX_IMAGE_BYTES) {
      setSourceError(t('sidepanel.imageTooLarge'));
      return;
    }
    setLoadingImage(true);
    try {
      // Same downscale/encode path as page images: vision models resize to a
      // 1568 px long edge internally anyway, so this only cuts payload size.
      const dataUrl = await blobToDataUrl(await downscaleImageBlob(file));
      const size = await readImageSize(dataUrl);
      switchInputMode('image');
      // Replacing the image also invalidates a result for the previous one.
      resetResult();
      setImage({ dataUrl, name: file.name || t('sidepanel.modeImage'), ...size });
    } catch {
      setSourceError(t('sidepanel.imageReadFailed'));
    } finally {
      setLoadingImage(false);
    }
  };

  /** Load an image by URL (dragged from a web page, which yields no file). */
  const loadImageUrl = async (url: string) => {
    setSourceError(null);
    setLoadingImage(true);
    try {
      const dataUrl = await fetchImageAsDataUrl(url);
      const size = await readImageSize(dataUrl);
      switchInputMode('image');
      resetResult();
      setImage({ dataUrl, name: imageNameFromUrl(url), ...size });
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      setSourceError(
        code === 'NOT_AN_IMAGE'
          ? t('sidepanel.notAnImage')
          : code === 'IMAGE_TOO_LARGE'
            ? t('sidepanel.imageTooLarge')
            : t('sidepanel.imageFetchFailed'),
      );
    } finally {
      setLoadingImage(false);
    }
  };

  const loadTextFile = async (file: File) => {
    setSourceError(null);
    if (file.size > MAX_TEXT_BYTES) {
      setSourceError(t('sidepanel.textFileTooLarge'));
      return;
    }
    try {
      const text = await file.text();
      resetResult();
      setInputMode('text');
      setSourceText(text);
      textareaRef.current?.focus();
    } catch {
      setSourceError(t('sidepanel.textFileReadFailed'));
    }
  };

  /** Route a dropped/selected file by type: image → image mode, text → input box. */
  const handleFile = (file: File) => {
    const isImage = file.type.startsWith('image/') || IMAGE_FILE_EXTENSION.test(file.name);
    const isText =
      file.type.startsWith('text/') ||
      file.type === 'application/json' ||
      TEXT_FILE_EXTENSION.test(file.name);
    if (isImage) void loadImageFile(file);
    else if (isText) void loadTextFile(file);
    else setSourceError(t('sidepanel.unsupportedFile'));
  };

  const clearImage = () => {
    resetResult();
    setSourceError(null);
    setImage(null);
  };

  /**
   * Latest paste/drop actions for the document-level listeners registered
   * once below: the listeners must outlive re-renders, while their messages
   * need the current UI language.
   */
  const dropActionsRef = useRef({
    file: (_file: File) => { },
    url: (_url: string) => { },
    failure: '',
  });
  dropActionsRef.current = {
    file: handleFile,
    url: (url: string) => void loadImageUrl(url),
    failure: t('sidepanel.imageFetchFailed'),
  };

  // Paste and drag & drop listen on the document: the whole panel accepts an
  // image, so the user does not have to aim at the drop zone. Text pasted or
  // dragged into the textarea is handled by the browser itself.
  useEffect(() => {
    const isPayload = (transfer: DataTransfer | null) => {
      const types = Array.from(transfer?.types ?? []);
      return types.includes('Files') || types.includes('text/uri-list');
    };

    const onPaste = (event: ClipboardEvent) => {
      const data = event.clipboardData;
      if (!data) return;
      for (const item of Array.from(data.items)) {
        if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
        const file = item.getAsFile();
        if (!file) continue;
        event.preventDefault();
        dropActionsRef.current.file(file);
        return;
      }
      // No image on the clipboard. In image mode there is no textarea to
      // receive the text, so the paste would be silently swallowed — hand it
      // to the text input instead (the two modes are one surface).
      if (inputModeRef.current !== 'image') return;
      const text = data.getData('text/plain');
      if (!text.trim()) return;
      event.preventDefault();
      resetResult();
      setSourceText(text);
      setInputMode('text');
      textareaRef.current?.focus();
    };

    const onDragEnter = (event: DragEvent) => {
      if (!isPayload(event.dataTransfer)) return;
      event.preventDefault();
      dragDepthRef.current += 1;
      setDragging(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (!isPayload(event.dataTransfer)) return;
      // Required for `drop` to fire at all, and it stops the browser from
      // navigating away to the dropped file.
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };
    const onDragLeave = (event: DragEvent) => {
      if (!isPayload(event.dataTransfer)) return;
      // dragenter/dragleave fire for every child element crossed: only the
      // last one leaving the panel drops the counter to zero.
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!isPayload(event.dataTransfer)) return;
      event.preventDefault();
      dragDepthRef.current = 0;
      setDragging(false);
      const file = event.dataTransfer?.files?.[0];
      // A web image drags as a URL; Chrome may also expose a synthetic
      // "DownloadURL" File with no bytes. Prefer the file only when it is
      // consumable AND actually carries data, otherwise fetch the URL.
      if (file && file.size > 0 && isConsumableFile(file)) {
        dropActionsRef.current.file(file);
        return;
      }
      const url = (event.dataTransfer?.getData('text/uri-list') ?? '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line && !line.startsWith('#') && /^https?:/i.test(line));
      if (url) {
        dropActionsRef.current.url(url);
        return;
      }
      if (file) {
        dropActionsRef.current.file(file);
        return;
      }
      setSourceError(dropActionsRef.current.failure);
    };

    document.addEventListener('paste', onPaste);
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('paste', onPaste);
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  /**
   * Translate the loaded image. The data URL is both the provider payload and
   * the cache identity — a pasted or dropped image has no stable URL to key
   * on, and the cache layer hashes the value instead of storing it.
   */
  const translateImage = () => {
    if (!image) return;
    const srcLang = sourceLangRef.current;
    const dstLang = targetLangRef.current;
    if (!srcLang || !dstLang) return;

    // A newer request owns the result area: cancel the previous stream so the
    // background aborts it instead of racing this one.
    cancelStreamRef.current?.();
    cancelStreamRef.current = null;
    setTranslating(true);
    setError(null);
    setTranslation('');

    let accumulated = '';
    cancelStreamRef.current = startImageStreamTranslate(
      // The pixels ARE the identity: there is no URL to key on, so the data URL
      // doubles as the cache key. `imageUrl` stays empty instead of repeating
      // it — providers read `image` only, and the cache falls back to
      // `cacheKey` (see imageCacheKey in the background).
      { imageUrl: '', image: image.dataUrl, cacheKey: image.dataUrl, sourceLang: srcLang, targetLang: dstLang },
      {
        onChunk: (delta) => {
          accumulated += delta;
          // The NO_TEXT_IN_IMAGE sentinel arrives in pieces — hide the prefix
          // so the panel never flashes a truncation of the literal token.
          setTranslation(visibleImageStreamText(accumulated));
        },
        // The done result is the trim()'d full text — overwrite the raw
        // accumulated deltas to match the non-streaming render, and map an
        // exact sentinel to the localized message.
        onDone: (result) => {
          cancelStreamRef.current = null;
          setTranslation(
            result.translated === NO_TEXT_IN_IMAGE
              ? t('sidepanel.noTextInImage')
              : result.translated,
          );
          setTranslating(false);
        },
        onError: (err) => {
          cancelStreamRef.current = null;
          setError(translateError(err));
          setTranslating(false);
        },
      },
    );
  };

  /**
   * Translate whatever the source holds. Both modes share the result area and
   * the cancel slot, so a switch between them supersedes the previous request
   * (see resetResult).
   */
  const handleTranslate = () => {
    if (inputMode === 'image') translateImage();
    else void translateText(sourceText);
  };

  /**
   * Ctrl/Cmd+Enter, identical in both modes. It lives on the document rather
   * than on the textarea so image mode (which has no focused input) can use it
   * too — and, as a side effect, text mode keeps working when focus has moved
   * off the box. The refs keep the one-time listener reading current state.
   */
  const translateShortcutRef = useRef<() => void>(() => { });
  const shortcutActiveRef = useRef(false);
  translateShortcutRef.current = handleTranslate;
  // Hidden while the history view replaces the source/result panes.
  shortcutActiveRef.current = !showHistory;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
      if (!shortcutActiveRef.current) return;
      event.preventDefault();
      translateShortcutRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // Selection routed from the background but languages not loaded yet — flush it
  // once the pair is known so the routed text always gets translated.
  const pendingRouteRef = useRef<string | null>(null);

  /** Fill the input with a routed selection; translate once languages are known. */
  const routeSelectionToInput = (text: string, srcLang?: string, dstLang?: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    // A routed selection is always text — it replaces whatever the source
    // showed, including an image.
    switchInputMode('text');
    // Redundant when the mode actually changed (switchInputMode clears it),
    // but a route while ALREADY in text mode must not keep a stale load error
    // over the incoming text.
    setSourceError(null);
    setSourceText(trimmed);
    // Adopt the page-translation language pair for this routed selection so
    // the result matches what the page itself would have translated to.
    if (srcLang) setSourceLang(srcLang);
    if (dstLang) setTargetLang(dstLang);
    textareaRef.current?.focus();
    if ((srcLang || sourceLangRef.current) && (dstLang || targetLangRef.current)) {
      void translateText(trimmed, srcLang, dstLang);
    } else {
      pendingRouteRef.current = trimmed;
    }
  };

  useEffect(() => {
    if (sourceLang === null || targetLang === null) return;
    const pending = pendingRouteRef.current;
    if (!pending) return;
    pendingRouteRef.current = null;
    void translateText(pending);
  }, [sourceLang, targetLang]);

  // Selections routed from the background on pages where content scripts cannot
  // run (e.g. the browser PDF viewer): fill the input and translate immediately.
  useEffect(() => {
    const onMessage = (
      message: Record<string, unknown>,
      _sender: unknown,
      sendResponse: (response: unknown) => void,
    ) => {
      if (message?.type !== 'TRANSLATE_SELECTION_VIA_SIDEPANEL') return;
      const payload = message.payload as {
        text?: string;
        sourceLang?: string;
        targetLang?: string;
      };
      const text = (payload?.text ?? '').trim();
      if (text) routeSelectionToInput(text, payload?.sourceLang, payload?.targetLang);
      sendResponse({ success: true });
    };
    browser.runtime.onMessage.addListener(onMessage);

    // Pull a selection that was routed here while this panel was still loading.
    browser.runtime
      .sendMessage({ type: 'SIDEPANEL_READY' })
      .then((res: MessageResponse<RoutedSidepanelSelection | null> | undefined) => {
        const data = res?.success ? res.data : null;
        if (data?.text) routeSelectionToInput(data.text, data.sourceLang, data.targetLang);
      })
      .catch(() => {});

    return () => {
      browser.runtime.onMessage.removeListener(onMessage);
    };
  }, []);

  const swapLanguages = () => {
    // Swap exchanges the source and result TEXT. Image mode has no source text
    // to exchange, so it is disabled there (see the button's `disabled`).
    if (!langsReady || sourceLang === 'auto' || inputMode === 'image') return;
    // The swap overwrites the result area — a still-running stream would
    // append its late chunks onto the swapped text. Kill it first.
    cancelStreamRef.current?.();
    cancelStreamRef.current = null;
    const nextSource = targetLang;
    const nextTarget = sourceLang;
    setSourceLang(nextSource);
    setTargetLang(nextTarget);
    setSourceText(translation);
    setTranslation(sourceText);
    void setTranslatorLanguages({ sourceLang: nextSource, targetLang: nextTarget });
  };

  const loadHistoryEntry = (entry: HistoryEntry) => {
    // Same protection as swapLanguages: the loaded entry owns the result
    // area now, a stale stream must not append onto it.
    cancelStreamRef.current?.();
    cancelStreamRef.current = null;
    setTranslating(false);
    // History only holds text translations.
    setInputMode('text');
    // Same reasoning as switchInputMode: a load failure from the source being
    // replaced must not survive over the loaded entry.
    setSourceError(null);
    setSourceText(entry.source);
    setTranslation(entry.translated);
    setTargetLang(entry.targetLang);
    void setTranslatorLanguages({
      sourceLang: sourceLang ?? 'auto',
      targetLang: entry.targetLang,
    });
    setShowHistory(false);
  };

  const setDefaultProvider = (providerId: string) => {
    if (!settings) return;
    const nextFallbackProviders = settings.fallbackProviders.filter((id) => id !== providerId);
    setSettings({
      ...settings,
      defaultProvider: providerId,
      fallbackProviders: nextFallbackProviders,
    });
    void browser.runtime.sendMessage({
      type: 'SAVE_SETTINGS',
      payload: { defaultProvider: providerId, fallbackProviders: nextFallbackProviders },
    });
  };

  return (
    <div className="relative flex flex-col h-full bg-white">
      {/* Brand accent bar */}
      <div
        aria-hidden="true"
        className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-blue-400 to-indigo-400"
      />
      {/* Language bar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-100 bg-gray-50 min-w-0">
        <select
          value={sourceLang ?? ''}
          disabled={!langsReady}
          onChange={(e) => {
            const next = e.target.value;
            setSourceLang(next);
            if (targetLang) void setTranslatorLanguages({ sourceLang: next, targetLang });
          }}
          className="input ll-select flex-1 min-w-0"
        >
          {SUPPORTED_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
        </select>
        <button
          onClick={swapLanguages}
          disabled={!langsReady || sourceLang === 'auto' || inputMode === 'image'}
          className="p-1 text-gray-400 hover:text-blue-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title={t('sidepanel.swapLanguages')}
          aria-label={t('sidepanel.swapLanguages')}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m7 16 4 4 4-4" /><path d="M11 20V4" /><path d="m17 8-4-4-4 4" /><path d="M13 4v16" />
          </svg>
        </button>
        <select
          value={targetLang ?? ''}
          disabled={!langsReady}
          onChange={(e) => {
            const next = e.target.value;
            setTargetLang(next);
            if (sourceLang) void setTranslatorLanguages({ sourceLang, targetLang: next });
          }}
          className="input ll-select flex-1 min-w-0"
        >
          {SUPPORTED_LANGUAGES.filter((l) => l.code !== 'auto').map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
        </select>
      </div>

      {/* No-provider guidance */}
      {settings && settings.providers.length === 0 && (
        <div className="px-3 py-2 bg-amber-50 border-b border-amber-100 text-xs text-amber-700 flex items-center gap-2">
          <span className="flex-1">{t('sidepanel.noProvider')}</span>
          <button
            type="button"
            onClick={() => browser.runtime.openOptionsPage()}
            className="font-medium text-amber-800 hover:underline shrink-0"
          >
            {t('sidepanel.settings')}
          </button>
        </div>
      )}

      {/* Main content */}
      <div ref={contentRef} className="flex-1 flex flex-col overflow-hidden">
        {showHistory ? (
          <HistoryPanel history={history} onSelect={loadHistoryEntry} onClear={() => { setHistory([]); browser.storage.local.remove('translationHistory'); }} onBack={() => setShowHistory(false)} />
        ) : (
          <>
            {/* Source */}
            <div className="flex flex-col min-h-0" style={{ flex: `${splitRatio} 1 0%` }}>
              {/* Mode switch — text and image keep separate state, and the mode
                  also changes implicitly when a file is pasted or dropped. */}
              <div className="side-mode-bar">
                <div className="side-seg" role="group" aria-label={t('sidepanel.inputMode')}>
                  {(['text', 'image'] as InputMode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={inputMode === m}
                      onClick={() => switchInputMode(m)}
                      className={`side-seg-item ${inputMode === m ? 'side-seg-item-active' : ''}`}
                    >
                      {m === 'text' ? t('sidepanel.modeText') : t('sidepanel.modeImage')}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="ml-auto shrink-0 text-[calc(var(--ll-u)*11)] font-medium text-blue-500 hover:text-blue-600"
                >
                  {t('sidepanel.openFile')}
                </button>
              </div>
              {sourceError && (
                <div className="ll-error px-4 py-2 text-xs flex items-start gap-2" role="status">
                  <span className="flex-1 min-w-0">{sourceError}</span>
                  <button
                    type="button"
                    onClick={() => setSourceError(null)}
                    className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
                    title={t('options.dismiss')}
                    aria-label={t('options.dismiss')}
                  >
                    ×
                  </button>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,text/plain,.txt,.md,.markdown,.json,.csv,.tsv,.log,.srt,.vtt,.yaml,.yml"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  // Reset so choosing the same file twice fires `change` again.
                  e.target.value = '';
                  if (file) handleFile(file);
                }}
              />

              {inputMode === 'text' ? (
                <textarea
                  ref={textareaRef}
                  value={sourceText}
                  onChange={(e) => setSourceText(e.target.value)}
                  placeholder={t('sidepanel.placeholder')}
                  // Ctrl/Cmd+Enter is handled at the document level so both
                  // modes share one shortcut implementation.
                  className="flex-1 w-full px-4 py-3 text-sm resize-none focus:outline-none"
                />
              ) : loadingImage ? (
                <div className="flex flex-1 items-center justify-center gap-2 text-sm text-gray-400">
                  <span className="ll-spinner" />
                  {t('sidepanel.imageLoading')}
                </div>
              ) : image ? (
                <div className="side-image-preview">
                  <img src={image.dataUrl} alt="" draggable={false} />
                </div>
              ) : (
                // Clicking both opens the picker and gives the panel document
                // keyboard focus, which Chrome does not do when the side panel
                // opens — without that first click a Ctrl+V would be lost
                // (crbug.com/40896667).
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className={`side-drop ${dragging ? 'side-drop-active' : ''}`}
                >
                  <svg className="w-6 h-6 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="9" cy="9" r="2" />
                    <path d="m21 15-4.586-4.586a2 2 0 0 0-2.828 0L3 21" />
                  </svg>
                  <span>{t('sidepanel.imageEmptyHint')}</span>
                  <span className="text-[calc(var(--ll-u)*11)] text-gray-400">
                    {t('sidepanel.imageEmptySubhint')}
                  </span>
                </button>
              )}

              <div className="flex items-center justify-between gap-2 px-4 py-2 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  {inputMode === 'text' ? (
                    <>
                      <span className="text-[calc(var(--ll-u)*10)] text-gray-400">{t('sidepanel.chars', { count: sourceText.length })}</span>
                      {sourceText && (
                        <button
                          onClick={() => {
                            // Same contract as clearing an image: the result
                            // and any in-flight stream belong to the source
                            // that is disappearing.
                            resetResult();
                            setSourceError(null);
                            setSourceText('');
                            textareaRef.current?.focus();
                          }}
                          className="text-[calc(var(--ll-u)*10)] text-gray-400 hover:text-red-400 transition-colors"
                        >
                          {t('sidepanel.clear')}
                        </button>
                      )}
                    </>
                  ) : (
                    image && (
                      <>
                        <span className="text-[calc(var(--ll-u)*10)] text-gray-400 truncate">
                          {image.name}
                          {image.width ? ` · ${image.width}×${image.height}` : ''}
                        </span>
                        <button
                          onClick={clearImage}
                          className="shrink-0 text-[calc(var(--ll-u)*10)] text-gray-400 hover:text-red-400 transition-colors"
                        >
                          {/* Same label as the text-mode clear: both discard the
                              current source and leave an empty input. */}
                          {t('sidepanel.clear')}
                        </button>
                      </>
                    )
                  )}
                </div>
                <button
                  onClick={handleTranslate}
                  disabled={
                    translating ||
                    loadingImage ||
                    !langsReady ||
                    (inputMode === 'text' ? !sourceText.trim() : !image)
                  }
                  className="ll-btn-primary ll-btn-sm shrink-0"
                >
                  {translating ? (
                    <span className="flex items-center gap-1.5">
                      <span className="ll-spinner-light" />
                      {t('sidepanel.translating')}
                    </span>
                  ) : `${t('sidepanel.translate')} ${shortcutLabel('↵')}`}
                </button>
              </div>
            </div>

            {/* Draggable divider */}
            <div
              onMouseDown={onDividerMouseDown}
              className="h-1.5 shrink-0 cursor-row-resize bg-gray-100 hover:bg-blue-200 transition-colors flex items-center justify-center"
            >
              <div className="w-8 h-0.5 rounded-full bg-gray-300" />
            </div>

            {/* Translation result */}
            <div className="flex flex-col min-h-0" style={{ flex: `${1 - splitRatio} 1 0%` }}>
              {error && <div className="ll-error px-4 py-3 text-sm">{error}</div>}
              {!error && (
                <div className="flex-1 overflow-y-auto px-4 py-3 bg-gray-50/60">
                  {/* Translation takes precedence over the spinner: with
                      streaming, chunks arrive while `translating` is still
                      true — hiding the text behind the spinner would defeat
                      the purpose of streaming. The spinner only covers the
                      empty first-token wait; while text is visible the
                      translate button's spinner signals the ongoing work. */}
                  {translation ? (
                    <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{translation}</p>
                  ) : translating ? (
                    <div className="flex items-center gap-2 text-sm text-gray-400">
                      <span className="ll-spinner" />
                      {t('sidepanel.translating')}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400">{t('sidepanel.translationPlaceholder')}</p>
                  )}
                </div>
              )}
              {translation && !translating && (
                <CopyButton
                  key={translation}
                  text={translation}
                  label={t('sidepanel.copy')}
                  className="self-start mt-1 mb-2 px-4"
                />
              )}
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-gray-100">
        <div className="min-w-0 flex-1">
          <ProviderPicker
            settings={settings}
            onChange={setDefaultProvider}
            triggerClassName="max-w-full"
          />
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => setShowHistory((v) => !v)}
            className={`text-xs font-medium ${showHistory ? 'text-blue-600' : 'text-gray-400 hover:text-blue-500'}`}
          >
            {t('sidepanel.history')}
          </button>
          <button
            onClick={() => browser.runtime.openOptionsPage()}
            className="text-xs text-gray-400 hover:text-blue-500 font-medium"
          >
            {t('sidepanel.settings')}
          </button>
        </div>
      </div>

      {/* Drag highlight — the whole panel accepts a file, not just the drop zone. */}
      {dragging && (
        <div className="side-drop-overlay" aria-hidden="true">
          <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <path d="m7 10 5 5 5-5" />
            <path d="M12 15V3" />
          </svg>
          <span>{t('sidepanel.dropHint')}</span>
          <span className="text-[calc(var(--ll-u)*11)] font-normal text-indigo-500">
            {t('sidepanel.dropHintText')}
          </span>
        </div>
      )}
    </div>
  );
}

function HistoryPanel({
  history,
  onSelect,
  onClear,
  onBack,
}: {
  history: HistoryEntry[];
  onSelect: (e: HistoryEntry) => void;
  onClear: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();

  if (history.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
        <svg className="w-8 h-8 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
          <path d="M12 7v5l4 2" />
        </svg>
        <p className="text-sm text-gray-400">{t('sidepanel.noHistory')}</p>
        <button onClick={onBack} className="text-xs text-blue-500 hover:text-blue-600">
          ← {t('sidepanel.backToTranslate')}
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="text-gray-400 hover:text-gray-600" title={t('sidepanel.backToTranslate')} aria-label={t('sidepanel.backToTranslate')}>
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          </button>
          <span className="text-xs font-medium text-gray-500">{t('sidepanel.historyCount', { count: history.length })}</span>
        </div>
        <button onClick={onClear} className="text-xs text-red-400 hover:text-red-500">{t('sidepanel.clearAll')}</button>
      </div>
      {history.map((entry) => (
        <div
          key={entry.id}
          onClick={() => onSelect(entry)}
          className="px-4 py-3 border-b border-gray-50 hover:bg-blue-50/50 cursor-pointer transition-colors"
        >
          <p className="ll-hint truncate">{entry.source}</p>
          <p className="text-sm text-gray-800 truncate mt-0.5">{entry.translated}</p>
          <div className="flex items-center gap-2 mt-1 min-w-0">
            {(() => {
              const lang = SUPPORTED_LANGUAGES.find((l) => l.code === entry.targetLang);
              return lang ? <span className="ll-badge ll-badge-brand shrink-0">{lang.name}</span> : null;
            })()}
            <span className="text-[calc(var(--ll-u)*10)] text-gray-400 shrink-0">{entry.provider}</span>
            <span className="text-[calc(var(--ll-u)*10)] text-gray-400 shrink-0">·</span>
            <span className="text-[calc(var(--ll-u)*10)] text-gray-400 truncate">{new Date(entry.timestamp).toLocaleString()}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
