(() => {
  const STORAGE_KEYS = {
    accessToken: "rs_access_token",
    refreshToken: "rs_refresh_token",
    user: "rs_user",
  };

  let authMode = "login";
  let currentCategoryId = "";
  let categoriesCache = [];
  let suggestedCategories = [];
  let reelsCache = [];
  let selectedMediaFile = null;
  let pollInterval = null;
  let speechRecognizer = null;
  let isDictating = false;
  let mediaRecorder = null;
  let recordedChunks = [];

  const $ = (id) => document.getElementById(id);

  function showToast(msg) {
    const el = $("toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.add("hidden"), 3400);
  }

  function getTokens() {
    return {
      accessToken: localStorage.getItem(STORAGE_KEYS.accessToken) || "",
      refreshToken: localStorage.getItem(STORAGE_KEYS.refreshToken) || "",
    };
  }

  function saveSession(user, tokens) {
    if (user) localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(user));
    if (tokens?.accessToken) {
      localStorage.setItem(STORAGE_KEYS.accessToken, tokens.accessToken);
    }
    if (tokens?.refreshToken) {
      localStorage.setItem(STORAGE_KEYS.refreshToken, tokens.refreshToken);
    }
  }

  function clearSession() {
    localStorage.removeItem(STORAGE_KEYS.accessToken);
    localStorage.removeItem(STORAGE_KEYS.refreshToken);
    localStorage.removeItem(STORAGE_KEYS.user);
  }

  async function apiFetch(path, options = {}, retried = false) {
    const { accessToken, refreshToken } = getTokens();
    const headers = { ...(options.headers || {}) };
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }
    if (!(options.body instanceof FormData) && options.body && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }

    const res = await fetch(path, { ...options, headers });

    if (res.status === 401 && refreshToken && !retried && !path.includes("/api/auth/")) {
      const refreshRes = await fetch("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (refreshRes.ok) {
        const refreshData = await refreshRes.json();
        saveSession(null, refreshData.data?.tokens);
        return apiFetch(path, options, true);
      } else {
        clearSession();
        renderViewState();
        throw new Error("Session expired. Please sign in again.");
      }
    }

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail =
        json.errors?.map((e) => e.message).join(" ") ||
        json.message ||
        `Request failed (${res.status})`;
      throw new Error(detail);
    }
    return json;
  }

  // ─── Auth & Demo Seeding ──────────────────────────────────────────────────
  function setAuthTab(mode) {
    authMode = mode;
    $("tabLogin").classList.toggle("active", mode === "login");
    $("tabRegister").classList.toggle("active", mode === "register");
    $("nameFieldWrap").classList.toggle("hidden", mode === "login");
    $("authSubmitBtn").textContent =
      mode === "login" ? "Sign In" : "Create Account";
  }

  $("tabLogin").addEventListener("click", () => setAuthTab("login"));
  $("tabRegister").addEventListener("click", () => setAuthTab("register"));

  $("authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("authSubmitBtn");
    btn.disabled = true;
    try {
      const email = $("authEmail").value.trim();
      const password = $("authPassword").value;
      const endpoint =
        authMode === "login" ? "/api/auth/login" : "/api/auth/register";
      const payload =
        authMode === "login"
          ? { email, password }
          : { name: $("authName").value.trim() || "Reel Saver User", email, password };

      const res = await apiFetch(endpoint, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      saveSession(res.data.user, res.data.tokens);
      showToast(res.message || "Welcome!");
      await enterDashboard();
    } catch (err) {
      showToast(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  $("quickDemoBtn").addEventListener("click", async () => {
    const btn = $("quickDemoBtn");
    btn.disabled = true;
    btn.textContent = "Preparing Demo Workspace...";
    try {
      const demoEmail = "demo@reelsaver.app";
      const demoPassword = "DemoUser#2026!";
      let authRes;
      try {
        authRes = await apiFetch("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ email: demoEmail, password: demoPassword }),
        });
      } catch {
        authRes = await apiFetch("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({
            name: "Amman Demo Creator",
            email: demoEmail,
            password: demoPassword,
          }),
        });
      }
      saveSession(authRes.data.user, authRes.data.tokens);

      // Seed starter reels if library is empty
      const existing = await apiFetch("/api/reels");
      if ((existing.data?.reels || []).length === 0) {
        const samples = [
          {
            sourceUrl: "https://www.instagram.com/reel/C9GarlicChicken01/",
            authorHandle: "chef.kareem",
            caption: "15-minute Honey Garlic Crispy Chicken Bowl! High protein meal prep.",
            transcript:
              "Start with 500 grams of diced chicken breast seasoned with salt, black pepper, paprika, and a tablespoon of cornstarch so it gets super crispy. Sear on high heat for 5 minutes. Lower the heat and add 3 minced garlic cloves, two tablespoons of soy sauce, one tablespoon of honey, and a squeeze of lemon juice. Toss until glossy and serve over jasmine rice — 46 grams of protein per bowl.",
          },
          {
            sourceUrl: "https://www.instagram.com/reel/C9FlutterShare02/",
            authorHandle: "dev.tariq",
            caption: "How to handle Android & iOS Share Sheet intents cleanly in Flutter without blocking the UI thread.",
            transcript:
              "When building a Flutter app that receives shared links or MP4 videos from Instagram, register ACTION_SEND in your AndroidManifest for both text/plain and video/* MIME types. Extract public OpenGraph preview tags directly on the user's phone first so your backend IP never gets rate-limited, then upload the audio clip to your queue worker for background Whisper transcription.",
          },
          {
            sourceUrl: "https://www.instagram.com/reel/C9MobilityFlow03/",
            authorHandle: "coach.layla",
            caption: "5-minute daily hip & thoracic mobility routine if you sit at a desk all day.",
            transcript:
              "If your lower back feels tight after coding all day, do these three moves every evening: 90-90 hip switches for 10 slow reps, world's greatest lunge stretch with thoracic rotation for 6 reps per side, and deep squat pry holds for 45 seconds.",
          },
        ];

        for (const item of samples) {
          await apiFetch("/api/reels", {
            method: "POST",
            body: JSON.stringify(item),
          });
        }
      }

      showToast("Demo workspace ready!");
      await enterDashboard();
    } catch (err) {
      showToast(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "Launch Instant Demo Workspace (With Sample Reels)";
    }
  });

  $("logoutBtn").addEventListener("click", async () => {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Ignore logout network error
    }
    clearSession();
    renderViewState();
  });

  // ─── Dashboard Loading & Polling ──────────────────────────────────────────
  function renderViewState() {
    const { accessToken } = getTokens();
    const loggedIn = Boolean(accessToken);
    $("authView").classList.toggle("hidden", loggedIn);
    $("appView").classList.toggle("hidden", !loggedIn);
    if (!loggedIn && pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }

  async function loadSystemCapabilities() {
    try {
      const res = await apiFetch("/api/system/capabilities");
      const d = res.data;
      const sttLabel = d.transcription.groqWhisperConfigured
        ? "Groq Free Whisper"
        : d.transcription.geminiAudioConfigured
        ? "Gemini Free Audio"
        : d.transcription.nodeWhisperAvailable
        ? "Built-In Node Whisper"
        : d.transcription.localWhisperInstalled
        ? "Local Faster-Whisper"
        : "Browser STT + Local Analyzer";
      const dbLabel =
        d.storageMode === "supabase" ? "Supabase Cloud" : "Local Disk DB";
      $("sysStatusTitle").textContent = d.ffmpegAvailable
        ? `● FFmpeg Ready · ${dbLabel}`
        : `● Pipeline Active · ${dbLabel}`;
      $("sysStatusDetails").textContent = `STT: ${sttLabel} · No Docker Needed`;
    } catch {
      $("sysStatusDetails").textContent = "Connected to Reel-Saver API";
    }
  }

  async function loadCategories() {
    const res = await apiFetch("/api/categories");
    categoriesCache = res.data?.categories || [];
    suggestedCategories = res.data?.suggestedDefaults || [];
    renderCategories();
    renderCategorySuggestions();
  }

  function renderCategorySuggestions() {
    const datalist = $("categorySuggestions");
    const names = new Set([
      ...categoriesCache.map((c) => c.name),
      ...suggestedCategories,
    ]);
    datalist.innerHTML = [...names]
      .map((name) => `<option value="${escapeHtml(name)}"></option>`)
      .join("");
  }

  function renderCategories() {
    const container = $("categoryList");
    const totalCount = reelsCache.length;

    let html = `
      <div class="category-item ${currentCategoryId === "" ? "active" : ""}" data-cat-id="">
        <div class="category-item-left">
          <span>📚 All Saved Reels</span>
        </div>
        <span class="cat-count">${totalCount}</span>
      </div>
    `;

    for (const cat of categoriesCache) {
      const active = currentCategoryId === cat.id ? "active" : "";
      html += `
        <div class="category-item ${active}" data-cat-id="${escapeAttr(cat.id)}" data-cat-name="${escapeAttr(cat.name)}">
          <div class="category-item-left" title="${escapeAttr(cat.name)}">
            <span>📁 ${escapeHtml(cat.name)}</span>
          </div>
          <div class="category-actions">
            <span class="cat-count">${cat.reelCount ?? 0}</span>
            <button class="icon-btn rename-cat-btn" data-id="${escapeAttr(cat.id)}" data-name="${escapeAttr(cat.name)}" title="Rename category" type="button">✎</button>
            <button class="icon-btn delete-cat-btn" data-id="${escapeAttr(cat.id)}" data-name="${escapeAttr(cat.name)}" title="Delete category" type="button">🗑</button>
          </div>
        </div>
      `;
    }

    container.innerHTML = html;

    container.querySelectorAll(".category-item").forEach((el) => {
      el.addEventListener("click", (e) => {
        if (e.target.closest(".rename-cat-btn") || e.target.closest(".delete-cat-btn")) {
          return;
        }
        currentCategoryId = el.getAttribute("data-cat-id") || "";
        const catName = el.getAttribute("data-cat-name");
        $("currentViewTitle").textContent = catName ? `📁 ${catName}` : "All Saved Reels";
        renderCategories();
        loadReels();
      });
    });

    container.querySelectorAll(".rename-cat-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const id = btn.getAttribute("data-id");
        const oldName = btn.getAttribute("data-name") || "";
        const nextName = window.prompt("Rename category:", oldName);
        if (!nextName || nextName.trim() === oldName) return;
        try {
          await apiFetch(`/api/categories/${encodeURIComponent(id)}`, {
            method: "PATCH",
            body: JSON.stringify({ name: nextName.trim() }),
          });
          showToast(`Category renamed to "${nextName.trim()}"`);
          await Promise.all([loadCategories(), loadReels()]);
          if (currentCategoryId === id) {
            $("currentViewTitle").textContent = `📁 ${nextName.trim()}`;
          }
        } catch (err) {
          showToast(err.message);
        }
      });
    });

    container.querySelectorAll(".delete-cat-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const id = btn.getAttribute("data-id");
        const name = btn.getAttribute("data-name") || "";
        if (!window.confirm(`Delete category "${name}"? Reels inside will be kept as Uncategorized.`)) {
          return;
        }
        try {
          await apiFetch(`/api/categories/${encodeURIComponent(id)}`, {
            method: "DELETE",
          });
          if (currentCategoryId === id) {
            currentCategoryId = "";
            $("currentViewTitle").textContent = "All Saved Reels";
          }
          showToast(`Deleted category "${name}"`);
          await Promise.all([loadCategories(), loadReels()]);
        } catch (err) {
          showToast(err.message);
        }
      });
    });
  }

  $("newCategoryBtn").addEventListener("click", async () => {
    const name = window.prompt("New category name (English or Arabic):");
    if (!name || !name.trim()) return;
    try {
      await apiFetch("/api/categories", {
        method: "POST",
        body: JSON.stringify({ name: name.trim() }),
      });
      showToast(`Created category "${name.trim()}"`);
      await loadCategories();
    } catch (err) {
      showToast(err.message);
    }
  });

  async function loadReels() {
    const params = new URLSearchParams();
    if (currentCategoryId) params.set("categoryId", currentCategoryId);
    const status = $("statusFilter").value;
    if (status) params.set("status", status);
    const search = $("searchInput").value.trim();
    if (search) params.set("search", search);

    const res = await apiFetch(`/api/reels?${params.toString()}`);
    reelsCache = res.data?.reels || [];
    renderReels();

    const anyProcessing = reelsCache.some((r) =>
      ["PENDING", "EXTRACTING", "TRANSCRIBING", "SUMMARIZING"].includes(r.status)
    );
    if (anyProcessing && !pollInterval) {
      pollInterval = setInterval(async () => {
        await Promise.all([loadReels(), loadCategories()]);
      }, 2000);
    } else if (!anyProcessing && pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }

  function statusBadgeClass(status) {
    if (status === "DONE") return "badge-done";
    if (status === "FAILED") return "badge-failed";
    if (status === "AWAITING_CONFIRMATION") return "badge-awaiting";
    return "badge-processing";
  }

  function statusDisplayLabel(status) {
    if (status === "AWAITING_CONFIRMATION") return "ASKING CONFIRMATION";
    return status;
  }

  // ─── Pre-Conversion Confirmation Modal ("Asks before converting & transcribing") ──
  let confirmModalResolver = null;

  function updateFormatSelectionUI() {
    const selectedRadio = document.querySelector(
      'input[name="convertFormatChoice"]:checked'
    );
    const val = selectedRadio ? selectedRadio.value : "mp3";
    document.querySelectorAll(".format-option-card").forEach((card) => {
      card.classList.toggle(
        "selected",
        card.getAttribute("data-format") === val
      );
    });
    $("confirmConvertYesBtn").textContent =
      val === "mp4"
        ? "✅ Yes, Save MP4 + MP3 & Transcribe"
        : "✅ Yes, Convert to MP3 & Transcribe";
  }

  document
    .querySelectorAll('input[name="convertFormatChoice"]')
    .forEach((radio) => {
      radio.addEventListener("change", updateFormatSelectionUI);
    });

  function resolveConfirmModal(choice) {
    $("confirmConvertModal").classList.add("hidden");
    const r = confirmModalResolver;
    confirmModalResolver = null;
    if (r) r(choice);
  }

  $("closeConfirmConvertBtn").addEventListener("click", () =>
    resolveConfirmModal(null)
  );
  $("confirmConvertCancelBtn").addEventListener("click", () =>
    resolveConfirmModal(null)
  );
  $("confirmConvertSkipBtn").addEventListener("click", () =>
    resolveConfirmModal("skip")
  );
  $("confirmConvertYesBtn").addEventListener("click", () => {
    const selectedRadio = document.querySelector(
      'input[name="convertFormatChoice"]:checked'
    );
    resolveConfirmModal(selectedRadio ? selectedRadio.value : "mp3");
  });

  function askBeforeConvertingModal({ urlLabel = "", showSkipOption = true }) {
    $("confirmConvertUrlPreview").textContent = urlLabel ? `Reel: ${urlLabel}` : "";
    $("confirmConvertSkipBtn").classList.toggle("hidden", !showSkipOption);
    const mp3Radio = document.querySelector(
      'input[name="convertFormatChoice"][value="mp3"]'
    );
    if (mp3Radio) mp3Radio.checked = true;
    updateFormatSelectionUI();
    $("confirmConvertModal").classList.remove("hidden");
    return new Promise((resolve) => {
      confirmModalResolver = resolve;
    });
  }

  async function promptAndTriggerReelConversion(reel) {
    const choice = await askBeforeConvertingModal({
      urlLabel: reel.sourceUrl || "",
      showSkipOption: reel.status === "AWAITING_CONFIRMATION",
    });
    if (!choice) return;

    try {
      await apiFetch(`/api/reels/${encodeURIComponent(reel.id)}/confirm-convert`, {
        method: "POST",
        body: JSON.stringify({ mediaFormat: choice }),
      });
      showToast(
        choice === "skip"
          ? "Extracting Reel caption & summarizing..."
          : `Auto-converting Reel to ${choice.toUpperCase()} & transcribing voice to text...`
      );
      closeDetailModal();
      await loadReels();
    } catch (err) {
      showToast(err.message);
    }
  }

  function renderReels() {
    const container = $("reelsContainer");
    if (reelsCache.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <h3 style="margin-bottom:8px;">No Reels in this view yet</h3>
          <p style="color:var(--text-muted);font-size:14px;margin-bottom:16px;">
            Share an Instagram Reel link or upload an MP4 / MP3 clip to convert, transcribe, summarize, and categorize it.
          </p>
          <button class="btn btn-primary" type="button" id="emptyAddBtn">+ Share Link or MP4 / MP3</button>
        </div>
      `;
      const emptyBtn = $("emptyAddBtn");
      if (emptyBtn) emptyBtn.addEventListener("click", openAddModal);
      return;
    }

    container.innerHTML = reelsCache
      .map((reel) => {
        const title =
          reel.title ||
          (reel.authorHandle
            ? `Reel by @${reel.authorHandle}`
            : reel.status === "AWAITING_CONFIRMATION"
            ? "Ready to Convert & Transcribe"
            : "Processing Reel...");
        const catName = reel.category?.name || "Uncategorized";
        const processingHint =
          reel.status === "AWAITING_CONFIRMATION"
            ? "Waiting for your confirmation to auto-convert to MP3/MP4 and transcribe voice to text."
            : reel.status === "TRANSCRIBING"
            ? "Transcribing spoken voice with Local Whisper AI (first run downloads ~140MB model to data/whisper-models)..."
            : reel.status === "EXTRACTING"
            ? "Auto-downloading Reel stream & converting to 16kHz MP3 via yt-dlp + FFmpeg..."
            : reel.status === "SUMMARIZING"
            ? "Generating AI summary, key points & category..."
            : "Queued for processing...";
        const summary =
          reel.summary ||
          (reel.status === "FAILED"
            ? reel.errorMessage || "Processing failed."
            : processingHint);
        const points = (reel.keyPoints || []).slice(0, 3);
        const audioTag = reel.videoUrl
          ? `<span>🎬 MP4 + 🎵 MP3${reel.audioDurationSec ? ` (${reel.audioDurationSec}s)` : ""}</span>`
          : reel.audioUrl
          ? `<span>🎵 MP3 (${reel.audioDurationSec ? `${reel.audioDurationSec}s` : "ready"})</span>`
          : `<span>${reel.authorHandle ? `@${escapeHtml(reel.authorHandle)}` : "Saved Reel"}</span>`;

        const needsVoiceConversion =
          reel.status === "AWAITING_CONFIRMATION" ||
          (reel.sourceUrl &&
            reel.sourceUrl.startsWith("http") &&
            (!reel.audioUrl || reel.transcriptionSource === "none") &&
            !["PENDING", "EXTRACTING", "TRANSCRIBING", "SUMMARIZING"].includes(
              reel.status
            ));

        return `
          <article class="reel-card" data-reel-id="${escapeAttr(reel.id)}">
            <div class="reel-card-top">
              <span class="badge badge-cat">📁 ${escapeHtml(catName)}</span>
              <span class="badge ${statusBadgeClass(reel.status)}">${escapeHtml(
          statusDisplayLabel(reel.status)
        )}</span>
            </div>
            <div class="reel-title">${escapeHtml(title)}</div>
            <div class="reel-summary">${escapeHtml(summary)}</div>
            ${
              points.length > 0
                ? `<ul class="reel-keypoints-preview">${points
                    .map((p) => `<li>${escapeHtml(p)}</li>`)
                    .join("")}</ul>`
                : ""
            }
            ${
              needsVoiceConversion
                ? `<div class="card-convert-cta">
                    <span style="font-size:12px;color:var(--text-muted);">No voice transcript yet</span>
                    <button type="button" class="btn btn-primary btn-sm quick-convert-btn" data-convert-id="${escapeAttr(
                      reel.id
                    )}">🎙 Auto-Convert &amp; Transcribe</button>
                  </div>`
                : ""
            }
            <div class="reel-meta-footer">
              ${audioTag}
              <span>Adjust &amp; View →</span>
            </div>
          </article>
        `;
      })
      .join("");

    container.querySelectorAll(".quick-convert-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.getAttribute("data-convert-id");
        const reel = reelsCache.find((r) => r.id === id);
        if (reel) void promptAndTriggerReelConversion(reel);
      });
    });

    container.querySelectorAll(".reel-card").forEach((card) => {
      card.addEventListener("click", () => {
        const id = card.getAttribute("data-reel-id");
        const reel = reelsCache.find((r) => r.id === id);
        if (reel) openDetailModal(reel);
      });
    });
  }

  $("searchInput").addEventListener("input", () => {
    clearTimeout($("searchInput")._t);
    $("searchInput")._t = setTimeout(loadReels, 250);
  });
  $("statusFilter").addEventListener("change", loadReels);

  // ─── Add / Share Reel Modal + MP4/MP3 Dropzone + Test WAV Synth ───────────
  function openAddModal() {
    $("addReelModal").classList.remove("hidden");
  }

  function closeAddModal() {
    $("addReelModal").classList.add("hidden");
    $("addReelForm").reset();
    selectedMediaFile = null;
    $("dropzoneText").innerHTML =
      "Click or drag &amp; drop an <strong>MP4</strong> or <strong>MP3</strong> here — FFmpeg converts MP4 → 16kHz MP3 automatically";
  }

  $("openAddModalBtn").addEventListener("click", openAddModal);
  $("closeAddModalBtn").addEventListener("click", closeAddModal);
  $("cancelAddBtn").addEventListener("click", closeAddModal);

  const dropzone = $("mediaDropzone");
  const fileInput = $("reelMediaFile");

  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setChosenMediaFile(e.dataTransfer.files[0]);
    }
  });
  fileInput.addEventListener("change", () => {
    if (fileInput.files && fileInput.files[0]) {
      setChosenMediaFile(fileInput.files[0]);
    }
  });

  function setChosenMediaFile(file) {
    selectedMediaFile = file;
    const kb = Math.round(file.size / 1024);
    $("dropzoneText").innerHTML = `✅ Selected: <strong>${escapeHtml(file.name)}</strong> (${kb} KB) — ready for FFmpeg MP3 conversion`;
  }

  // Synthesize a valid 3-second PCM WAV clip so users can test FFmpeg -> MP3 conversion in 1 click!
  $("generateSampleAudioBtn").addEventListener("click", () => {
    const sampleRate = 16000;
    const seconds = 3;
    const numSamples = sampleRate * seconds;
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);
    const writeStr = (offset, str) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + numSamples * 2, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, numSamples * 2, true);

    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const env = Math.min(1, t * 4) * Math.max(0, 1 - (t - 2.2));
      const sample = Math.sin(2 * Math.PI * 440 * t) * 0.25 * env;
      view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample)) * 32767, true);
    }

    const wavFile = new File([buffer], "sample-reel-clip.wav", {
      type: "audio/wav",
    });
    setChosenMediaFile(wavFile);
    if (!$("reelCaption").value.trim()) {
      $("reelCaption").value =
        "Quick 3-step Pomodoro deep work system: silence phone notifications in another room, run four 25-minute coding sprints, and review your top 3 priorities before opening email.";
    }
    if (!$("reelAuthor").value.trim()) {
      $("reelAuthor").value = "@focus.builder";
    }
    showToast("Generated 3s test clip + caption! Click 'Process & Summarize Reel' to test FFmpeg → MP3.");
  });

  // Record real microphone / speaker audio as WebM -> converted to MP3 by FFmpeg -> transcribed by built-in Node Whisper!
  $("recordAudioBtn").addEventListener("click", async () => {
    const btn = $("recordAudioBtn");
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showToast("Microphone recording requires HTTPS or localhost in a modern browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordedChunks = [];
      mediaRecorder = new MediaRecorder(stream);

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recordedChunks.push(e.data);
      };

      mediaRecorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recordedChunks, { type: "audio/webm" });
        const file = new File([blob], `recorded-reel-${Date.now()}.webm`, {
          type: "audio/webm",
        });
        setChosenMediaFile(file);
        btn.textContent = "🔴 Record Voice / Reel Audio (→ Local Whisper)";
        showToast("Audio recorded! Click 'Process & Summarize Reel' to transcribe with Local Whisper.");
      };

      mediaRecorder.start();
      btn.textContent = "⏹ Stop Recording";
      showToast("Recording... speak or play the Reel near your microphone.");
    } catch (err) {
      showToast(`Mic access denied: ${err.message || err}`);
    }
  });

  // Free Browser Speech Recognition (Zero card, zero cost!)
  $("dictateSpeechBtn").addEventListener("click", () => {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      showToast("Browser speech recognition is available in Chrome / Edge / Safari.");
      return;
    }

    if (isDictating && speechRecognizer) {
      speechRecognizer.stop();
      return;
    }

    speechRecognizer = new SpeechRec();
    speechRecognizer.continuous = true;
    speechRecognizer.interimResults = false;
    speechRecognizer.onstart = () => {
      isDictating = true;
      $("dictateSpeechBtn").textContent = "⏹ Stop Dictating";
      showToast("Listening... play the Reel or speak near your mic.");
    };
    speechRecognizer.onresult = (event) => {
      let chunk = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          chunk += event.results[i][0].transcript + " ";
        }
      }
      const box = $("reelTranscriptInput");
      box.value = (box.value + " " + chunk).trim();
    };
    speechRecognizer.onend = () => {
      isDictating = false;
      $("dictateSpeechBtn").textContent = "🎙 Free Browser Voice Dictation";
    };
    speechRecognizer.start();
  });

  $("addReelForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const sourceUrl = $("reelSourceUrl").value.trim();
    const authorHandle = $("reelAuthor").value.trim();
    const categoryName = $("reelCategoryInput").value.trim();
    const caption = $("reelCaption").value.trim();
    const transcript = $("reelTranscriptInput").value.trim();

    if (!sourceUrl && !selectedMediaFile) {
      showToast("Paste an Instagram Reel URL or choose an MP4/MP3 file.");
      return;
    }

    // Ask the user BEFORE auto-downloading/converting a Reel URL into MP3/MP4 & transcribing!
    let mediaFormat = "mp3";
    if (sourceUrl && !selectedMediaFile && !transcript) {
      const choice = await askBeforeConvertingModal({
        urlLabel: sourceUrl,
        showSkipOption: true,
      });
      if (!choice) {
        return; // User cancelled
      }
      mediaFormat = choice;
    }

    const btn = $("submitAddReelBtn");
    btn.disabled = true;
    try {
      const form = new FormData();
      if (sourceUrl) form.append("sourceUrl", sourceUrl);
      if (authorHandle) form.append("authorHandle", authorHandle);
      if (categoryName) form.append("categoryName", categoryName);
      if (caption) form.append("caption", caption);
      if (transcript) form.append("transcript", transcript);
      form.append("mediaFormat", mediaFormat);
      if (selectedMediaFile) form.append("media", selectedMediaFile);

      await apiFetch("/api/reels", {
        method: "POST",
        body: form,
      });

      closeAddModal();
      showToast(
        mediaFormat === "skip"
          ? "Reel saved! Extracting caption & summarizing..."
          : `Auto-converting Reel to ${mediaFormat.toUpperCase()} & transcribing voice to text...`
      );
      await Promise.all([loadReels(), loadCategories()]);
    } catch (err) {
      showToast(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  // ─── Detail & Full Adjustment Modal ───────────────────────────────────────
  function openDetailModal(reel) {
    $("editReelId").value = reel.id;
    const badge = $("detailStatusBadge");
    badge.textContent = statusDisplayLabel(reel.status);
    badge.className = `badge ${statusBadgeClass(reel.status)}`;

    $("detailSourceBadge").textContent = reel.transcriptionSource
      ? `Transcript source: ${reel.transcriptionSource}`
      : "";

    const videoBox = $("detailVideoBox");
    const videoPlayer = $("detailVideoPlayer");
    if (reel.videoUrl) {
      videoBox.classList.remove("hidden");
      videoPlayer.src = reel.videoUrl;
    } else {
      videoBox.classList.add("hidden");
      videoPlayer.removeAttribute("src");
    }

    const audioBox = $("detailAudioBox");
    const audioPlayer = $("detailAudioPlayer");
    if (reel.audioUrl) {
      audioBox.classList.remove("hidden");
      $("detailAudioLabel").textContent = `Extracted MP3 Audio${
        reel.audioDurationSec ? ` (${reel.audioDurationSec}s)` : ""
      }`;
      audioPlayer.src = reel.audioUrl;
    } else {
      audioBox.classList.add("hidden");
      audioPlayer.removeAttribute("src");
    }

    $("editTitle").value = reel.title || "";
    $("editCategoryName").value = reel.category?.name || "";
    $("editAuthor").value = reel.authorHandle ? `@${reel.authorHandle}` : "";
    $("editSummary").value = reel.summary || "";
    $("editKeyPoints").value = (reel.keyPoints || []).join("\n");
    $("editTranscript").value = reel.transcript || "";
    $("editNotes").value = reel.notes || "";

    const linkBtn = $("openOriginalUrlBtn");
    if (reel.sourceUrl && reel.sourceUrl.startsWith("http")) {
      linkBtn.href = reel.sourceUrl;
      linkBtn.classList.remove("hidden");
    } else {
      linkBtn.classList.add("hidden");
    }

    $("detailModal").classList.remove("hidden");
  }

  function closeDetailModal() {
    $("detailAudioPlayer").pause();
    $("detailVideoPlayer").pause();
    $("detailModal").classList.add("hidden");
  }

  $("closeDetailBtn").addEventListener("click", closeDetailModal);

  $("editReelForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = $("editReelId").value;
    const btn = $("saveEditsBtn");
    btn.disabled = true;
    try {
      const keyPoints = $("editKeyPoints")
        .value.split("\n")
        .map((line) => line.replace(/^[-•*]\s*/, "").trim())
        .filter(Boolean);

      const payload = {
        title: $("editTitle").value.trim(),
        categoryName: $("editCategoryName").value.trim(),
        authorHandle: $("editAuthor").value.trim(),
        summary: $("editSummary").value.trim(),
        keyPoints,
        transcript: $("editTranscript").value.trim(),
        notes: $("editNotes").value.trim(),
      };

      await apiFetch(`/api/reels/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });

      showToast("All adjustments saved!");
      closeDetailModal();
      await Promise.all([loadCategories(), loadReels()]);
    } catch (err) {
      showToast(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  $("resummarizeBtn").addEventListener("click", async () => {
    const id = $("editReelId").value;
    const btn = $("resummarizeBtn");
    btn.disabled = true;
    try {
      // Save any transcript edits first, then trigger resummarize
      const res = await apiFetch(`/api/reels/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          transcript: $("editTranscript").value.trim(),
          resummarize: true,
        }),
      });
      openDetailModal(res.data.reel);
      showToast("AI summary & key points regenerated from transcript!");
      await Promise.all([loadCategories(), loadReels()]);
    } catch (err) {
      showToast(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  $("attachMediaInput").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const id = $("editReelId").value;
    try {
      const form = new FormData();
      form.append("media", file);
      await apiFetch(`/api/reels/${encodeURIComponent(id)}/media`, {
        method: "POST",
        body: form,
      });
      showToast("Media uploaded! Converting MP4 → MP3 & re-transcribing...");
      closeDetailModal();
      await loadReels();
    } catch (err) {
      showToast(err.message);
    } finally {
      e.target.value = "";
    }
  });

  $("retryExtractionBtn").addEventListener("click", async () => {
    const id = $("editReelId").value;
    const reel = reelsCache.find((r) => r.id === id) || {
      id,
      sourceUrl: $("openOriginalUrlBtn").getAttribute("href") || "",
      status: "DONE",
    };
    await promptAndTriggerReelConversion(reel);
  });

  $("deleteReelBtn").addEventListener("click", async () => {
    const id = $("editReelId").value;
    if (!window.confirm("Delete this saved Reel permanently?")) return;
    try {
      await apiFetch(`/api/reels/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      showToast("Reel deleted.");
      closeDetailModal();
      await Promise.all([loadCategories(), loadReels()]);
    } catch (err) {
      showToast(err.message);
    }
  });

  // ─── Initialize & Handle PWA Share Target ─────────────────────────────────
  function checkPwaSharedParams() {
    const params = new URLSearchParams(window.location.search);
    const sharedUrl = params.get("shared_url") || "";
    const sharedText = params.get("shared_text") || "";
    if (!sharedUrl && !sharedText) return;

    const urlMatch = (sharedUrl + " " + sharedText).match(
      /https?:\/\/(?:www\.)?(?:instagram\.com|instagr\.am)\/\S+/i
    );
    openAddModal();
    if (urlMatch) {
      $("reelSourceUrl").value = urlMatch[0];
    }
    if (sharedText) {
      $("reelCaption").value = sharedText;
    }
    window.history.replaceState({}, "", "/");
  }

  async function enterDashboard() {
    renderViewState();
    const storedUser = JSON.parse(localStorage.getItem(STORAGE_KEYS.user) || "{}");
    $("userEmailLabel").textContent = storedUser.email || "";
    await Promise.all([loadSystemCapabilities(), loadCategories(), loadReels()]);
    checkPwaSharedParams();
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(str) {
    return escapeHtml(str).replace(/'/g, "&#39;");
  }

  // Boot
  renderViewState();
  if (getTokens().accessToken) {
    enterDashboard().catch(() => {
      clearSession();
      renderViewState();
    });
  }
})();
