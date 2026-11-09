/**
 * Sentinel the built-in image prompt (`DEFAULT_IMAGE_TRANSLATION_PROMPT`)
 * outputs when an image contains no readable text. Entry points replace an
 * exact match with a localized message instead of showing the literal token.
 */
export const NO_TEXT_IN_IMAGE = 'NO_TEXT_IN_IMAGE';

/**
 * Text to render for an image stream in progress. The `NO_TEXT_IN_IMAGE`
 * sentinel arrives in pieces, so while the accumulated text is still a prefix
 * of it, render nothing — otherwise the panel would flash a truncation of the
 * literal sentinel. Once the text diverges it is real content and passes
 * through untouched; the `done` handler still maps an exact sentinel to the
 * localized "no text in image" message.
 */
export function visibleImageStreamText(accumulated: string): string {
  return NO_TEXT_IN_IMAGE.startsWith(accumulated.trimStart()) ? '' : accumulated;
}
