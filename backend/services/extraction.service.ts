const OEMBED_ENDPOINT = "https://graph.facebook.com/v25.0/instagram_oembed";

export class ExtractionError extends Error {}

export interface ExtractedMetadata {
  authorHandle: string | null;
  caption: string | null;
  thumbnailUrl: string | null;
}

export function isInstagramReelUrl(url: string): boolean {
  return /instagram\.com\/(reel|reels|p)\//.test(url);
}

function normalizeInstagramUrl(url: string): string {
  return url.replace(/instagram\.com\/reels\//, "instagram.com/reel/");
}

function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, "").trim());
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export async function extractReelContent(sourceUrl: string): Promise<ExtractedMetadata> {
  const normalizedUrl = normalizeInstagramUrl(sourceUrl);
  const params = new URLSearchParams({ url: normalizedUrl });
  const response = await fetch(`${OEMBED_ENDPOINT}?${params.toString()}`);

  if (!response.ok) {
    const body = await response.text();
    throw new ExtractionError(
      `Instagram oEmbed request failed (${response.status}). The reel may be private, age-restricted, embed-disabled, or the URL malformed. ${body}`
    );
  }

  const data = await response.json();
  const html: string = data.html ?? "";

  // Capture each <p>...</p> block WHOLE, including any nested tags (the
  // caption text lives inside a nested <a> in real Instagram markup) —
  // then strip tags afterward to get plain text. [\s\S]*? matches across
  // newlines, unlike a plain `.`
  const paragraphs = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
    .map((m) => stripTags(m[1]))
    .filter(Boolean);

  // The "A post shared by ... (@handle)" line is always one of the <p>
  // blocks — identify it by that fixed phrase, and treat any *other*
  // non-empty paragraph as the caption.
  const authorParagraph = paragraphs.find((p) => /^A post shared by/i.test(p));
  const authorHandle = authorParagraph?.match(/\(@([\w.]+)\)/)?.[1] ?? null;
  const caption = paragraphs.find((p) => p !== authorParagraph) ?? null;

  return { authorHandle, caption, thumbnailUrl: null };
}