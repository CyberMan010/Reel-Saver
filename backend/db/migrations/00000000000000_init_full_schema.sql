-- Complete, idempotent Supabase / PostgreSQL bootstrap schema for Reel-Saver.
-- Paste this into Supabase Dashboard -> SQL Editor -> Run once when setting up
-- or restoring your Supabase project.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Auth `users` table (used by backend/repositories/user.repositories.ts)
CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'user',
  is_verified boolean NOT NULL DEFAULT false,
  refresh_token text,
  reset_token text,
  reset_token_expires timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. ReelStatus enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ReelStatus') THEN
    CREATE TYPE "ReelStatus" AS ENUM (
      'PENDING',
      'EXTRACTING',
      'TRANSCRIBING',
      'SUMMARIZING',
      'DONE',
      'FAILED'
    );
  ELSE
    ALTER TYPE "ReelStatus" ADD VALUE IF NOT EXISTS 'TRANSCRIBING';
  END IF;
END $$;

-- 3. `Category` table
CREATE TABLE IF NOT EXISTS public."Category" (
  id text PRIMARY KEY,
  name text NOT NULL,
  "userId" uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "Category_userId_name_key" UNIQUE ("userId", name)
);

CREATE INDEX IF NOT EXISTS "Category_userId_idx" ON public."Category" ("userId");

-- 4. `Reel` table
CREATE TABLE IF NOT EXISTS public."Reel" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  "sourceUrl" text NOT NULL,
  title text,
  "authorHandle" text,
  caption text,
  "thumbnailUrl" text,
  transcript text,
  summary text,
  "keyPoints" text[] NOT NULL DEFAULT '{}',
  notes text,
  "audioUrl" text,
  "audioDurationSec" double precision,
  "transcriptionSource" text,
  status "ReelStatus" NOT NULL DEFAULT 'PENDING',
  "errorMessage" text,
  "categoryId" text REFERENCES public."Category"(id) ON DELETE SET NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "processedAt" timestamptz
);

ALTER TABLE public."Reel"
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS "audioUrl" text,
  ADD COLUMN IF NOT EXISTS "audioDurationSec" double precision,
  ADD COLUMN IF NOT EXISTS "transcriptionSource" text;

CREATE INDEX IF NOT EXISTS "Reel_userId_status_idx" ON public."Reel" ("userId", status);
CREATE INDEX IF NOT EXISTS "Reel_userId_categoryId_idx" ON public."Reel" ("userId", "categoryId");
