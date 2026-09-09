import { extractSegments, type TextSegment } from './dom-walker';
import { Semaphore } from './semaphore';
import type { ChunkingMode } from '../../shared/types';

export type DisplayMode = 'replace' | 'bilingual';

export interface PageTranslateOptions {
  targetLang: string;
  sourceLang: string;
  displayMode: DisplayMode;
  concurrency: number;
  chunkingMode: ChunkingMode;
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
  /**
   * Resolved translation parts per segment: one part per sub-segment, or a
   * single part when the segment has none. A null part failed to translate
   * and keeps its original text.
   */
  private translatedSegments = new Map<string, (string | null)[]>();
  private bilingualInserted: HTMLElement[] = [];
  private isRunning = false;

  get running(): boolean {
    return this.isRunning;
  }

  async start(options: PageTranslateOptions, onProgress: ProgressCallback): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.abortController = new AbortController();

    this.segments = extractSegments(document.body, options.chunkingMode);
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
          // No applyAdditionalPrompt: page translation must always produce plain
          // translations — the supplementary (e.g. dictionary) prompt never applies.
          payload: {
            text: segment.text,
            sourceLang: options.sourceLang,
            targetLang: options.targetLang,
          },
        });

        if (this.abortController?.signal.aborted) return;

        if (response?.success && response.data.translated.trim()) {
          const parts = await this.resolveSegmentParts(segment, response.data.translated, options);
          // Null = aborted while resolving; leave the segment untranslated.
          if (parts) {
            this.translatedSegments.set(segment.id, parts);
            this.applyParts(segment, parts, options.displayMode);
            progress.done++;
          }
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
      const parts = this.translatedSegments.get(segment.id);
      if (parts) {
        this.applyParts(segment, parts, mode);
      }
    }
  }

  private removeBilingualMarkers(): void {
    for (const el of this.bilingualInserted) {
      el.remove();
    }
    this.bilingualInserted = [];
  }

  /**
   * Map a merged translation back to the segment's sub-segments. The segment
   * text is sent as one line per sub-segment, so a response with the same
   * number of non-empty lines maps 1:1. Otherwise the line structure did not
   * survive translation (models merge short heading lines or hard-wrap long
   * ones) — re-translate each sub-segment on its own instead of guessing split
   * points. Returns null when aborted before all parts were resolved.
   */
  private async resolveSegmentParts(
    segment: TextSegment,
    translated: string,
    options: PageTranslateOptions,
  ): Promise<(string | null)[] | null> {
    const subs = segment.subSegments && segment.subSegments.length > 1
      ? segment.subSegments
      : undefined;
    if (!subs) return [translated];

    const lines = translated
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (lines.length === subs.length) return lines;

    const parts: (string | null)[] = [];
    for (const sub of subs) {
      if (this.abortController?.signal.aborted) return null;
      try {
        const response = await browser.runtime.sendMessage({
          type: 'TRANSLATE',
          payload: {
            text: sub.text,
            sourceLang: options.sourceLang,
            targetLang: options.targetLang,
          },
        });
        parts.push(
          response?.success && response.data.translated.trim() ? response.data.translated : null,
        );
      } catch {
        parts.push(null);
      }
    }
    return parts;
  }

  /**
   * Apply resolved parts to their sub-segments. A null part keeps its
   * original text — a failed translation must never blank a block.
   */
  private applyParts(segment: TextSegment, parts: (string | null)[], mode: DisplayMode): void {
    const subs = segment.subSegments && segment.subSegments.length > 1
      ? segment.subSegments
      : undefined;
    if (!subs) {
      this.applyToNodes(segment.textNodes, parts[0] ?? '', mode);
      return;
    }
    for (let i = 0; i < subs.length; i++) {
      const part = parts[i];
      if (!part) continue;
      this.applyToNodes(subs[i].textNodes, part, mode);
    }
  }

  private applyToNodes(textNodes: Text[], translated: string, mode: DisplayMode): void {
    if (mode === 'replace') {
      if (textNodes.length > 0) {
        textNodes[0].textContent = translated;
        for (let i = 1; i < textNodes.length; i++) {
          textNodes[i].textContent = '';
        }
      }
    } else {
      const marker = document.createElement('div');
      marker.className = 'st-translated';
      marker.style.cssText = 'display:block;color:#1a73e8;margin:4px 0 0;font-size:max(12px,1em)';
      marker.textContent = translated;
      const lastNode = textNodes[textNodes.length - 1];
      if (this.insertMarkerAfterText(lastNode, marker)) {
        this.bilingualInserted.push(marker);
      }
    }
  }

  private static INLINE_TAGS = new Set([
    'A', 'ABBR', 'ACRONYM', 'B', 'BDO', 'BIG', 'CITE', 'CODE',
    'DFN', 'EM', 'FONT', 'I', 'IMG', 'KBD', 'LABEL', 'MARK',
    'Q', 'S', 'SAMP', 'SMALL', 'SPAN', 'STRIKE', 'STRONG',
    'SUB', 'SUP', 'TIME', 'TT', 'U', 'VAR', 'WBR',
  ]);

  /**
   * Keep markers inside the original container. Inline-wrapped text should place
   * the marker after the highest inline ancestor; direct block text can insert
   * after the text node itself.
   */
  private insertMarkerAfterText(node: Text, marker: HTMLElement): boolean {
    let current = node.parentElement;
    if (!current) return false;

    if (!PageTranslateEngine.INLINE_TAGS.has(current.tagName)) {
      current.insertBefore(marker, node.nextSibling);
      return true;
    }

    while (current.parentElement && PageTranslateEngine.INLINE_TAGS.has(current.parentElement.tagName)) {
      current = current.parentElement;
    }

    current.insertAdjacentElement('afterend', marker);
    return true;
  }
}
