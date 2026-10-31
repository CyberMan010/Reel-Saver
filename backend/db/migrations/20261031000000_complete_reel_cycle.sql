-- Idempotent migration for full Reel-Saver cycle:
-- Adds TRANSCRIBING status, editable title/notes, and extracted MP3 audio metadata.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ReelStatus') THEN
    ALTER TYPE "ReelStatus" ADD VALUE IF NOT EXISTS 'TRANSCRIBING';
  END IF;
END $$;

ALTER TABLE public."Reel"
  ADD COLUMN IF NOT EXISTS "title" text,
  ADD COLUMN IF NOT EXISTS "notes" text,
  ADD COLUMN IF NOT EXISTS "audioUrl" text,
  ADD COLUMN IF NOT EXISTS "audioDurationSec" double precision,
  ADD COLUMN IF NOT EXISTS "transcriptionSource" text;
