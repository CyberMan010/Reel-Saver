import assert from "assert";
import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";

// Isolate test storage from dev workspace AND simulate an unreachable/paused
// Supabase URL + unreachable Redis URL in `auto` mode to verify seamless fallback!
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "reel-saver-e2e-"));
process.env.STORAGE_MODE = "auto";
process.env.QUEUE_MODE = "auto";
process.env.SUPABASE_URL = "https://unreachable-paused-project.supabase.co";
process.env.SUPABASE_SECRET_KEY = "sb_secret_simulated_paused_project";
process.env.SUPABASE_TIMEOUT_MS = "1200";
process.env.REDIS_URL = "redis://127.0.0.1:6379";
process.env.LOCAL_DATA_DIR = path.join(tmpRoot, "data");
process.env.UPLOADS_DIR = path.join(tmpRoot, "uploads");
process.env.NODE_ENV = "test";

const execFileAsync = promisify(execFile);

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function run() {
  const { default: app } = await import("../app");
  const { resolveFfmpegPath } = await import("../services/media.service");

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind test server");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  console.log(`[E2E] Server listening at ${baseUrl}`);

  try {
    // 1. Verify system capabilities
    const capRes = await fetch(`${baseUrl}/api/system/capabilities`);
    const capJson = (await capRes.json()) as {
      success: boolean;
      data: { ffmpegAvailable: boolean };
    };
    assert.strictEqual(capJson.success, true);
    assert.strictEqual(
      capJson.data.ffmpegAvailable,
      true,
      "FFmpeg should be available"
    );
    console.log("[E2E] 1/6 System capabilities verified (FFmpeg ready).");

    // 2. Register & Login user (even with unreachable SUPABASE_URL in .env!)
    const testEmail = `tester-${Date.now()}@example.com`;
    const testPassword = "StrongPassword#2026!";
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Test User",
        email: testEmail,
        password: testPassword,
      }),
    });
    assert.strictEqual(regRes.status, 201);

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
      }),
    });
    assert.strictEqual(loginRes.status, 200);
    const loginJson = (await loginRes.json()) as {
      data: { tokens: { accessToken: string } };
    };
    const token = loginJson.data.tokens.accessToken;
    assert.ok(token, "Expected JWT access token from login");
    console.log(
      "[E2E] 2/6 Register + Login verified cleanly with unreachable Supabase auto-fallback."
    );

    // 3. Generate a real 2-second MP4 video (video + audio streams) via FFmpeg
    const ffmpegBin = resolveFfmpegPath();
    assert.ok(ffmpegBin, "FFmpeg path must resolve");
    const sampleMp4Path = path.join(tmpRoot, "sample-reel.mp4");
    await execFileAsync(ffmpegBin, [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=darkslateblue:s=320x568:d=2",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=2",
      "-c:v",
      "mpeg4",
      "-c:a",
      "aac",
      "-shortest",
      sampleMp4Path,
    ]);
    assert.ok(fs.existsSync(sampleMp4Path), "Sample MP4 must exist");

    // 4. Upload MP4 + Reel URL via multipart POST /api/reels
    const form = new FormData();
    form.append("sourceUrl", "https://www.instagram.com/reel/C9TestRecipe99/");
    form.append("authorHandle", "@amman.kitchen");
    form.append(
      "caption",
      "Crispy Garlic Butter Salmon in 12 minutes! Sear skin-side down for 5 minutes, flip and baste with butter, garlic, and lemon."
    );
    const mp4Buffer = fs.readFileSync(sampleMp4Path);
    form.append(
      "media",
      new Blob([mp4Buffer], { type: "video/mp4" }),
      "sample-reel.mp4"
    );

    const createRes = await fetch(`${baseUrl}/api/reels`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    assert.strictEqual(createRes.status, 202);
    const createJson = (await createRes.json()) as {
      data: { reel: { id: string } };
    };
    const reelId = createJson.data.reel.id;

    // Poll until background worker reaches DONE
    let processedReel: Record<string, unknown> | null = null;
    for (let attempt = 0; attempt < 25; attempt++) {
      await sleep(300);
      const pollRes = await fetch(`${baseUrl}/api/reels/${reelId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const pollJson = (await pollRes.json()) as {
        data: { reel: Record<string, unknown> };
      };
      if (pollJson.data.reel.status === "DONE") {
        processedReel = pollJson.data.reel;
        break;
      }
      if (pollJson.data.reel.status === "FAILED") {
        throw new Error(
          `Reel failed unexpectedly: ${pollJson.data.reel.errorMessage}`
        );
      }
    }

    assert.ok(processedReel, "Reel should finish processing to DONE");
    assert.ok(
      String(processedReel.audioUrl).endsWith(".mp3"),
      "MP4 must be converted to MP3"
    );
    assert.ok(
      String(processedReel.thumbnailUrl).endsWith(".jpg"),
      "MP4 cover frame thumbnail should be extracted"
    );
    assert.ok(
      typeof processedReel.summary === "string" &&
        processedReel.summary.length > 10,
      "Summary must be generated"
    );
    const assignedCat = processedReel.category as { id: string; name: string };
    assert.strictEqual(assignedCat.name, "Recipes");

    // Verify converted MP3 file is downloadable via HTTP
    const mp3Res = await fetch(`${baseUrl}${processedReel.audioUrl}`);
    assert.strictEqual(mp3Res.status, 200);
    console.log(
      "[E2E] 3/6 MP4 -> MP3 conversion, thumbnail extraction, summarization & auto-categorization verified."
    );

    // 5. Rename category (supports Arabic + English) and verify reel reflects new name
    const renameRes = await fetch(
      `${baseUrl}/api/categories/${encodeURIComponent(assignedCat.id)}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "وصفات سريعة / Quick Dinner" }),
      }
    );
    assert.strictEqual(renameRes.status, 200);

    const afterRenameRes = await fetch(`${baseUrl}/api/reels/${reelId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const afterRenameJson = (await afterRenameRes.json()) as {
      data: { reel: { category: { name: string } } };
    };
    assert.strictEqual(
      afterRenameJson.data.reel.category.name,
      "وصفات سريعة / Quick Dinner"
    );
    console.log("[E2E] 4/6 Category renaming (Arabic + English) verified.");

    // 6. Adjust reel fields (title, summary, keyPoints, notes, transcript) & search
    const patchRes = await fetch(`${baseUrl}/api/reels/${reelId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "12-Min Crispy Garlic Salmon",
        notes: "Serve with roasted asparagus",
        keyPoints: [
          "Pat salmon dry and season generously",
          "Sear skin-side down 5 min on medium-high",
          "Baste with garlic, butter, and lemon juice",
        ],
      }),
    });
    assert.strictEqual(patchRes.status, 200);
    const patchJson = (await patchRes.json()) as {
      data: { reel: { title: string; notes: string; keyPoints: string[] } };
    };
    assert.strictEqual(patchJson.data.reel.title, "12-Min Crispy Garlic Salmon");
    assert.strictEqual(
      patchJson.data.reel.notes,
      "Serve with roasted asparagus"
    );
    assert.strictEqual(patchJson.data.reel.keyPoints.length, 3);
    console.log("[E2E] 5/6 Full reel editing & user adjustments verified.");

    const searchRes = await fetch(
      `${baseUrl}/api/reels?search=asparagus`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const searchJson = (await searchRes.json()) as {
      data: { total: number };
    };
    assert.strictEqual(searchJson.data.total, 1);

    const delRes = await fetch(`${baseUrl}/api/reels/${reelId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.strictEqual(delRes.status, 200);
    console.log("[E2E] 6/6 Search & reel deletion verified. ALL TESTS PASSED!");
  } finally {
    server.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error("[E2E] FAILED:", err);
  process.exit(1);
});
