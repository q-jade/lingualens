import { extractSegments, type TextSegment } from './dom-walker';
import { Semaphore } from './semaphore';

export type DisplayMode = 'replace' | 'bilingual';

export interface PageTranslateOptions {
  targetLang: string;
  sourceLang: string;
  displayMode: DisplayMode;
  concurrency: number;
}

export interface TranslateProgress {
  total: number;
  done: number;
  errors: number;
}

type ProgressCallback = (progress: TranslateProgress) => void;

export class PageTranslateEngine {
  private segments: TextSegment[] = [];
  private abortController: AbortController | null = null;
  private translatedSegments = new Map<string, string>();
  private bilingualInserted: HTMLElement[] = [];
  private isRunning = false;

  get running(): boolean {
    return this.isRunning;
  }

  async start(options: PageTranslateOptions, onProgress: ProgressCallback): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.abortController = new AbortController();

    this.segments = extractSegments(document.body);
    const progress: TranslateProgress = { total: this.segments.length, done: 0, errors: 0 };
    onProgress({ ...progress });

    const sem = new Semaphore(options.concurrency);

    const tasks = this.segments.map(async (segment) => {
      if (this.abortController?.signal.aborted) return;

      await sem.acquire();
      if (this.abortController?.signal.aborted) { sem.release(); return; }

      try {
        const response = await browser.runtime.sendMessage({
          type: 'TRANSLATE',
          payload: {
            text: segment.text,
            sourceLang: options.sourceLang,
            targetLang: options.targetLang,
          },
        });

        if (this.abortController?.signal.aborted) return;

        if (response?.success) {
          this.translatedSegments.set(segment.id, response.data.translated);
          this.applyTranslation(segment, response.data.translated, options.displayMode);
          progress.done++;
        } else {
          progress.errors++;
        }
      } catch {
        progress.errors++;
      } finally {
        sem.release();
        onProgress({ ...progress });
      }
    });

    await Promise.allSettled(tasks);
    this.isRunning = false;
  }

  stop(): void {
    this.abortController?.abort();
    this.isRunning = false;
  }

  restore(): void {
    this.stop();
    for (const segment of this.segments) {
      for (let i = 0; i < segment.textNodes.length; i++) {
        if (segment.textNodes[i].parentNode) {
          segment.textNodes[i].textContent = segment.originalTexts[i];
        }
      }
    }
    this.removeBilingualMarkers();
    this.translatedSegments.clear();
    this.segments = [];
  }

  switchMode(mode: DisplayMode): void {
    for (const segment of this.segments) {
      for (let i = 0; i < segment.textNodes.length; i++) {
        if (segment.textNodes[i].parentNode) {
          segment.textNodes[i].textContent = segment.originalTexts[i];
        }
      }
    }
    this.removeBilingualMarkers();

    for (const segment of this.segments) {
      const translated = this.translatedSegments.get(segment.id);
      if (translated) {
        this.applyTranslation(segment, translated, mode);
      }
    }
  }

  private removeBilingualMarkers(): void {
    for (const el of this.bilingualInserted) {
      el.remove();
    }
    this.bilingualInserted = [];
    for (const segment of this.segments) {
      for (const node of segment.textNodes) {
        if (node.parentElement) {
          node.parentElement.style.removeProperty('opacity');
          node.parentElement.style.removeProperty('font-size');
        }
      }
    }
  }

  private applyTranslation(segment: TextSegment, translated: string, mode: DisplayMode): void {
    if (mode === 'replace') {
      if (segment.textNodes.length > 0) {
        segment.textNodes[0].textContent = translated;
        for (let i = 1; i < segment.textNodes.length; i++) {
          segment.textNodes[i].textContent = '';
        }
      }
    } else {
      for (const node of segment.textNodes) {
        if (node.parentElement) {
          node.parentElement.style.opacity = '0.4';
          node.parentElement.style.fontSize = '0.85em';
        }
      }
      const marker = document.createElement('span');
      marker.className = 'st-translated';
      marker.style.cssText = 'display:block;color:#1a73e8;margin:2px 0;opacity:1;font-size:1rem';
      marker.textContent = translated;
      const lastNode = segment.textNodes[segment.textNodes.length - 1];
      const insertTarget = lastNode.parentElement;
      if (insertTarget) {
        insertTarget.insertAdjacentElement('afterend', marker);
        this.bilingualInserted.push(marker);
      }
    }
  }
}
