import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { WaveFile } from "wavefile";
import { ENV } from "../config/env";
import { resolveFfmpegPath } from "./media.service";

const execFileAsync = promisify(execFile);

// Preserves native ESM `import()` even when compiled to CommonJS (`tsc`)
const dynamicEsmImport = new Function(
  "specifier",
  "return import(specifier)"
) as (specifier: string) => Promise<Record<string, unknown>>;

export interface TranscriptionResult {
  transcript: string;
  language?: string | null;
  provider:
    | "groq-whisper"
    | "gemini-audio"
    | "node-whisper"
    | "local-whisper";
}

interface PythonCommand {
  bin: string;
  prefixArgs: string[];
}

let cachedPythonCmd: PythonCommand | null | undefined;
let cachedNodeTranscriberPromise: Promise<
  (audio: Float32Array, options?: Record<string, unknown>) => Promise<{ text?: string }>
> | null = null;
let cachedNodeModelId: string | null = null;

export function isNodeWhisperAvailable(): boolean {
  const candidates = [
    path.resolve(process.cwd(), "node_modules/@xenova/transformers/package.json"),
    path.resolve(__dirname, "../node_modules/@xenova/transformers/package.json"),
    path.resolve(__dirname, "../../node_modules/@xenova/transformers/package.json"),
  ];
  return candidates.some((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
}

async function resolvePythonCommand(): Promise<PythonCommand | null> {
  if (cachedPythonCmd !== undefined) {
    return cachedPythonCmd;
  }

  const candidates: PythonCommand[] = [];
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

  for (const candidate of candidates) {
    try {
      const { stdout } = await execFileAsync(
        candidate.bin,
        [...candidate.prefixArgs, "-c", "import sys; print(sys.version_info[0])"],
        { timeout: 4000 }
      );
      if (stdout.trim() === "3") {
        cachedPythonCmd = candidate;
        return cachedPythonCmd;
      }
    } catch {
      // Try next candidate
    }
  }

  cachedPythonCmd = null;
  return null;
}

function buildDiskSafePythonEnv(): NodeJS.ProcessEnv {
  const cacheDir = ENV.WHISPER_CACHE_DIR;
  const tmpDir = path.join(ENV.UPLOADS_DIR, "tmp");
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  return {
    ...process.env,
    WHISPER_CACHE_DIR: cacheDir,
    HF_HOME: cacheDir,
    HUGGINGFACE_HUB_CACHE: cacheDir,
    TORCH_HOME: cacheDir,
    TMPDIR: tmpDir,
    TEMP: tmpDir,
    TMP: tmpDir,
    PYTHONIOENCODING: "utf-8",
  };
}

export async function isLocalWhisperInstalled(): Promise<boolean> {
  if (isNodeWhisperAvailable()) {
    return true;
  }
  return isPythonWhisperInstalled();
}

export async function isPythonWhisperInstalled(): Promise<boolean> {
  const py = await resolvePythonCommand();
  if (!py) return false;

  try {
    await execFileAsync(
      py.bin,
      [
        ...py.prefixArgs,
        "-c",
        "import importlib.util, sys; ok = bool(importlib.util.find_spec('faster_whisper') or importlib.util.find_spec('whisper')); sys.exit(0 if ok else 1)",
      ],
      { timeout: 5000, env: buildDiskSafePythonEnv() }
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Decodes an MP3/audio file into 16kHz mono Float32 PCM samples via FFmpeg + wavefile.
 */
async function decodeAudioToFloat32Samples(
  audioFilePath: string
): Promise<Float32Array> {
  const ffmpegBin = resolveFfmpegPath();
  if (!ffmpegBin) {
    throw new Error("FFmpeg binary is required to decode audio samples.");
  }

  const { stdout } = await execFileAsync(
    ffmpegBin,
    [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      audioFilePath,
      "-ar",
      "16000",
      "-ac",
      "1",
      "-f",
      "wav",
      "pipe:1",
    ],
    {
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 60000,
    }
  );

  const wav = new WaveFile(stdout);
  wav.toBitDepth("32f");
  const rawSamples = wav.getSamples();
  const mono = Array.isArray(rawSamples) ? rawSamples[0] : rawSamples;
  return mono instanceof Float32Array ? mono : new Float32Array(mono);
}

function cleanWhisperArtifactTokens(raw: string): string {
  const cleaned = raw
    .replace(/\[(?:BLANK_AUDIO|MUSIC|SILENCE|APPLAUSE|LAUGHTER)\]/gi, "")
    .replace(/\((?:music|silence|applause|laughter|inaudible|bell|beep|tone)\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned;
}

/**
 * Built-in Pure Node.js OpenAI Whisper via `@xenova/transformers` (ONNX WebAssembly).
 * - Zero Python required, zero Docker required, zero credit card, zero API keys.
 * - Stores model weights (~140MB for `whisper-base`) inside `ENV.WHISPER_CACHE_DIR`
 *   on the repo drive (e.g. `E:\...\backend\data\whisper-models`) so `C:\` is untouched.
 */
async function transcribeWithNodeWhisper(
  mp3FilePath: string
): Promise<TranscriptionResult> {
  fs.mkdirSync(ENV.WHISPER_CACHE_DIR, { recursive: true });

  const samples = await decodeAudioToFloat32Samples(mp3FilePath);
  if (samples.length < 1600) {
    return { transcript: "", provider: "node-whisper" };
  }

  // Check RMS energy so pure digital silence returns immediately
  let energySum = 0;
  for (let i = 0; i < samples.length; i++) {
    energySum += samples[i] * samples[i];
  }
  const rms = Math.sqrt(energySum / samples.length);
  if (rms < 0.0005) {
    return { transcript: "", provider: "node-whisper" };
  }

  const size = ENV.WHISPER_MODEL_SIZE || "base";
  const modelId = size.includes("/") ? size : `Xenova/whisper-${size}`;

  if (!cachedNodeTranscriberPromise || cachedNodeModelId !== modelId) {
    cachedNodeModelId = modelId;
    cachedNodeTranscriberPromise = (async () => {
      const transformers = await dynamicEsmImport("@xenova/transformers");
      const tfEnv = transformers.env as {
        cacheDir?: string;
        allowLocalModels?: boolean;
      };
      tfEnv.cacheDir = ENV.WHISPER_CACHE_DIR;
      tfEnv.allowLocalModels = true;

      if (ENV.NODE_ENV !== "test") {
        console.log(
          `[Whisper] Loading local Node.js model "${modelId}" (cache: ${ENV.WHISPER_CACHE_DIR})...`
        );
      }

      const pipelineFn = transformers.pipeline as (
        task: string,
        model: string,
        opts?: Record<string, unknown>
      ) => Promise<
        (
          audio: Float32Array,
          options?: Record<string, unknown>
        ) => Promise<{ text?: string }>
      >;

      return await pipelineFn("automatic-speech-recognition", modelId, {
        quantized: true,
      });
    })();
  }

  let transcriber;
  try {
    transcriber = await cachedNodeTranscriberPromise;
  } catch (err) {
    cachedNodeTranscriberPromise = null;
    throw err;
  }

  const startMs = Date.now();
  const isEnglishOnlyModel = /\.en$/i.test(modelId);
  const options: Record<string, unknown> = {
    chunk_length_s: 30,
    stride_length_s: 5,
  };
  if (!isEnglishOnlyModel) {
    // Passing task="transcribe" with language omitted clears any English-forced
    // token in generation_config so multilingual Whisper auto-detects Arabic/English/etc.
    options.task = "transcribe";
    if (ENV.WHISPER_LANGUAGE) {
      options.language = ENV.WHISPER_LANGUAGE;
    }
  }

  const result = await transcriber(samples, options);
  const transcript = cleanWhisperArtifactTokens(result?.text ?? "");

  if (ENV.NODE_ENV !== "test") {
    const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);
    console.log(
      `[Whisper] Node.js Whisper finished in ${elapsedSec}s (${transcript.length} chars).`
    );
  }

  return {
    transcript,
    provider: "node-whisper",
  };
}

async function transcribeWithGroq(
  mp3FilePath: string
): Promise<TranscriptionResult> {
  if (!ENV.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is not configured.");
  }

  const buffer = fs.readFileSync(mp3FilePath);
  const blob = new Blob([buffer], { type: "audio/mpeg" });
  const form = new FormData();
  form.append("file", blob, path.basename(mp3FilePath));
  form.append("model", ENV.GROQ_WHISPER_MODEL);
  form.append("response_format", "verbose_json");

  const response = await fetch(
    "https://api.groq.com/openai/v1/audio/transcriptions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ENV.GROQ_API_KEY}`,
      },
      body: form,
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Groq Whisper API failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as {
    text?: string;
    language?: string;
  };
  const transcript = (data.text ?? "").trim();

  return {
    transcript,
    language: data.language ?? null,
    provider: "groq-whisper",
  };
}

async function transcribeWithGemini(
  mp3FilePath: string
): Promise<TranscriptionResult> {
  if (!ENV.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const base64Audio = fs.readFileSync(mp3FilePath).toString("base64");
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    ENV.GEMINI_MODEL
  )}:generateContent?key=${encodeURIComponent(ENV.GEMINI_API_KEY)}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              inline_data: {
                mime_type: "audio/mp3",
                data: base64Audio,
              },
            },
            {
              text: "Transcribe every spoken word in this audio clip accurately in its original language. Return ONLY the plain spoken transcript text with proper punctuation. If there is no speech at all, return an empty string.",
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini Audio STT failed (${response.status}): ${body}`);
  }

  const json = (await response.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };

  const text =
    json.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join(" ")
      .trim() ?? "";

  return {
    transcript: text,
    provider: "gemini-audio",
  };
}

async function transcribeWithPythonWhisper(
  mp3FilePath: string
): Promise<TranscriptionResult> {
  const py = await resolvePythonCommand();
  if (!py) {
    throw new Error("Python 3 was not found on PATH.");
  }

  const scriptCandidates = [
    path.resolve(process.cwd(), "scripts/transcribe_local.py"),
    path.resolve(__dirname, "../scripts/transcribe_local.py"),
  ];
  const scriptPath = scriptCandidates.find((p) => fs.existsSync(p));
  if (!scriptPath) {
    throw new Error("Local Whisper helper script not found.");
  }

  const { stdout } = await execFileAsync(
    py.bin,
    [...py.prefixArgs, scriptPath, mp3FilePath, ENV.WHISPER_MODEL_SIZE],
    {
      timeout: 300000,
      maxBuffer: 10 * 1024 * 1024,
      env: buildDiskSafePythonEnv(),
    }
  );

  const parsed = JSON.parse(stdout.trim()) as {
    transcript?: string;
    language?: string | null;
  };

  return {
    transcript: (parsed.transcript ?? "").trim(),
    language: parsed.language ?? null,
    provider: "local-whisper",
  };
}

/**
 * Cascades automatically across zero-credit-card speech-to-text providers:
 * 1. Groq Free Cloud Whisper (if GROQ_API_KEY configured)
 * 2. Gemini Free Audio (if GEMINI_API_KEY configured)
 * 3. Built-in Pure Node.js Whisper (`@xenova/transformers` — zero Python/keys needed!)
 * 4. Optional Python `faster-whisper` fallback
 */
export async function transcribeAudioFile(
  mp3FilePath: string
): Promise<TranscriptionResult | null> {
  if (!fs.existsSync(mp3FilePath)) {
    return null;
  }

  const preferred = ENV.TRANSCRIPTION_PROVIDER;
  const errors: string[] = [];

  if (preferred === "groq") {
    return transcribeWithGroq(mp3FilePath);
  }
  if (preferred === "gemini") {
    return transcribeWithGemini(mp3FilePath);
  }
  if (preferred === "node-whisper") {
    return transcribeWithNodeWhisper(mp3FilePath);
  }
  if (preferred === "local-whisper") {
    if (await isPythonWhisperInstalled()) {
      return transcribeWithPythonWhisper(mp3FilePath);
    }
    return transcribeWithNodeWhisper(mp3FilePath);
  }

  // "auto" cascade
  if (ENV.GROQ_API_KEY) {
    try {
      return await transcribeWithGroq(mp3FilePath);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  if (ENV.GEMINI_API_KEY) {
    try {
      return await transcribeWithGemini(mp3FilePath);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  // Built-in pure Node.js Whisper (works out of the box with `npm install`!)
  if (isNodeWhisperAvailable() && ENV.NODE_ENV !== "test") {
    try {
      const nodeRes = await transcribeWithNodeWhisper(mp3FilePath);
      if (nodeRes.transcript) {
        return nodeRes;
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  // Optional Python faster-whisper fallback
  if (await isPythonWhisperInstalled()) {
    try {
      return await transcribeWithPythonWhisper(mp3FilePath);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  if (errors.length > 0 && ENV.NODE_ENV !== "test") {
    console.warn(
      `[Transcription] Audio transcription attempts encountered errors (${errors.join(
        " | "
      )}).`
    );
  }

  return null;
}
