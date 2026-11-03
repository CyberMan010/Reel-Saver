# Free Online Hosting Guide (Zero Credit Card Required)

Because `Reel-Saver` runs **FFmpeg**, **`yt-dlp`**, **Whisper speech-to-text**, and an **Express Web UI + API** (not just static HTML), serverless-only hosts like Vercel/Netlify have 10–60s limits and read-only disks that break video/audio conversion.

Below are the **3 best 100%-free options that require NO credit card** — all pre-configured in this repository.

---

## Option 1 (Recommended — Best Specs): Hugging Face Spaces (16 GB RAM · 2 vCPU · $0 · No Card)

Hugging Face Spaces' **CPU Basic** tier gives **16 GB RAM + 2 vCPUs + 50 GB disk** completely free with **no credit card**, so **Local Whisper (`Xenova/whisper-base`) + FFmpeg + `yt-dlp`** run at full speed in the cloud.

### Steps (3 minutes)
1. Create a free account at **[huggingface.co](https://huggingface.co)** (no credit card).
2. Click **+ New** → **Space**:
   - **Space name:** `reel-saver`
   - **Select the Space SDK:** **Docker** → choose **Blank**
   - **Space hardware:** `CPU basic · 2 vCPU · 16 GB · FREE`
   - **Visibility:** **Public** (free Spaces use Public visibility; keep your API keys safe inside **Secrets**!)
3. Go to **Settings → Variables and secrets → New secret** and add:
   - `JWT_SECRET` = *(any long random string)*
   - `JWT_REFRESH_SECRET` = *(any long random string)*
   - `ANTHROPIC_API_KEY` = *(your Claude API key — optional)*
   - `SUPABASE_URL` & `SUPABASE_SECRET_KEY` = *(optional — keeps your saved Reels permanent across container restarts!)*
4. Push this repo to your Space (from `E:\GitHub-Repoz\Reel-Saver`):
   ```bat
   git remote add hf https://huggingface.co/spaces/<YOUR_HF_USERNAME>/reel-saver
   git push hf main
   ```
   *(When prompted for password, paste a Hugging Face **Write Access Token** from `huggingface.co/settings/tokens`.)*
5. Wait ~2 minutes for the root `Dockerfile` to build. Your live public URL will be:
   - **Web App & API:** `https://<your-hf-username>-reel-saver.hf.space`
   - **Flutter App:** `flutter run --dart-define=API_BASE_URL=https://<your-hf-username>-reel-saver.hf.space`

---

## Option 2 (1-Click GitHub Auto-Deploy): Render.com Free Tier ($0 · No Card)

Render connects directly to your GitHub repo (`CyberMan010/Reel-Saver`) using the included `render.yaml` Blueprint.

### Steps (2 minutes)
1. Sign up with GitHub at **[dashboard.render.com](https://dashboard.render.com)** (no credit card required for Free Web Services).
2. Click **New +** → **Blueprint** → select **`CyberMan010/Reel-Saver`**.
3. Render automatically reads `render.yaml` (`plan: free`) and asks for your optional env vars:
   - **Tip for Render's 512 MB RAM limit:** `render.yaml` pre-sets `WHISPER_MODEL_SIZE=tiny` so local Whisper fits in 512 MB RAM. Even better, grab a free **`GROQ_API_KEY`** from **[console.groq.com](https://console.groq.com)** (100% free, no credit card) — Cloud Whisper then uses **0 MB RAM** and transcribes in ~0.5 seconds!
   - Add `SUPABASE_URL` + `SUPABASE_SECRET_KEY` (ensure your free Supabase project is unpaused and `backend/db/migrations/00000000000000_init_full_schema.sql` has been run once) so your Reels persist when Render sleeps after 15 minutes of inactivity.
4. Click **Apply** → your app goes live at **`https://reel-saver.onrender.com`**.

---

## Option 3 (Instant Public Link From Your Windows `E:` Drive — Zero Cloud Limits): Free Cloudflare Quick Tunnel ($0 · No Account · No Card)

If you want your app online right from your own PC (great for Instagram Reels because it uses your home residential IP instead of a shared datacenter IP, and uses **0 bytes on `C:`**):

1. Open `E:\GitHub-Repoz\Reel-Saver\backend`
2. Double-click **`start-online-tunnel.bat`**
3. It automatically downloads `cloudflared.exe` into `E:\GitHub-Repoz\Reel-Saver\backend\data\bin\` (`C:` untouched), starts your backend, and prints a live public HTTPS URL:
   ```text
   https://xxxx-xxxx-xxxx.trycloudflare.com
   ```
   Open that link from any phone or browser anywhere in the world!
