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
      segment.element.innerHTML = segment.originalHTML;
      segment.element.removeAttribute('data-st-translated');
    }
    this.translatedSegments.clear();
    this.segments = [];
  }

  switchMode(mode: DisplayMode): void {
    for (const segment of this.segments) {
      const translated = this.translatedSegments.get(segment.id);
      if (translated) {
        this.applyTranslation(segment, translated, mode);
      }
    }
  }

  private applyTranslation(segment: TextSegment, translated: string, mode: DisplayMode): void {
    segment.element.setAttribute('data-st-translated', 'true');

    if (mode === 'replace') {
      segment.element.innerHTML = `<span class="st-translated">${this.escapeHtml(translated)}</span>`;
    } else {
      segment.element.innerHTML =
        `<span class="st-original" style="opacity:0.4;font-size:0.85em;display:block">${segment.originalHTML}</span>` +
        `<span class="st-translated" style="display:block">${this.escapeHtml(translated)}</span>`;
    }
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
