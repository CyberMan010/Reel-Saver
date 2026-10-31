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

export async function isLocalWhisperInstalled(): Promise<boolean> {
  try {
    await execFileAsync(
      ENV.PYTHON_BIN,
      [
        "-c",
        "import importlib.util, sys; ok = bool(importlib.util.find_spec('faster_whisper') or importlib.util.find_spec('whisper')); sys.exit(0 if ok else 1)",
      ],
      { timeout: 5000 }
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Provider 1: Groq Cloud Free-Tier Whisper (`whisper-large-v3-turbo`)
 * Free API key from https://console.groq.com — no credit card required.
 */
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

/**
 * Provider 2: Google Gemini Free Tier (`gemini-2.5-flash`)
 * Free API key from https://aistudio.google.com — no credit card required.
 * Natively understands MP3 audio across English, Arabic, and 100+ languages.
 */
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

/**
 * Provider 3: Local Open-Source Whisper (`faster-whisper` / `openai-whisper`)
 * 100% free, runs locally on CPU/GPU, zero API keys and zero credit card.
 */
async function transcribeWithLocalWhisper(
  mp3FilePath: string
): Promise<TranscriptionResult> {
  const scriptCandidates = [
    path.resolve(process.cwd(), "scripts/transcribe_local.py"),
    path.resolve(__dirname, "../scripts/transcribe_local.py"),
  ];
  const scriptPath = scriptCandidates.find((p) => fs.existsSync(p));
  if (!scriptPath) {
    throw new Error("Local Whisper helper script not found.");
  }

  const { stdout } = await execFileAsync(
    ENV.PYTHON_BIN,
    [scriptPath, mp3FilePath, ENV.WHISPER_MODEL_SIZE],
    { timeout: 300000, maxBuffer: 10 * 1024 * 1024 }
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
 * Transcribe an MP3 audio file using configured card-free speech-to-text providers.
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
  if (preferred === "local-whisper") {
    return transcribeWithLocalWhisper(mp3FilePath);
  }

  // "auto" cascade: Groq (free cloud, fast) -> Gemini (free cloud) -> Local Whisper (free offline)
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
