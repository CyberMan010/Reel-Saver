FROM node:22-bookworm-slim

# Install FFmpeg + Python3 + yt-dlp (with curl-cffi browser TLS impersonation for Instagram Reels)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    ffmpeg \
    python3 \
    python3-pip \
  && pip3 install --break-system-packages --no-cache-dir "yt-dlp[default,curl-cffi]" \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies & compile TypeScript
COPY backend/package*.json ./
RUN npm ci --include=dev || npm install --include=dev

COPY backend/ ./
RUN npm run build && npm prune --omit=dev

# Prepare writable directories for non-root UID 1000 (required by Hugging Face Spaces)
RUN mkdir -p /app/data/whisper-models /app/data/bin /app/uploads/raw /app/uploads/audio /app/uploads/video /app/uploads/thumbs /app/uploads/tmp \
  && chown -R node:node /app

USER node

ENV NODE_ENV=production
ENV HOST=0.0.0.0
# Hugging Face Spaces expects 7860 by default; Render/Railway override PORT automatically
ENV PORT=7860
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV YTDLP_AUTO_DOWNLOAD=false

EXPOSE 7860

CMD ["node", "dist/server.js"]
