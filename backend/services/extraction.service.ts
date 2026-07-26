import { ENV } from "../config/env";

const OEMBED_URL = "https://graph.facebook.com/v18.0/instagram_oembed";

export interface ExtractedReelContent {
  authorHandle: string | null;
  caption: string | null;
  thumbnailUrl: string | null;
  transcript: string | null;
}

interface OEmbedResponse {
  author_name?: string;
  title?: string;
  thumbnail_url?: string;
}

/**
 * Optional future path — gated behind ENABLE_VIDEO_TRANSCRIPTION.
 * Not used in the default caption-only pipeline.
 */
export async function transcribeReelVideo(_sourceUrl: string): Promise<string | null> {
  if (!ENV.ENABLE_VIDEO_TRANSCRIPTION) {
    return null;
  }

  throw new Error(
    "Video transcription is not implemented. Enable only after accepting Instagram ToS risk."
  );
}

export async function extractReelContent(sourceUrl: string): Promise<ExtractedReelContent> {
  const accessToken = ENV.FACEBOOK_APP_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error("FACEBOOK_APP_ACCESS_TOKEN is not configured.");
  }

  const url = new URL(OEMBED_URL);
  url.searchParams.set("url", sourceUrl);
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url.toString());
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Instagram oEmbed failed (${response.status}): ${body}`);
  }

  const payload = (await response.json()) as OEmbedResponse;
  const transcript = await transcribeReelVideo(sourceUrl);

  return {
    authorHandle: payload.author_name ?? null,
    caption: payload.title ?? null,
    thumbnailUrl: payload.thumbnail_url ?? null,
    transcript,
  };
}

export function isInstagramReelUrl(sourceUrl: string): boolean {
  try {
    const parsed = new URL(sourceUrl);
    const host = parsed.hostname.replace(/^www\./, "");
    if (host !== "instagram.com") return false;

    return /^\/(reel|reels|p|tv)\/[^/]+/.test(parsed.pathname);
  } catch {
    return false;
  }
}
