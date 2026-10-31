#!/usr/bin/env python3
"""
Local, 100% free Whisper speech-to-text helper for Reel-Saver.
Requires no OpenAI API key and no credit card.

Supports:
  1. faster-whisper (recommended — fast int8 CPU inference + VAD filter)
  2. openai-whisper fallback (if installed instead of faster-whisper)

Usage:
  python3 scripts/transcribe_local.py <audio.mp3> [model_size]
"""

import json
import os
import sys


def transcribe_with_faster_whisper(audio_path: str, model_size: str) -> dict:
    from faster_whisper import WhisperModel  # type: ignore

    device = os.environ.get("WHISPER_DEVICE", "cpu")
    compute_type = os.environ.get(
        "WHISPER_COMPUTE_TYPE", "int8" if device == "cpu" else "float16"
    )
    cache_dir = os.environ.get("WHISPER_CACHE_DIR", None)

    model = WhisperModel(
        model_size,
        device=device,
        compute_type=compute_type,
        download_root=cache_dir,
    )

    segments, info = model.transcribe(
        audio_path,
        beam_size=5,
        vad_filter=True,
    )

    parts = [seg.text.strip() for seg in segments if seg.text and seg.text.strip()]
    transcript = " ".join(parts).strip()

    return {
        "transcript": transcript,
        "language": getattr(info, "language", None),
        "engine": f"faster-whisper ({model_size})",
    }


def transcribe_with_openai_whisper(audio_path: str, model_size: str) -> dict:
    import whisper  # type: ignore

    model = whisper.load_model(model_size)
    result = model.transcribe(audio_path, fp16=False)
    return {
        "transcript": (result.get("text") or "").strip(),
        "language": result.get("language"),
        "engine": f"openai-whisper ({model_size})",
    }


def main() -> int:
    if len(sys.argv) < 2:
        print(
            json.dumps({"error": "Audio file path argument is required."}),
            file=sys.stderr,
        )
        return 1

    audio_path = sys.argv[1]
    model_size = sys.argv[2] if len(sys.argv) > 2 else "base"

    if not os.path.exists(audio_path):
        print(
            json.dumps({"error": f"Audio file not found: {audio_path}"}),
            file=sys.stderr,
        )
        return 1

    try:
        data = transcribe_with_faster_whisper(audio_path, model_size)
        print(json.dumps(data, ensure_ascii=False))
        return 0
    except ImportError:
        pass
    except Exception as exc:
        print(
            json.dumps({"error": f"faster-whisper failed: {exc}"}),
            file=sys.stderr,
        )
        return 1

    try:
        data = transcribe_with_openai_whisper(audio_path, model_size)
        print(json.dumps(data, ensure_ascii=False))
        return 0
    except ImportError:
        print(
            json.dumps(
                {
                    "error": (
                        "Local Whisper is not installed yet. Run "
                        "`pip install -r requirements-whisper.txt` "
                        "or set free GROQ_API_KEY / GEMINI_API_KEY in .env."
                    )
                }
            ),
            file=sys.stderr,
        )
        return 2
    except Exception as exc:
        print(
            json.dumps({"error": f"openai-whisper failed: {exc}"}),
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
