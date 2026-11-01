import fs from "fs";
import path from "path";
import { ENV } from "../config/env";
import { ensureUploadDirs } from "./media.service";
import { downloadReelWithYtDlp } from "./ytdlp.service";

const OEMBED_ENDPOINT = "https://graph.facebook.com/v25.0/instagram_oembed";

const PUBLIC_EMBED_HEADERS: Record<string, string> = {
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,ar;q=0.8",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
};

const CRAWLER_OG_HEADERS: Record<string, string> = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,ar;q=0.8",
  "User-Agent":
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
};

const IG_SHORTCODE_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export type MediaConversionChoice = "mp3" | "mp4" | "skip";

export class ExtractionError extends Error {}

export interface ExtractedMetadata {
  authorHandle: string | null;
  caption: string | null;
  thumbnailUrl: string | null;
  resolvedMediaFilePath?: string | null;
  extractionHint?: string | null;
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

export function shortcodeToMediaId(shortcode: string): string | null {
  const clean = shortcode.length > 28 ? shortcode.slice(0, -28) : shortcode;
  if (!clean) return null;
  let id = 0n;
  for (const ch of clean) {
    const idx = IG_SHORTCODE_ALPHABET.indexOf(ch);
    if (idx < 0) return null;
    id = id * 64n + BigInt(idx);
  }
  return id.toString(10);
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

  if (
    /^Create an account or log in to Instagram/i.test(decoded) ||
    /^Welcome back to Instagram/i.test(decoded)
  ) {
    return null;
  }

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

  if (
    /^\d[\d,.KMB]*\s+likes?,\s*\d[\d,.KMB]*\s+comments?\s*-\s*[^:]+$/i.test(
      decoded
    )
  ) {
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
    const timer = setTimeout(() => controller.abort(), 35000);
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
 * Pure-Node Instagram GraphQL (`PolarisLoggedOutDesktopWWWPostRootContentQuery`)
 * fallback for public Reel metadata & direct MP4 stream URL.
 */
async function tryPolarisGraphQlExtraction(
  shortcode: string,
  normalizedUrl: string
): Promise<{
  authorHandle: string | null;
  caption: string | null;
  thumbnailUrl: string | null;
  publicVideoUrl: string | null;
}> {
  const mediaId = shortcodeToMediaId(shortcode);
  if (!mediaId) {
    return {
      authorHandle: null,
      caption: null,
      thumbnailUrl: null,
      publicVideoUrl: null,
    };
  }

  try {
    const lsdToken = "AVqbxe3J_YA";
    const body = new URLSearchParams({
      lsd: lsdToken,
      fb_api_caller_class: "RelayModern",
      fb_api_req_friendly_name:
        "PolarisLoggedOutDesktopWWWPostRootContentQuery",
      server_timestamps: "true",
      variables: JSON.stringify({ media_id: mediaId, shortcode }),
      doc_id: "27130156389949648",
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch("https://www.instagram.com/api/graphql", {
        method: "POST",
        headers: {
          ...PUBLIC_EMBED_HEADERS,
          "Content-Type": "application/x-www-form-urlencoded",
          "X-IG-App-ID": "936619743392459",
          "X-FB-LSD": lsdToken,
          "X-FB-Friendly-Name":
            "PolarisLoggedOutDesktopWWWPostRootContentQuery",
          "X-Requested-With": "XMLHttpRequest",
          Referer: normalizedUrl,
        },
        body: body.toString(),
        signal: controller.signal,
      });

      if (!res.ok) {
        return {
          authorHandle: null,
          caption: null,
          thumbnailUrl: null,
          publicVideoUrl: null,
        };
      }

      const json = (await res.json()) as {
        data?: {
          xig_polaris_media?: {
            if_not_gated_logged_out?: {
              user?: { username?: string };
              owner?: { username?: string };
              caption?: { text?: string };
              video_versions?: Array<{ url?: string }>;
              image_versions2?: { candidates?: Array<{ url?: string }> };
            };
          };
          xdt_shortcode_media?: {
            owner?: { username?: string };
            video_url?: string;
            display_url?: string;
            edge_media_to_caption?: {
              edges?: Array<{ node?: { text?: string } }>;
            };
          };
        };
      };

      const polaris = json.data?.xig_polaris_media?.if_not_gated_logged_out;
      const xdt = json.data?.xdt_shortcode_media;

      const authorHandle =
        polaris?.user?.username ??
        polaris?.owner?.username ??
        xdt?.owner?.username ??
        null;
      const caption =
        polaris?.caption?.text?.trim() ??
        xdt?.edge_media_to_caption?.edges?.[0]?.node?.text?.trim() ??
        null;
      const publicVideoUrl =
        polaris?.video_versions?.[0]?.url ?? xdt?.video_url ?? null;
      const thumbnailUrl =
        polaris?.image_versions2?.candidates?.[0]?.url ??
        xdt?.display_url ??
        null;

      return { authorHandle, caption, thumbnailUrl, publicVideoUrl };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return {
      authorHandle: null,
      caption: null,
      thumbnailUrl: null,
      publicVideoUrl: null,
    };
  }
}

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

  if (!publicVideoUrl) {
    const videoUrlMatch = html.match(/"video_url"\s*:\s*"(https?:[^"]+)"/);
    if (videoUrlMatch?.[1]) {
      try {
        publicVideoUrl = JSON.parse(`"${videoUrlMatch[1]}"`) as string;
      } catch {
        publicVideoUrl = videoUrlMatch[1]
          .replace(/\\u0026/g, "&")
          .replace(/\\\//g, "/");
      }
    }
  }

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
      blockHtml = blockHtml
        .replace(
          /<a[^>]*class="[^"]*\bCaptionUsername\b[^"]*"[^>]*>[\s\S]*?<\/a>/gi,
          ""
        )
        .replace(
          /<div[^>]*class="[^"]*\bCaptionComments\b[^"]*"[^>]*>[\s\S]*$/gi,
          ""
        );
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
  normalizedUrl: string,
  formatMode: "mp3" | "mp4"
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
        downloadMode: formatMode === "mp4" ? "auto" : "audio",
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
    const ext = formatMode === "mp4" ? "mp4" : "mp3";
    return await downloadStreamToFile(
      streamUrl,
      path.join(rawDir, `${reelId}-resolved.${ext}`)
    );
  } catch {
    return null;
  }
}

/**
 * Multi-stage Reel metadata & automatic audio/video extractor:
 * - When `mediaFormat` is `"mp3"` (recommended) or `"mp4"`, automatically resolves & downloads
 *   the Reel stream using auto-managed standalone `yt-dlp` (with TLS impersonation) +
 *   2026 Polaris GraphQL + Public Embed + External Resolver fallbacks.
 * - When `mediaFormat` is `"skip"`, extracts metadata/caption only without downloading media.
 */
export async function extractReelContent(
  sourceUrl: string,
  options?: {
    reelId?: string;
    existingAuthorHandle?: string | null;
    existingCaption?: string | null;
    existingThumbnailUrl?: string | null;
    hasLocalMedia?: boolean;
    mediaFormat?: MediaConversionChoice;
  }
): Promise<ExtractedMetadata> {
  if (isUploadPlaceholderUrl(sourceUrl)) {
    return {
      authorHandle: options?.existingAuthorHandle ?? null,
      caption: options?.existingCaption ?? null,
      thumbnailUrl: options?.existingThumbnailUrl ?? null,
      resolvedMediaFilePath: null,
      extractionHint: null,
    };
  }

  const normalizedUrl = normalizeInstagramUrl(sourceUrl);
  const shortcode = extractInstagramShortcode(sourceUrl);
  const mediaFormat: MediaConversionChoice = options?.mediaFormat ?? "mp3";
  const shouldDownloadMedia =
    Boolean(options?.reelId) &&
    !options?.hasLocalMedia &&
    mediaFormat !== "skip" &&
    ENV.ENABLE_VIDEO_TRANSCRIPTION;

  const cached = metadataCache.get(normalizedUrl);
  const validCache =
    cached && cached.expiresAt > Date.now() ? cached.value : null;

  let authorHandle: string | null =
    options?.existingAuthorHandle ?? validCache?.authorHandle ?? null;
  let caption: string | null =
    options?.existingCaption ?? validCache?.caption ?? null;
  let thumbnailUrl: string | null =
    options?.existingThumbnailUrl ?? validCache?.thumbnailUrl ?? null;

  let publicVideoUrl: string | null = null;
  let resolvedMediaFilePath: string | null = null;
  let extractionHint: string | null = null;

  // Stage 1: External media resolver webhook if configured
  if (shouldDownloadMedia && options?.reelId) {
    resolvedMediaFilePath = await tryExternalMediaResolver(
      options.reelId,
      normalizedUrl,
      mediaFormat === "mp4" ? "mp4" : "mp3"
    );
  }

  // Stage 2: Auto-managed `yt-dlp` (downloads Reel audio/MP4 + extracts caption, handle & thumbnail!)
  if (shouldDownloadMedia && !resolvedMediaFilePath && options?.reelId) {
    const ytdlpResult = await downloadReelWithYtDlp(
      options.reelId,
      normalizedUrl,
      mediaFormat === "mp4" ? "mp4" : "mp3"
    );
    resolvedMediaFilePath = ytdlpResult.mediaFilePath;
    authorHandle = authorHandle ?? ytdlpResult.authorHandle;
    caption = caption ?? ytdlpResult.caption;
    thumbnailUrl = thumbnailUrl ?? ytdlpResult.thumbnailUrl;
    if (ytdlpResult.failureReason) {
      extractionHint = ytdlpResult.failureReason;
    }
  }

  // Stage 3: Official Meta Graph API oEmbed (for metadata if still needed)
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
          `[Extractor] Meta oEmbed returned ${response.status} — using yt-dlp / GraphQL / public embed fallback.`
        );
      }
    } catch {
      // Continue
    }
  }

  // Stage 4: Instagram Polaris GraphQL (`doc_id: 27130156389949648`)
  if (
    shortcode &&
    (!caption || !authorHandle || (shouldDownloadMedia && !resolvedMediaFilePath))
  ) {
    const gql = await tryPolarisGraphQlExtraction(shortcode, normalizedUrl);
    authorHandle = authorHandle ?? gql.authorHandle;
    caption = caption ?? gql.caption;
    thumbnailUrl = thumbnailUrl ?? gql.thumbnailUrl;
    publicVideoUrl = publicVideoUrl ?? gql.publicVideoUrl;
  }

  // Stage 5: Instagram Public Embed Widget (`/p/<shortcode>/embed/captioned/`)
  if (
    shortcode &&
    (!caption || !authorHandle || (shouldDownloadMedia && !resolvedMediaFilePath && !publicVideoUrl))
  ) {
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
      // Continue
    }
  }

  // Stage 6: Social Crawler OpenGraph `<meta>` fallback
  if (!caption || !authorHandle || !thumbnailUrl) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      try {
        const pageRes = await fetch(normalizedUrl, {
          headers: CRAWLER_OG_HEADERS,
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

  // Stage 7: Download direct `publicVideoUrl` if `yt-dlp` hadn't already downloaded media
  if (
    shouldDownloadMedia &&
    !resolvedMediaFilePath &&
    publicVideoUrl &&
    options?.reelId
  ) {
    const { rawDir } = ensureUploadDirs();
    resolvedMediaFilePath = await downloadStreamToFile(
      publicVideoUrl,
      path.join(rawDir, `${options.reelId}-direct.mp4`)
    );
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
    extractionHint,
  };
}
