# Reel-Saver — Full-Cycle AI Instagram Reel Library (Backend + Web + Flutter)

Save Instagram Reels by sharing a link or uploading an **MP4 / MP3** clip, convert video to **16 kHz mono MP3** automatically via FFmpeg, transcribe speech **without paying for OpenAI Whisper or needing a credit card**, generate structured summaries & key points, and organize everything into **editable/renamable categories**.

---

## Architecture & How Key Challenges Are Solved

### 1. Zero-Credit-Card Speech-to-Text (Replacing Paid OpenAI Whisper API)
`backend/services/transcription.service.ts` cascades automatically across **card-free** transcription options (`TRANSCRIPTION_PROVIDER=auto`):
1. **Local Open-Source Whisper (`faster-whisper`) — 100% Free & Offline**
   - Install once: `pip install -r backend/requirements-whisper.txt`
   - Runs locally on CPU (`int8` quantized + VAD filter) or GPU via `backend/scripts/transcribe_local.py`. Supports English, Arabic, and 95+ languages with zero API keys and zero billing.
2. **Groq Cloud Free Tier (`whisper-large-v3-turbo` + `llama-3.3-70b-versatile`)**
   - Free API key from `https://console.groq.com` (no credit card required). Set `GROQ_API_KEY` in `backend/.env`.
3. **Google AI Studio Free Tier (`gemini-2.5-flash`)**
   - Free API key from `https://aistudio.google.com` (no credit card required). Set `GEMINI_API_KEY` in `backend/.env`.
4. **On-Device Voice Transcription (Flutter & Browser)**
   - Built into `flutter_app` (`speech_to_text`) and the Web Companion (`Web Speech API`) at zero cost.

### 2. Safe Architecture Against Meta Shared-IP Blocking & Account Tracking
- **Zero Instagram Login / Zero Cookies:** The app never asks for Instagram credentials or session cookies, so user accounts are never exposed or correlated.
- **Client-Edge Link Preview (`flutter_app/lib/services/client_edge_extractor.dart`):** When a user shares a Reel URL on their phone, the Flutter client resolves public OpenGraph preview tags (`og:title`, `og:description`, `og:image`) directly from the user's own residential network for that single shared link and sends them to `POST /api/reels`. Your backend datacenter IP never makes bulk requests on behalf of all users.
- **Direct MP4 / MP3 Share & Upload:** Users can share an `.mp4` or `.mp3` clip directly from their device (e.g., Instagram's native *Download* button or an external saver web tool such as **Cobalt**) into the Flutter app or Web Companion. FFmpeg converts `.mp4` → `.mp3` + thumbnail locally on your backend with zero requests to Meta.
- **Official Meta Graph `instagram_oembed` + 24h Cache:** When only a URL is sent to the server, `extraction.service.ts` uses Meta's official `instagram_oembed` Graph endpoint (`FACEBOOK_APP_ACCESS_TOKEN`) with shortcode caching, plus an optional `EXTERNAL_MEDIA_RESOLVER_URL` webhook for self-hosted Cobalt-compatible audio resolvers.

---

## Repository Structure

```text
Reel-Saver/
├── backend/                  # Express + TypeScript API, FFmpeg MP4→MP3, Whisper STT, AI Summarizer
│   ├── public/               # Full Web Companion App & PWA Share Target ("Outer Web" UI)
│   ├── scripts/              # Local faster-whisper Python helper & E2E verification suite
│   ├── services/             # media.service, transcription.service, extraction.service, ai.service, reels.service, categories.service
│   └── db/                   # Prisma schema + idempotent Postgres/Supabase SQL migrations
└── flutter_app/              # Flutter Android & iOS mobile app with Share Sheet & category/reel editors
    ├── android/              # Configured with ACTION_SEND for text/plain, video/*, and audio/*
    ├── ios/                  # Info.plist permissions for speech & media library
    └── lib/                  # Screens, Providers, API client, Share Intent & Client-Edge Extractor
```

---

## Quick Start

### 1. Run Backend + Web Companion App
```bash
cd backend
cp .env.example .env
npm install
# Optional: enable 100% offline local Whisper STT
pip install -r requirements-whisper.txt

npm run dev
```
- Open `http://localhost:4000` for the **Web Companion App** (includes a 1-click **Instant Demo Workspace**).
- **No Docker or Redis required:** Works natively on Windows/macOS/Linux with bundled static `ffmpeg`. In default `STORAGE_MODE=auto`, if your Supabase project is paused/offline or tables aren't created yet, the server automatically falls back to local persistent JSON storage (`backend/data/local-db.json`) so login/signup/demo always work.
- **Windows Low-`C:`-Drive Launcher:** Run `backend\start-windows.bat` to pin `npm`, `pip`, temp files, and Whisper model caches onto your repo drive (e.g. `E:\GitHub-Repoz\Reel-Saver\backend\data`) so `C:\` disk space is untouched.
- **Supabase Cloud Setup (Optional):** When your Supabase project is active, paste `backend/db/migrations/00000000000000_init_full_schema.sql` into the Supabase SQL Editor once to initialize `users`, `Category`, and `Reel`.

### 2. Run End-to-End Verification Suite
```bash
cd backend
npm run typecheck
npm run test:e2e
```

### 3. Run Flutter Mobile App
```bash
cd flutter_app
flutter pub get
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:4000
```

---

## Key API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/register` / `/login` / `/refresh` | JWT authentication with refresh rotation |
| `POST` | `/api/reels` | Save Reel via JSON or `multipart/form-data` (`sourceUrl`, `media` MP4/MP3, `caption`, `transcript`, `categoryName`) |
| `GET` | `/api/reels` | List reels (`?categoryId=...&status=...&search=...`) |
| `PATCH` | `/api/reels/:id` | Adjust title, summary, keyPoints, transcript, notes, category, or trigger `resummarize: true` |
| `POST` | `/api/reels/:id/media` | Attach/upload MP4 or MP3 to an existing reel → FFmpeg MP3 → Whisper → Summary |
| `POST` | `/api/reels/:id/resummarize` | Regenerate AI summary & key points from edited transcript |
| `DELETE` | `/api/reels/:id` | Delete reel and cleanup media files |
| `GET` | `/api/categories` | List categories with reel counts + suggested defaults |
| `POST` | `/api/categories` | Create a custom category (English, Arabic, etc.) |
| `PATCH` | `/api/categories/:id` | **Rename a category** across all its reels (merges automatically if target name exists) |
| `DELETE` | `/api/categories/:id` | Delete a category while keeping its reels safely uncategorized |
