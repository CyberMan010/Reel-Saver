import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { ENV } from "../config/env";
import { ensureUploadDirs, resolveFfmpegPath } from "./media.service";

const execFileAsync = promisify(execFile);

export interface YtDlpExtractionResult {
  mediaFilePath: string | null;
  authorHandle: string | null;
  caption: string | null;
  thumbnailUrl: string | null;
  durationSec: number | null;
  failureReason?: string | null;
}

interface YtDlpRunner {
  bin: string;
  prefixArgs: string[];
  extraEnv?: NodeJS.ProcessEnv;
}

let resolvedRunner: YtDlpRunner | null = null;
let inFlightBootstrap: Promise<YtDlpRunner | null> | null = null;

function getLocalManagedYtDlpPath(): string {
  fs.mkdirSync(ENV.YTDLP_BIN_DIR, { recursive: true });
  const fileName = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
  return path.join(ENV.YTDLP_BIN_DIR, fileName);
}

function getLocalPyPkgDir(): string {
  return path.join(ENV.YTDLP_BIN_DIR, "pypkg");
}

function getStandaloneReleaseAssetName(): string {
  if (process.platform === "win32") {
    return "yt-dlp.exe";
  }
  if (process.platform === "darwin") {
    return "yt-dlp_macos";
  }
  if (process.arch === "arm64") {
    return "yt-dlp_linux_aarch64";
  }
  return "yt-dlp_linux";
}

function buildDiskSafeYtDlpEnv(extraEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const tmpDir = path.join(ENV.UPLOADS_DIR, "tmp");
  const cacheDir = path.join(ENV.LOCAL_DATA_DIR, "ytdlp-cache");
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });

  return {
    ...process.env,
    TEMP: tmpDir,
    TMP: tmpDir,
    TMPDIR: tmpDir,
    XDG_CACHE_HOME: cacheDir,
    PYTHONIOENCODING: "utf-8",
    ...extraEnv,
  };
}

async function verifyYtDlpRunner(runner: YtDlpRunner): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      runner.bin,
      [...runner.prefixArgs, "--version"],
      {
        timeout: 8000,
        env: buildDiskSafeYtDlpEnv(runner.extraEnv),
      }
    );
    return Boolean(stdout && stdout.trim().length >= 6);
  } catch {
    return false;
  }
}

async function findPython3(): Promise<{ bin: string; prefixArgs: string[] } | null> {
  const candidates: Array<{ bin: string; prefixArgs: string[] }> = [];
  if (ENV.PYTHON_BIN) {
    candidates.push({ bin: ENV.PYTHON_BIN, prefixArgs: [] });
  }
  if (process.platform === "win32") {
    candidates.push(
      { bin: "python", prefixArgs: [] },
      { bin: "py", prefixArgs: ["-3"] },
      { bin: "python3", prefixArgs: [] }
    );
  } else {
    candidates.push(
      { bin: "python3", prefixArgs: [] },
      { bin: "python", prefixArgs: [] }
    );
  }

  for (const c of candidates) {
    try {
      const { stdout } = await execFileAsync(
        c.bin,
        [...c.prefixArgs, "-c", "import sys; print(sys.version_info[0])"],
        { timeout: 4000 }
      );
      if (stdout.trim() === "3") return c;
    } catch {
      // Try next
    }
  }
  return null;
}

export function isYtDlpInstalledSync(): boolean {
  if (resolvedRunner) {
    return true;
  }
  if (ENV.YTDLP_PATH && fs.existsSync(ENV.YTDLP_PATH)) {
    return true;
  }
  const managed = getLocalManagedYtDlpPath();
  if (fs.existsSync(managed) && fs.statSync(managed).size > 100_000) {
    return true;
  }
  const pyPkg = path.join(getLocalPyPkgDir(), "yt_dlp");
  return fs.existsSync(pyPkg);
}

/**
 * Resolves a working `yt-dlp` runner, or automatically downloads:
 * 1. Official standalone `yt-dlp(.exe)` binary from GitHub Releases into `backend/data/bin/`
 * 2. Fallback: `pip install --no-cache-dir --target backend/data/bin/pypkg yt-dlp` (on repo drive, 0 bytes on `C:\`)
 */
export async function ensureYtDlpRunner(): Promise<YtDlpRunner | null> {
  if (resolvedRunner && (await verifyYtDlpRunner(resolvedRunner))) {
    return resolvedRunner;
  }

  // 1. Explicit env path
  if (ENV.YTDLP_PATH && fs.existsSync(ENV.YTDLP_PATH)) {
    const r: YtDlpRunner = { bin: ENV.YTDLP_PATH, prefixArgs: [] };
    if (await verifyYtDlpRunner(r)) {
      resolvedRunner = r;
      return resolvedRunner;
    }
  }

  // 2. Managed standalone binary in `backend/data/bin/`
  const managedPath = getLocalManagedYtDlpPath();
  if (fs.existsSync(managedPath)) {
    const r: YtDlpRunner = { bin: managedPath, prefixArgs: [] };
    if (await verifyYtDlpRunner(r)) {
      resolvedRunner = r;
      return resolvedRunner;
    }
  }

  // 3. System PATH binary
  const systemCandidates =
    process.platform === "win32" ? ["yt-dlp.exe", "yt-dlp"] : ["yt-dlp"];
  for (const candidate of systemCandidates) {
    const r: YtDlpRunner = { bin: candidate, prefixArgs: [] };
    if (await verifyYtDlpRunner(r)) {
      resolvedRunner = r;
      return resolvedRunner;
    }
  }

  // 4. Previously installed local Python `yt_dlp` package in `backend/data/bin/pypkg`
  const py = await findPython3();
  const pyPkgDir = getLocalPyPkgDir();
  if (py && fs.existsSync(path.join(pyPkgDir, "yt_dlp"))) {
    const r: YtDlpRunner = {
      bin: py.bin,
      prefixArgs: [...py.prefixArgs, "-m", "yt_dlp"],
      extraEnv: { PYTHONPATH: pyPkgDir },
    };
    if (await verifyYtDlpRunner(r)) {
      resolvedRunner = r;
      return resolvedRunner;
    }
  }

  if (!ENV.YTDLP_AUTO_DOWNLOAD || ENV.NODE_ENV === "test") {
    return null;
  }

  if (!inFlightBootstrap) {
    inFlightBootstrap = (async () => {
      // Attempt A: Standalone GitHub release binary (works on Windows even with zero Python!)
      const assetName = getStandaloneReleaseAssetName();
      const downloadUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${assetName}`;
      const partPath = `${managedPath}.download`;

      console.log(
        `[yt-dlp] Bootstrapping standalone extractor (${assetName}) into ${managedPath}...`
      );

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 120000);
        try {
          const res = await fetch(downloadUrl, {
            redirect: "follow",
            headers: { "User-Agent": "Reel-Saver-Backend/1.0" },
            signal: controller.signal,
          });

          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }

          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length < 500_000) {
            throw new Error("Downloaded binary was unexpectedly small.");
          }

          fs.writeFileSync(partPath, buf);
          if (process.platform !== "win32") {
            fs.chmodSync(partPath, 0o755);
          }
          if (fs.existsSync(managedPath)) {
            fs.unlinkSync(managedPath);
          }
          fs.renameSync(partPath, managedPath);
        } finally {
          clearTimeout(timer);
        }

        const binRunner: YtDlpRunner = { bin: managedPath, prefixArgs: [] };
        if (await verifyYtDlpRunner(binRunner)) {
          console.log(`[yt-dlp] Standalone extractor ready at ${managedPath}`);
          resolvedRunner = binRunner;
          return binRunner;
        }
      } catch (err) {
        try {
          if (fs.existsSync(partPath)) fs.unlinkSync(partPath);
        } catch {
          // Ignore cleanup
        }
        console.warn(
          `[yt-dlp] Standalone binary download skipped (${
            err instanceof Error ? err.message : String(err)
          }), trying PyPI fallback...`
        );
      }

      // Attempt B: PyPI `yt-dlp` wheel installed into `backend/data/bin/pypkg` (0 bytes on C:\)
      if (py) {
        try {
          fs.mkdirSync(pyPkgDir, { recursive: true });
          await execFileAsync(
            py.bin,
            [
              ...py.prefixArgs,
              "-m",
              "pip",
              "install",
              "--quiet",
              "--no-cache-dir",
              "--upgrade",
              "--target",
              pyPkgDir,
              "yt-dlp",
            ],
            {
              timeout: 90000,
              env: buildDiskSafeYtDlpEnv(),
            }
          );

          const pyRunner: YtDlpRunner = {
            bin: py.bin,
            prefixArgs: [...py.prefixArgs, "-m", "yt_dlp"],
            extraEnv: { PYTHONPATH: pyPkgDir },
          };
          if (await verifyYtDlpRunner(pyRunner)) {
            console.log(`[yt-dlp] PyPI extractor ready in ${pyPkgDir}`);
            resolvedRunner = pyRunner;
            return pyRunner;
          }
        } catch (pipErr) {
          console.warn(
            `[yt-dlp] PyPI fallback failed: ${
              pipErr instanceof Error ? pipErr.message : String(pipErr)
            }`
          );
        }
      }

      return null;
    })();
  }

  return inFlightBootstrap;
}

/**
 * Downloads an Instagram Reel's audio (or full MP4 video) + metadata JSON in a single pass.
 */
export async function downloadReelWithYtDlp(
  reelId: string,
  normalizedUrl: string,
  formatMode: "mp3" | "mp4" = "mp3"
): Promise<YtDlpExtractionResult> {
  const runner = await ensureYtDlpRunner();
  if (!runner) {
    return {
      mediaFilePath: null,
      authorHandle: null,
      caption: null,
      thumbnailUrl: null,
      durationSec: null,
      failureReason: "yt-dlp binary unavailable",
    };
  }

  const { rawDir } = ensureUploadDirs();
  const cacheDir = path.join(ENV.LOCAL_DATA_DIR, "ytdlp-cache");
  fs.mkdirSync(cacheDir, { recursive: true });

  const prefix = `${reelId}-ytdlp`;
  const outputTemplate = path.join(rawDir, `${prefix}.%(ext)s`);
  const ffmpegBin = resolveFfmpegPath();

  const args: string[] = [
    ...runner.prefixArgs,
    "--no-playlist",
    "--no-warnings",
    "--no-progress",
    "--write-info-json",
    "--cache-dir",
    cacheDir,
  ];

  if (formatMode === "mp4") {
    args.push(
      "-f",
      "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
      "--merge-output-format",
      "mp4"
    );
  } else {
    args.push("-f", "bestaudio[ext=m4a]/bestaudio/best");
  }

  if (ffmpegBin && ffmpegBin !== "ffmpeg" && fs.existsSync(ffmpegBin)) {
    args.push("--ffmpeg-location", ffmpegBin);
  }

  if (ENV.YTDLP_COOKIES_FILE && fs.existsSync(ENV.YTDLP_COOKIES_FILE)) {
    args.push("--cookies", ENV.YTDLP_COOKIES_FILE);
  } else if (ENV.YTDLP_COOKIES_FROM_BROWSER) {
    args.push("--cookies-from-browser", ENV.YTDLP_COOKIES_FROM_BROWSER);
  }

  args.push("-o", outputTemplate, normalizedUrl);

  let stderrText = "";
  try {
    if (ENV.NODE_ENV !== "test") {
      console.log(
        `[yt-dlp] Extracting Reel media (${formatMode.toUpperCase()}) from ${normalizedUrl}...`
      );
    }
    await execFileAsync(runner.bin, args, {
      timeout: 90000,
      maxBuffer: 16 * 1024 * 1024,
      env: buildDiskSafeYtDlpEnv(runner.extraEnv),
    });
  } catch (err: unknown) {
    stderrText =
      (err as { stderr?: string })?.stderr ??
      (err instanceof Error ? err.message : String(err));
    if (ENV.NODE_ENV !== "test") {
      console.warn(`[yt-dlp] Extraction warning/error: ${stderrText.slice(0, 300)}`);
    }
  }

  let authorHandle: string | null = null;
  let caption: string | null = null;
  let thumbnailUrl: string | null = null;
  let durationSec: number | null = null;
  let mediaFilePath: string | null = null;

  try {
    const matchingFiles = fs
      .readdirSync(rawDir)
      .filter((f) => f.startsWith(`${prefix}.`));

    const infoJsonFile = matchingFiles.find((f) => f.endsWith(".info.json"));
    if (infoJsonFile) {
      const infoPath = path.join(rawDir, infoJsonFile);
      try {
        const rawJson = fs.readFileSync(infoPath, "utf-8");
        const info = JSON.parse(rawJson) as {
          description?: string;
          channel?: string;
          uploader?: string;
          uploader_id?: string;
          thumbnail?: string;
          duration?: number;
        };

        if (info.description && info.description.trim()) {
          caption = info.description.trim();
        }
        const candidateHandle = info.channel || info.uploader || null;
        if (candidateHandle && !/^\d+$/.test(candidateHandle)) {
          authorHandle = candidateHandle.replace(/^@/, "").trim();
        }
        if (info.thumbnail) {
          thumbnailUrl = info.thumbnail;
        }
        if (typeof info.duration === "number" && Number.isFinite(info.duration)) {
          durationSec = Math.round(info.duration * 10) / 10;
        }
      } catch {
        // Ignore info JSON parse errors
      } finally {
        try {
          fs.unlinkSync(infoPath);
        } catch {
          // Ignore cleanup
        }
      }
    }

    const mediaFile = matchingFiles.find(
      (f) => !f.endsWith(".info.json") && !f.endsWith(".part") && !f.endsWith(".ytdl")
    );
    if (mediaFile) {
      const fullMediaPath = path.join(rawDir, mediaFile);
      if (fs.existsSync(fullMediaPath) && fs.statSync(fullMediaPath).size > 1024) {
        mediaFilePath = fullMediaPath;
      }
    }
  } catch {
    // Ignore directory read error
  }

  let failureReason: string | null = null;
  if (!mediaFilePath && stderrText) {
    if (/login required|rate-limit|registered users|Restricted Video/i.test(stderrText)) {
      failureReason =
        "Instagram restricted anonymous access to this Reel (private, age-gated, or rate-limited). Set YTDLP_COOKIES_FROM_BROWSER=edge (or chrome) in .env, or upload the MP4/MP3 file directly.";
    } else {
      failureReason = stderrText.split("\n").filter(Boolean).pop() ?? null;
    }
  }

  return {
    mediaFilePath,
    authorHandle,
    caption,
    thumbnailUrl,
    durationSec,
    failureReason,
  };
}
