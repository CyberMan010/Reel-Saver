import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { ENV } from "../config/env";
import { ensureUploadDirs, resolveFfmpegPath } from "./media.service";

const execFileAsync = promisify(execFile);

const OEMBED_ENDPOINT = "https://graph.facebook.com/v25.0/instagram_oembed";

const PUBLIC_EMBED_HEADERS: Record<string, string> = {
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,ar;q=0.8",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
};

export class ExtractionError extends Error {}

export interface ExtractedMetadata {
  authorHandle: string | null;
  caption: string | null;
  thumbnailUrl: string | null;
  resolvedMediaFilePath?: string | null;
}

const metadataCache = new Map<
  string,
  { expiresAt: number; value: Omit<ExtractedMetadata, "resolvedMediaFilePath"> }
>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let loggedOembedPermissionHint = false;

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

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => {
      const cp = parseInt(hex, 16);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : _m;
    })
    .replace(/&#(\d+);/g, (_m, dec: string) => {
      const cp = parseInt(dec, 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : _m;
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripTags(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .trim()
  );
}

/**
 * Attribute-order-independent `<meta>` tag extractor.
 * Matches both `<meta property="og:description" content="...">`
 * and `<meta content="..." property="og:description">`.
 */
export function extractMetaTagContent(
  html: string,
  keys: string[]
): string | null {
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  const lowerKeys = new Set(keys.map((k) => k.toLowerCase()));

  for (const tag of metaTags) {
    const propMatch = tag.match(
      /\b(?:property|name)\s*=\s*(?:"([^"]*)"|'([^']*)')/i
    );
    const propVal = (propMatch?.[1] ?? propMatch?.[2] ?? "").toLowerCase();
    if (!lowerKeys.has(propVal)) continue;

    const contentMatch = tag.match(
      /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i
    );
    const rawContent = contentMatch?.[1] ?? contentMatch?.[2];
    if (rawContent && rawContent.trim()) {
      return decodeHtmlEntities(rawContent.trim());
    }
  }
  return null;
}

export function parseCaptionFromOgDescription(
  description: string
): string | null {
  const decoded = decodeHtmlEntities(description).trim();
  if (!decoded) return null;

  // Ignore generic Instagram login-wall boilerplate descriptions
  if (
    /^Create an account or log in to Instagram/i.test(decoded) ||
    /^Welcome back to Instagram/i.test(decoded)
  ) {
    return null;
  }

  // Standard IG format: `12K likes, 45 comments - handle on Oct 15, 2026: "Caption text".`
  const quotedAfterColon = decoded.match(/:\s*["“]([\s\S]+)["”]\.?\s*$/);
  if (quotedAfterColon?.[1]?.trim()) {
    return quotedAfterColon[1].trim();
  }

  const colonMatch = decoded.match(
    /likes?,\s*[\d,.KMB]+\s*comments?\s*-\s*.+?:\s*([\s\S]+)$/i
  );
  if (colonMatch?.[1]?.trim()) {
    return colonMatch[1].replace(/^["“]|["”]\.?$/g, "").trim();
  }

  // If it only says "120 likes, 4 comments - user on Date" with no colon, there is no caption
  if (/^\d[\d,.KMB]*\s+likes?,\s*\d[\d,.KMB]*\s+comments?\s*-\s*[^:]+$/i.test(decoded)) {
    return null;
  }

  return decoded;
}

export function parseAuthorFromOgDescription(
  description: string
): string | null {
  const decoded = decodeHtmlEntities(description);
  const match = decoded.match(
    /comments?\s*-\s*([\w.]+)\s+on\s+[A-Za-z]+\s+\d+/i
  );
  return match?.[1] ?? null;
}

export function parseAuthorFromOgTitle(title: string): string | null {
  const decoded = decodeHtmlEntities(title);
  const handleMatch = decoded.match(/\(@([\w.]+)\)/);
  if (handleMatch?.[1]) return handleMatch[1];

  const onIgMatch = decoded.match(/^(.+?)\s+on Instagram/i);
  if (onIgMatch?.[1] && !/^Instagram$/i.test(onIgMatch[1].trim())) {
    return onIgMatch[1].trim().replace(/^@/, "");
  }

  return null;
}

async function downloadStreamToFile(
  streamUrl: string,
  destPath: string
): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const res = await fetch(streamUrl, {
        headers: PUBLIC_EMBED_HEADERS,
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1024) return null;
      fs.writeFileSync(destPath, buf);
      return destPath;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

/**
 * Parses Instagram's public `/p/<shortcode>/embed/captioned/` widget HTML.
 * Extracts full caption, @username, thumbnail, and public embed video stream if present.
 */
function parsePublicEmbedCaptionedHtml(html: string): {
  authorHandle: string | null;
  caption: string | null;
  thumbnailUrl: string | null;
  publicVideoUrl: string | null;
} {
  let authorHandle: string | null = null;
  let caption: string | null = null;
  let thumbnailUrl: string | null = null;
  let publicVideoUrl: string | null = null;

  // 1. Parse embedded `contextJSON` payload if present
  const ctxMatch = html.match(/"contextJSON"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (ctxMatch?.[1]) {
    try {
      const unescapedJsonStr = JSON.parse(`"${ctxMatch[1]}"`) as string;
      const ctx = JSON.parse(unescapedJsonStr) as {
        gql_data?: {
          shortcode_media?: {
            owner?: { username?: string };
            video_url?: string;
            display_url?: string;
            thumbnail_src?: string;
            edge_media_to_caption?: {
              edges?: Array<{ node?: { text?: string } }>;
            };
          };
        };
        media?: {
          owner?: { username?: string };
          caption?: string;
          video_url?: string;
          display_src?: string;
        };
      };

      const media = ctx.gql_data?.shortcode_media;
      if (media) {
        authorHandle = media.owner?.username ?? authorHandle;
        caption =
          media.edge_media_to_caption?.edges?.[0]?.node?.text?.trim() ??
          caption;
        thumbnailUrl = media.display_url ?? media.thumbnail_src ?? thumbnailUrl;
        publicVideoUrl = media.video_url ?? publicVideoUrl;
      }

      if (ctx.media) {
        authorHandle = authorHandle ?? ctx.media.owner?.username ?? null;
        caption = caption ?? ctx.media.caption?.trim() ?? null;
        thumbnailUrl = thumbnailUrl ?? ctx.media.display_src ?? null;
        publicVideoUrl = publicVideoUrl ?? ctx.media.video_url ?? null;
      }
    } catch {
      // Fall through to rendered DOM selectors
    }
  }

  // Also check direct escaped video_url inside embed script if present
  if (!publicVideoUrl) {
    const videoUrlMatch = html.match(/"video_url"\s*:\s*"(https?:[^"]+)"/);
    if (videoUrlMatch?.[1]) {
      try {
        publicVideoUrl = JSON.parse(`"${videoUrlMatch[1]}"`) as string;
      } catch {
        publicVideoUrl = videoUrlMatch[1].replace(/\\u0026/g, "&").replace(/\\\//g, "/");
      }
    }
  }

  // 2. Parse rendered DOM inside `/embed/captioned/`
  if (!authorHandle) {
    const userMatch = html.match(
      /class="[^"]*\bUsernameText\b[^"]*"[^>]*>([\s\S]*?)<\//i
    );
    if (userMatch?.[1]) {
      const cleaned = stripTags(userMatch[1]).replace(/^@/, "");
      if (cleaned) authorHandle = cleaned;
    }
  }

  if (!caption) {
    const captionBlockMatch = html.match(
      /<div[^>]*class="[^"]*\bCaption\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i
    );
    if (captionBlockMatch?.[1]) {
      let blockHtml = captionBlockMatch[1];
      // Remove leading CaptionUsername anchor and trailing CaptionComments div
      blockHtml = blockHtml
        .replace(/<a[^>]*class="[^"]*\bCaptionUsername\b[^"]*"[^>]*>[\s\S]*?<\/a>/gi, "")
        .replace(/<div[^>]*class="[^"]*\bCaptionComments\b[^"]*"[^>]*>[\s\S]*$/gi, "");
      const text = stripTags(blockHtml).trim();
      if (text) caption = text;
    }
  }

  if (!thumbnailUrl) {
    const imgMatch = html.match(
      /<img[^>]*class="[^"]*\bEmbeddedMediaImage\b[^"]*"[^>]*src="([^"]+)"/i
    );
    if (imgMatch?.[1]) {
      thumbnailUrl = decodeHtmlEntities(imgMatch[1]);
    }
  }

  return { authorHandle, caption, thumbnailUrl, publicVideoUrl };
}

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

    const { rawDir } = ensureUploadDirs();
    return await downloadStreamToFile(
      streamUrl,
      path.join(rawDir, `${reelId}-resolved.mp3`)
    );
  } catch {
    return null;
  }
}

/**
 * Optional local `yt-dlp` CLI check if the developer has `yt-dlp` installed on PATH.
 */
async function tryLocalYtDlpAudio(
  reelId: string,
  normalizedUrl: string
): Promise<string | null> {
  const candidates =
    process.platform === "win32" ? ["yt-dlp.exe", "yt-dlp"] : ["yt-dlp"];
  const { rawDir } = ensureUploadDirs();
  const outputTemplate = path.join(rawDir, `${reelId}-ytdlp.%(ext)s`);
  const ffmpegPath = resolveFfmpegPath();

  for (const bin of candidates) {
    try {
      await execFileAsync(bin, ["--version"], { timeout: 3000 });
    } catch {
      continue;
    }

    try {
      const args = [
        "--no-playlist",
        "--no-warnings",
        "-f",
        "bestaudio/best",
        "-o",
        outputTemplate,
      ];
      if (ffmpegPath && ffmpegPath !== "ffmpeg") {
        args.push("--ffmpeg-location", ffmpegPath);
      }
      args.push(normalizedUrl);

      await execFileAsync(bin, args, { timeout: 45000 });

      const files = fs
        .readdirSync(rawDir)
        .filter((f) => f.startsWith(`${reelId}-ytdlp.`));
      if (files.length > 0) {
        return path.join(rawDir, files[0]);
      }
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Multi-stage Reel metadata & public audio extractor:
 * 1. Client-supplied metadata (Flutter Share Sheet / manual input)
 * 2. 24h shortcode cache
 * 3. Meta Graph API `instagram_oembed` (if token has `oEmbed Read` permission)
 * 4. Official Instagram public embed widget (`/p/<shortcode>/embed/captioned/`)
 * 5. Public OpenGraph `<meta>` fallback
 * 6. Optional Cobalt resolver (`EXTERNAL_MEDIA_RESOLVER_URL`), public embed video stream, or local `yt-dlp`
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
  const shortcode = extractInstagramShortcode(sourceUrl);

  let resolvedMediaFilePath =
    options?.reelId && !options?.hasLocalMediaOrTranscript
      ? await tryExternalMediaResolver(options.reelId, normalizedUrl)
      : null;

  if (options?.existingCaption) {
    return {
      authorHandle: options.existingAuthorHandle ?? null,
      caption: options.existingCaption,
      thumbnailUrl: options.existingThumbnailUrl ?? null,
      resolvedMediaFilePath,
    };
  }

  const cached = metadataCache.get(normalizedUrl);
  let authorHandle: string | null =
    options?.existingAuthorHandle ?? cached?.value.authorHandle ?? null;
  let caption: string | null =
    options?.existingCaption ?? cached?.value.caption ?? null;
  let thumbnailUrl: string | null =
    options?.existingThumbnailUrl ?? cached?.value.thumbnailUrl ?? null;

  let publicVideoUrl: string | null = null;

  // Stage 3: Official Meta Graph API oEmbed
  if ((!caption || !authorHandle) && ENV.FACEBOOK_APP_ACCESS_TOKEN) {
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
      } else if (!loggedOembedPermissionHint && ENV.NODE_ENV !== "test") {
        loggedOembedPermissionHint = true;
        console.info(
          `[Extractor] Meta oEmbed returned ${response.status} (app may not have Live 'oEmbed Read' review yet) — using public embed & OpenGraph fallback.`
        );
      }
    } catch {
      // Continue to Stage 4
    }
  }

  // Stage 4: Instagram Public Embed Widget (`/p/<shortcode>/embed/captioned/`)
  if (shortcode && (!caption || (!resolvedMediaFilePath && !options?.hasLocalMediaOrTranscript))) {
    const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      try {
        const embedRes = await fetch(embedUrl, {
          headers: PUBLIC_EMBED_HEADERS,
          signal: controller.signal,
        });
        if (embedRes.ok) {
          const embedHtml = await embedRes.text();
          const parsed = parsePublicEmbedCaptionedHtml(embedHtml);
          authorHandle = authorHandle ?? parsed.authorHandle;
          caption = caption ?? parsed.caption;
          thumbnailUrl = thumbnailUrl ?? parsed.thumbnailUrl;
          publicVideoUrl = publicVideoUrl ?? parsed.publicVideoUrl;
        }
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // Continue to Stage 5
    }
  }

  // Stage 5: Standard OpenGraph `<meta>` tags on public Reel URL
  if (!caption || !authorHandle) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      try {
        const pageRes = await fetch(normalizedUrl, {
          headers: PUBLIC_EMBED_HEADERS,
          signal: controller.signal,
        });
        if (pageRes.ok) {
          const pageHtml = await pageRes.text();
          const ogDesc = extractMetaTagContent(pageHtml, [
            "og:description",
            "twitter:description",
            "description",
          ]);
          const ogTitle = extractMetaTagContent(pageHtml, [
            "og:title",
            "twitter:title",
          ]);
          const ogImage = extractMetaTagContent(pageHtml, [
            "og:image",
            "twitter:image",
          ]);
          const ogVideo = extractMetaTagContent(pageHtml, [
            "og:video",
            "og:video:secure_url",
          ]);

          if (ogDesc) {
            caption = caption ?? parseCaptionFromOgDescription(ogDesc);
            authorHandle = authorHandle ?? parseAuthorFromOgDescription(ogDesc);
          }
          if (ogTitle) {
            authorHandle = authorHandle ?? parseAuthorFromOgTitle(ogTitle);
          }
          if (ogImage) {
            thumbnailUrl = thumbnailUrl ?? ogImage;
          }
          if (ogVideo) {
            publicVideoUrl = publicVideoUrl ?? ogVideo;
          }
        }
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // Continue
    }
  }

  // Stage 6: Resolve audio/video stream for Whisper transcription when available
  if (
    !resolvedMediaFilePath &&
    options?.reelId &&
    !options?.hasLocalMediaOrTranscript &&
    ENV.ENABLE_VIDEO_TRANSCRIPTION
  ) {
    if (publicVideoUrl) {
      const { rawDir } = ensureUploadDirs();
      resolvedMediaFilePath = await downloadStreamToFile(
        publicVideoUrl,
        path.join(rawDir, `${options.reelId}-embed.mp4`)
      );
    }

    if (!resolvedMediaFilePath) {
      resolvedMediaFilePath = await tryLocalYtDlpAudio(
        options.reelId,
        normalizedUrl
      );
    }
  }

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
