import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { ENV } from "../config/env";

const execFileAsync = promisify(execFile);

let cachedFfmpegPath: string | null | undefined;

export function resolveFfmpegPath(): string | null {
  if (cachedFfmpegPath !== undefined) {
    return cachedFfmpegPath;
  }

  if (ENV.FFMPEG_PATH && fs.existsSync(ENV.FFMPEG_PATH)) {
    cachedFfmpegPath = ENV.FFMPEG_PATH;
    return cachedFfmpegPath;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const installer = require("@ffmpeg-installer/ffmpeg") as { path?: string };
    if (installer?.path && fs.existsSync(installer.path)) {
      cachedFfmpegPath = installer.path;
      return cachedFfmpegPath;
    }
  } catch {
    // Fall through to system binary check
  }

  cachedFfmpegPath = "ffmpeg";
  return cachedFfmpegPath;
}

export async function isFfmpegAvailable(): Promise<boolean> {
  const bin = resolveFfmpegPath();
  if (!bin) return false;
  try {
    await execFileAsync(bin, ["-version"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function parseDurationSeconds(stderrOutput: string): number | null {
  const match = stderrOutput.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}\.\d+)/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const total = hours * 3600 + minutes * 60 + seconds;
  return Number.isFinite(total) ? Math.round(total * 10) / 10 : null;
}

export interface ProcessedMediaResult {
  audioDiskPath: string | null;
  audioUrl: string | null;
  thumbnailUrl: string | null;
  durationSec: number | null;
  hasAudio: boolean;
}

export function ensureUploadDirs(): {
  rawDir: string;
  audioDir: string;
  thumbsDir: string;
} {
  const rawDir = path.join(ENV.UPLOADS_DIR, "raw");
  const audioDir = path.join(ENV.UPLOADS_DIR, "audio");
  const thumbsDir = path.join(ENV.UPLOADS_DIR, "thumbs");
  fs.mkdirSync(rawDir, { recursive: true });
  fs.mkdirSync(audioDir, { recursive: true });
  fs.mkdirSync(thumbsDir, { recursive: true });
  return { rawDir, audioDir, thumbsDir };
}

function isVideoFile(filePath: string, mimeType?: string): boolean {
  if (mimeType && mimeType.startsWith("video/")) return true;
  const ext = path.extname(filePath).toLowerCase();
  return [".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"].includes(ext);
}

/**
 * Converts an uploaded MP4/video or audio file into an optimized 16kHz mono MP3
 * ready for speech-to-text transcription, extracts duration + optional video thumbnail,
 * and cleans up the raw temporary upload.
 */
export async function convertMediaToMp3(
  reelId: string,
  inputFilePath: string,
  mimeType?: string
): Promise<ProcessedMediaResult> {
  const { audioDir, thumbsDir } = ensureUploadDirs();
  const ffmpegBin = resolveFfmpegPath();

  if (!ffmpegBin) {
    throw new Error("FFmpeg binary is not available on this server.");
  }

  const outputMp3Path = path.join(audioDir, `${reelId}.mp3`);
  const outputThumbPath = path.join(thumbsDir, `${reelId}.jpg`);
  const videoInput = isVideoFile(inputFilePath, mimeType);

  let durationSec: number | null = null;
  let hasAudio = false;
  let thumbnailUrl: string | null = null;

  try {
    // 1. Probe input streams & duration
    let probeStderr = "";
    try {
      await execFileAsync(ffmpegBin, ["-hide_banner", "-i", inputFilePath], {
        timeout: 15000,
      });
    } catch (err: unknown) {
      // `ffmpeg -i <file>` with no output exits with code 1 and prints stream info to stderr
      probeStderr =
        (err as { stderr?: string })?.stderr ??
        (err instanceof Error ? err.message : "");
    }

    durationSec = parseDurationSeconds(probeStderr);
    const streamHasAudio = /Stream #\d+:\d+.*Audio:/i.test(probeStderr);

    // 2. Extract cover frame if input is a video
    if (videoInput) {
      try {
        await execFileAsync(
          ffmpegBin,
          [
            "-y",
            "-ss",
            "00:00:00.200",
            "-i",
            inputFilePath,
            "-vframes",
            "1",
            "-q:v",
            "3",
            outputThumbPath,
          ],
          { timeout: 20000 }
        );
        if (
          fs.existsSync(outputThumbPath) &&
          fs.statSync(outputThumbPath).size > 0
        ) {
          thumbnailUrl = `/uploads/thumbs/${reelId}.jpg`;
        }
      } catch {
        // Non-fatal if video has no decodable frame at 0.2s
      }
    }

    // 3. Convert audio stream to 16kHz mono 64kbps MP3 for Whisper / STT
    if (streamHasAudio || !videoInput) {
      try {
        const { stderr } = await execFileAsync(
          ffmpegBin,
          [
            "-y",
            "-i",
            inputFilePath,
            "-vn",
            "-acodec",
            "libmp3lame",
            "-ar",
            "16000",
            "-ac",
            "1",
            "-b:a",
            "64k",
            outputMp3Path,
          ],
          { timeout: 120000 }
        );

        if (!durationSec) {
          durationSec = parseDurationSeconds(stderr);
        }

        if (
          fs.existsSync(outputMp3Path) &&
          fs.statSync(outputMp3Path).size > 0
        ) {
          hasAudio = true;
        }
      } catch (convErr) {
        if (!videoInput) {
          throw new Error(
            `Failed to convert audio file to MP3: ${
              convErr instanceof Error ? convErr.message : String(convErr)
            }`
          );
        }
        hasAudio = false;
      }
    }

    return {
      audioDiskPath: hasAudio ? outputMp3Path : null,
      audioUrl: hasAudio ? `/uploads/audio/${reelId}.mp3` : null,
      thumbnailUrl,
      durationSec,
      hasAudio,
    };
  } finally {
    // Always remove temporary raw upload if it differs from outputMp3Path
    if (
      path.resolve(inputFilePath) !== path.resolve(outputMp3Path) &&
      fs.existsSync(inputFilePath)
    ) {
      try {
        fs.unlinkSync(inputFilePath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

export function deleteReelMediaFiles(reelId: string): void {
  const { audioDir, thumbsDir } = ensureUploadDirs();
  for (const file of [
    path.join(audioDir, `${reelId}.mp3`),
    path.join(thumbsDir, `${reelId}.jpg`),
  ]) {
    if (fs.existsSync(file)) {
      try {
        fs.unlinkSync(file);
      } catch {
        // Ignore
      }
    }
  }
}
