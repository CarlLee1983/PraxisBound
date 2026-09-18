/**
 * The one HTML-escaping helper every Review Projection renderer shares, so a
 * source byte is escaped the same way whether it reaches the page through
 * `markdown-html.ts` or through `render-source.ts`'s own attribute and label
 * text. Pure: no I/O, no globals.
 */

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
