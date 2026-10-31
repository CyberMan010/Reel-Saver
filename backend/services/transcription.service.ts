import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { ENV } from "../config/env";

const execFileAsync = promisify(execFile);

export interface TranscriptionResult {
  transcript: string;
  language?: string | null;
  provider: "groq-whisper" | "gemini-audio" | "local-whisper";
}

interface PythonCommand {
  bin: string;
  prefixArgs: string[];
}

let cachedPythonCmd: PythonCommand | null | undefined;

/**
 * Resolves a real Python 3 interpreter across Windows (`python`, `py -3`)
 * and Linux/macOS (`python3`, `python`), avoiding the Windows Store stub.
 */
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

/**
 * Builds child-process environment variables keeping all Whisper/HuggingFace
 * model caches and temporary files on the repo drive (e.g. E:\...) instead of C:\.
 */
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

async function transcribeWithLocalWhisper(
  mp3FilePath: string
): Promise<TranscriptionResult> {
  const py = await resolvePythonCommand();
  if (!py) {
    throw new Error(
      "Python 3 was not found on PATH. Install Python 3 or set GROQ_API_KEY / GEMINI_API_KEY."
    );
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
  if (preferred === "local-whisper") {
    return transcribeWithLocalWhisper(mp3FilePath);
  }

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

  if (await isLocalWhisperInstalled()) {
    try {
      return await transcribeWithLocalWhisper(mp3FilePath);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  if (errors.length > 0) {
    console.warn(
      `[Transcription] Audio transcription providers failed (${errors.join(
        " | "
      )}); falling back to metadata/caption context.`
    );
  }

  return null;
}
