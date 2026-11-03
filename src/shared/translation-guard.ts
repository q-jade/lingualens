/**
 * Heuristic: detect a "translation" that is actually a rendering of the
 * instruction (system prompt) instead of the user's text. Small completion-only
 * translation models occasionally translate the prompt they were given rather
 * than the requested text — reproduced over the wire against a
 * HY-MT2-1.8B Ollama server, where the same request succeeds most of the time
 * but fails by emitting a translation of the system prompt.
 *
 * The check is anchor-based: numerals and proper nouns (capitalized or
 * all-caps tokens such as "Kimi", "C99", "BLAS", "2.78") survive translation,
 * so a genuine translation of the source must contain at least one of the
 * source's anchor tokens. If the source has no anchors (common words only),
 * the check abstains and returns false.
 *
 * False positives cost one extra model call (the retry), never a wrong
 * translation: the caller keeps the first result when the retry is equally
 * suspicious.
 */
export function looksLikeSelfTranslation(
  sourceText: string,
  translated: string,
): boolean {
  const source = sourceText.trim();
  const output = translated.trim();
  if (!source || !output) return false;

  const anchors: string[] = [];
  // Numerals (optionally dotted/suffixed): "2.78", "8.24", "C99"
  for (const m of source.matchAll(/\d[\w.]*/g)) anchors.push(m[0]);
  // Capitalized or all-caps tokens of 2+ chars: "Kimi", "CPU", "BLAS"
  for (const m of source.matchAll(/[A-Z][A-Za-z0-9-]+/g)) anchors.push(m[0]);

  if (anchors.length === 0) return false;

  const lowered = output.toLowerCase();
  return !anchors.some((a) => lowered.includes(a.toLowerCase()));
}
