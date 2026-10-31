import fs from "fs";
import path from "path";
import { ENV } from "../config/env";
import { ensureUploadDirs } from "./media.service";

const OEMBED_ENDPOINT = "https://graph.facebook.com/v25.0/instagram_oembed";

export class ExtractionError extends Error {}

export interface ExtractedMetadata {
  authorHandle: string | null;
  caption: string | null;
  thumbnailUrl: string | null;
  resolvedMediaFilePath?: string | null;
}

// Per-URL metadata cache (24h TTL) so popular reels shared by multiple users
// never trigger repeated outbound oEmbed calls from the server IP.
const metadataCache = new Map<
  string,
  { expiresAt: number; value: Omit<ExtractedMetadata, "resolvedMediaFilePath"> }
>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export function isUploadPlaceholderUrl(url: string): boolean {
  return url.startsWith("upload://");
}

export function isInstagramReelUrl(url: string): boolean {
  return (
    isUploadPlaceholderUrl(url) ||
    /(?:instagram\.com|instagr\.am)\/(?:[\w.]+\/)?(reel|reels|p|tv)\/[\w-]+/i.test(
      url
    )
  );
}

export function extractInstagramShortcode(url: string): string | null {
  const match = url.match(
    /(?:instagram\.com|instagr\.am)\/(?:[\w.]+\/)?(?:reel|reels|p|tv)\/([\w-]+)/i
  );
  return match?.[1] ?? null;
}

export function normalizeInstagramUrl(url: string): string {
  if (isUploadPlaceholderUrl(url)) return url;
  const shortcode = extractInstagramShortcode(url);
  if (shortcode) {
    return `https://www.instagram.com/reel/${shortcode}/`;
  }
  return url.replace(/instagram\.com\/reels\//i, "instagram.com/reel/");
}

function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, "").trim());
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export function parseCaptionFromOgDescription(
  description: string
): string | null {
  const decoded = decodeHtmlEntities(description);
  const quotedMatch = decoded.match(/:\s*"([\s\S]+)"\.?\s*$/);
  if (quotedMatch?.[1]) {
    return quotedMatch[1].trim();
  }

  const anyQuoted = decoded.match(/"([^"]+)"/);
  if (anyQuoted?.[1]) {
    return anyQuoted[1].trim();
  }

  const colonMatch = decoded.match(/:\s*([\s\S]+)$/);
  return colonMatch ? colonMatch[1].trim() : null;
}

export function parseAuthorFromOgTitle(title: string): string | null {
  const decoded = decodeHtmlEntities(title);
  const handleMatch = decoded.match(/\(@([\w.]+)\)/);
  if (handleMatch?.[1]) return handleMatch[1];

  const onIgMatch = decoded.match(/^(.+?)\s+on Instagram/i);
  if (onIgMatch?.[1]) return onIgMatch[1].trim();

  return null;
}

/**
 * Optional external media resolver integration (e.g. a self-hosted Cobalt-compatible
 * API or licensed webhook configured via EXTERNAL_MEDIA_RESOLVER_URL).
 */
async function tryExternalMediaResolver(
  reelId: string,
  normalizedUrl: string
): Promise<string | null> {
  if (!ENV.EXTERNAL_MEDIA_RESOLVER_URL) {
    return null;
  }

  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    if (ENV.EXTERNAL_MEDIA_RESOLVER_KEY) {
      headers.Authorization = `Api-Key ${ENV.EXTERNAL_MEDIA_RESOLVER_KEY}`;
    }

    const res = await fetch(ENV.EXTERNAL_MEDIA_RESOLVER_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        url: normalizedUrl,
        downloadMode: "audio",
        audioFormat: "mp3",
      }),
    });

    if (!res.ok) return null;

    const payload = (await res.json()) as {
      url?: string;
      audioUrl?: string;
    };
    const streamUrl = payload.audioUrl ?? payload.url;
    if (!streamUrl) return null;

    const mediaRes = await fetch(streamUrl);
    if (!mediaRes.ok) return null;

    const { rawDir } = ensureUploadDirs();
    const outPath = path.join(rawDir, `${reelId}-resolved.mp3`);
    const arrayBuffer = await mediaRes.arrayBuffer();
    fs.writeFileSync(outPath, Buffer.from(arrayBuffer));
    return outPath;
  } catch {
    return null;
  }
}

/**
 * Extracts public Reel metadata safely:
 * 1. Uses client-supplied metadata first (extracted on the user's own device via
 *    Flutter Share Sheet / Web Clipper) so the backend server IP never makes bulk
 *    requests on behalf of all users.
 * 2. Checks the 24h shortcode deduplication cache.
 * 3. Uses Meta's official Graph API `instagram_oembed` when `FACEBOOK_APP_ACCESS_TOKEN`
 *    is configured.
 * 4. Optionally resolves audio via `EXTERNAL_MEDIA_RESOLVER_URL` if configured.
 */
export async function extractReelContent(
  sourceUrl: string,
  options?: {
    reelId?: string;
    existingAuthorHandle?: string | null;
    existingCaption?: string | null;
    existingThumbnailUrl?: string | null;
    hasLocalMediaOrTranscript?: boolean;
  }
): Promise<ExtractedMetadata> {
  if (isUploadPlaceholderUrl(sourceUrl)) {
    return {
      authorHandle: options?.existingAuthorHandle ?? null,
      caption: options?.existingCaption ?? null,
      thumbnailUrl: options?.existingThumbnailUrl ?? null,
      resolvedMediaFilePath: null,
    };
  }

  const normalizedUrl = normalizeInstagramUrl(sourceUrl);

  // Optionally resolve audio stream if an external media resolver is configured
  const resolvedMediaFilePath =
    options?.reelId && !options?.hasLocalMediaOrTranscript
      ? await tryExternalMediaResolver(options.reelId, normalizedUrl)
      : null;

  // If the client device already supplied public metadata, skip hitting Meta from our server IP!
  if (options?.existingCaption) {
    return {
      authorHandle: options.existingAuthorHandle ?? null,
      caption: options.existingCaption,
      thumbnailUrl: options.existingThumbnailUrl ?? null,
      resolvedMediaFilePath,
    };
  }

  // Check server-side shortcode cache
  const cached = metadataCache.get(normalizedUrl);
  if (cached && cached.expiresAt > Date.now()) {
    return {
      ...cached.value,
      resolvedMediaFilePath,
    };
  }

  let authorHandle: string | null = options?.existingAuthorHandle ?? null;
  let caption: string | null = options?.existingCaption ?? null;
  let thumbnailUrl: string | null = options?.existingThumbnailUrl ?? null;

  // Official Meta Graph API oEmbed (safe & compliant, never uses user cookies)
  if (ENV.FACEBOOK_APP_ACCESS_TOKEN) {
    try {
      const params = new URLSearchParams({
        url: normalizedUrl,
        access_token: ENV.FACEBOOK_APP_ACCESS_TOKEN,
        omitscript: "true",
      });

      const response = await fetch(`${OEMBED_ENDPOINT}?${params.toString()}`);
      if (response.ok) {
        const data = (await response.json()) as {
          html?: string;
          author_name?: string;
          thumbnail_url?: string;
        };

        if (data.author_name && !authorHandle) {
          authorHandle = data.author_name;
        }
        if (data.thumbnail_url && !thumbnailUrl) {
          thumbnailUrl = data.thumbnail_url;
        }

        const html = data.html ?? "";
        const paragraphs = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
          .map((m) => stripTags(m[1]))
          .filter(Boolean);

        const authorParagraph = paragraphs.find((p) =>
          /^A post shared by/i.test(p)
        );
        if (!authorHandle && authorParagraph) {
          authorHandle =
            authorParagraph.match(/\(@([\w.]+)\)/)?.[1] ?? authorHandle;
        }
        caption =
          paragraphs.find((p) => p !== authorParagraph) ?? caption ?? null;
      }
    } catch {
      // Fall through gracefully
    }
  }

  // Cache non-empty metadata so duplicate saves never re-query
  if (caption || authorHandle || thumbnailUrl) {
    metadataCache.set(normalizedUrl, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      value: { authorHandle, caption, thumbnailUrl },
    });
  }

  return {
    authorHandle,
    caption,
    thumbnailUrl,
    resolvedMediaFilePath,
  };
}
