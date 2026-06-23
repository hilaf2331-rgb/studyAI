import sanitizeHtml from "sanitize-html";

// sanitize-html escapes any literal "<"/"&"/etc it finds in plain text nodes
// (it's designed to produce safe HTML output) which would otherwise leave
// math notation like "x < 5" stored as the literal string "x &lt; 5". Since
// our output is plain text, not HTML, undo that re-escaping afterwards.
function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

// Extracted content (PDF text, scraped pages, YouTube transcripts, Whisper
// output) is stored as plain text and later dropped straight into Groq
// prompts and JSON API responses -- never rendered as HTML. Strip any tags
// entirely rather than trying to allow a "safe" subset, so a malicious
// <script>/<img onerror> payload hidden in a PDF or webpage can never survive
// as anything but inert text.
export function sanitizeExtractedText(text: string): string {
  const stripped = sanitizeHtml(text, {
    allowedTags: [],
    allowedAttributes: {},
  });
  return decodeEntities(stripped).replace(/\s+/g, " ").trim();
}
