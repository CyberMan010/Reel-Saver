-- Ensure Reel.userId references users.id as uuid (run once if column is still text).
-- Safe to run when the column is already uuid — Postgres will no-op the type change.

ALTER TABLE public."Reel"
  ALTER COLUMN "userId" TYPE uuid USING "userId"::uuid;

ALTER TABLE public."Category"
  ALTER COLUMN "userId" TYPE uuid USING "userId"::uuid;
