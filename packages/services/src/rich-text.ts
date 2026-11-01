import sanitizeHtml from "sanitize-html";

/**
 * Cleans HTML from the console's rich text editor before it is stored —
 * product descriptions are rendered as-is by the webshop, so only plain
 * formatting survives: no scripts, styles, event handlers, iframes or
 * javascript: links.
 */
export function sanitizeRichText(html: string): string {
  const clean = sanitizeHtml(html, {
    allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "s", "h2", "h3", "ul", "ol", "li", "a", "blockquote", "hr"],
    allowedAttributes: { a: ["href", "target", "rel"] },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }),
    },
  }).trim();
  // An emptied editor leaves "<p></p>"; store that as "".
  return clean.replace(/<[^>]*>/g, "").trim() === "" ? "" : clean;
}
