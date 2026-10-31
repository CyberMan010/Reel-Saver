import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { ENV } from "../config/env";

export const REEL_CATEGORIES = [
  "Fitness & training",
  "Nutrition",
  "Business & career",
  "Tech & coding",
  "Recipes",
  "Productivity",
  "Motivation & mindset",
  "Travel",
  "Other",
] as const;

export type ReelCategory = (typeof REEL_CATEGORIES)[number];

export const aiAnalysisSchema = z.object({
  title: z.string().min(1).max(160),
  transcript: z.string().min(1),
  summary: z.string().min(1),
  keyPoints: z.array(z.string().min(1)).min(1).max(8),
  category: z.string().min(1),
});

export type AiSummaryResult = z.infer<typeof aiAnalysisSchema>;

export interface AnalyzeReelInput {
  spokenTranscript?: string | null;
  caption?: string | null;
  authorHandle?: string | null;
  sourceUrl?: string | null;
  userCategories?: string[];
}

function buildAllowedCategories(userCategories?: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const name of [...(userCategories ?? []), ...REEL_CATEGORIES]) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(trimmed);
    }
  }
  return result;
}

function buildPrompt(input: AnalyzeReelInput, allowedCategories: string[]): string {
  const hasRealTranscript = Boolean(input.spokenTranscript?.trim());
  const transcriptBlock = hasRealTranscript
    ? `Spoken Audio Transcript (extracted from the reel's audio):\n"""\n${input.spokenTranscript!.trim()}\n"""`
    : "Spoken Audio Transcript: (Not provided — infer carefully from caption context)";

  const captionBlock = input.caption?.trim()
    ? `Instagram Caption:\n"""\n${input.caption.trim()}\n"""`
    : "Instagram Caption: (None)";

  return `You organize and summarize saved Instagram Reels for a personal knowledge library app.

Author: ${input.authorHandle ? `@${input.authorHandle}` : "unknown"}
Source URL: ${input.sourceUrl ?? "uploaded media"}

${transcriptBlock}

${captionBlock}

Your tasks:
1) Write a clear, descriptive "title" (3-8 words) in the same primary language as the content.
2) If a real Spoken Audio Transcript was provided above, clean up any obvious punctuation/ASR spacing issues while keeping the exact meaning and language for "transcript". Otherwise provide a concise inferred transcript note based on the caption.
3) Write a crisp 2-3 sentence "summary" capturing the core value of the reel in the same language as the content.
4) Extract 3-6 actionable "keyPoints" (steps, ingredients, exercises, tools, or takeaways).
5) Pick the single best-fitting "category" from the allowed list below.

Allowed categories (choose exact string):
${allowedCategories.map((c) => `- ${c}`).join("\n")}

Return ONLY valid JSON matching this exact structure (no markdown commentary):
{
  "title": "Short descriptive title",
  "transcript": "Cleaned transcript text",
  "summary": "2-3 sentence summary",
  "keyPoints": ["Point 1", "Point 2", "Point 3"],
  "category": "Exact category name from allowed list"
}`;
}

function parseAiJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
  }
  return JSON.parse(candidate);
}

function normalizeCategoryChoice(
  chosen: string,
  allowedCategories: string[]
): string {
  const lower = chosen.trim().toLowerCase();
  const exact = allowedCategories.find((c) => c.toLowerCase() === lower);
  if (exact) return exact;
  const partial = allowedCategories.find(
    (c) => lower.includes(c.toLowerCase()) || c.toLowerCase().includes(lower)
  );
  return partial ?? "Other";
}

// ─── Provider 1: Groq Free Tier (`llama-3.3-70b-versatile`) ──────────────────
async function summarizeWithGroq(
  prompt: string,
  allowedCategories: string[]
): Promise<AiSummaryResult> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ENV.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: ENV.GROQ_LLM_MODEL,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a precise JSON reel summarizer. Always output valid JSON only.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Groq LLM failed (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content ?? "";
  const parsed = aiAnalysisSchema.parse(parseAiJson(text));
  return {
    ...parsed,
    category: normalizeCategoryChoice(parsed.category, allowedCategories),
  };
}

// ─── Provider 2: Google Gemini Free Tier (`gemini-2.5-flash`) ────────────────
async function summarizeWithGemini(
  prompt: string,
  allowedCategories: string[]
): Promise<AiSummaryResult> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    ENV.GEMINI_MODEL
  )}:generateContent?key=${encodeURIComponent(ENV.GEMINI_API_KEY)}`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini LLM failed (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text =
    data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ??
    "";
  const parsed = aiAnalysisSchema.parse(parseAiJson(text));
  return {
    ...parsed,
    category: normalizeCategoryChoice(parsed.category, allowedCategories),
  };
}

// ─── Provider 3: Anthropic Claude (existing optional provider) ───────────────
async function summarizeWithAnthropic(
  prompt: string,
  allowedCategories: string[]
): Promise<AiSummaryResult> {
  const anthropic = new Anthropic({
    apiKey: ENV.ANTHROPIC_API_KEY || undefined,
  });

  const message = await anthropic.messages.create({
    model: ENV.ANTHROPIC_MODEL,
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const content = message.content.find((block) => block.type === "text");
  if (!content || content.type !== "text") {
    throw new Error("Claude returned no text content.");
  }

  const parsed = aiAnalysisSchema.parse(parseAiJson(content.text));
  return {
    ...parsed,
    category: normalizeCategoryChoice(parsed.category, allowedCategories),
  };
}

// ─── Provider 4: Local Ollama (100% free & offline) ──────────────────────────
async function summarizeWithOllama(
  prompt: string,
  allowedCategories: string[]
): Promise<AiSummaryResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(`${ENV.OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: ENV.OLLAMA_MODEL,
        stream: false,
        format: "json",
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) {
      throw new Error(`Ollama returned ${res.status}`);
    }
    const data = (await res.json()) as { message?: { content?: string } };
    const parsed = aiAnalysisSchema.parse(
      parseAiJson(data.message?.content ?? "")
    );
    return {
      ...parsed,
      category: normalizeCategoryChoice(parsed.category, allowedCategories),
    };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Provider 5: Smart Built-In Local Extractive Analyzer (Zero Keys Needed) ─
const CATEGORY_KEYWORDS: Record<ReelCategory, RegExp[]> = {
  Recipes: [
    /\b(recipe|cook|bake|baking|pasta|chicken|garlic|sauce|oven|pan|ingredients?|tablespoon|tbsp|tsp|cup|flour|butter|meal prep|dinner|lunch|breakfast|air ?fryer|dessert)\b/i,
    /(وصفة|طبخ|مطبخ|مقادير|دجاج|فرن|ملعقة|حلى|عشاء|فطور|غداء)/,
  ],
  Nutrition: [
    /\b(protein|calories?|macros?|nutrition|diet|gut health|vitamins?|supplements?|creatine|fiber|fasting|hydration|sugar|healthy eating)\b/i,
    /(بروتين|سعرات|تغذية|دايت|فيتامين|صحي|مكملات)/,
  ],
  "Fitness & training": [
    /\b(workout|gym|exercise|squats?|deadlifts?|bench|hypertrophy|cardio|mobility|stretching|glutes|abs|reps|sets|muscle|running|pushups?|pullups?)\b/i,
    /(تمرين|تمارين|جيم|عضلات|لياقة|كارديو|نادي)/,
  ],
  "Tech & coding": [
    /\b(code|coding|programming|javascript|typescript|python|flutter|react|api|github|docker|linux|ai tools?|software|developer|frontend|backend|sql|database|app)\b/i,
    /(برمجة|كود|تطبيق|ذكاء اصطناعي|مطور|تقنية)/,
  ],
  "Business & career": [
    /\b(business|startup|marketing|sales|revenue|career|resume|interview|freelance|clients?|investing|finance|money|saas|entrepreneur|branding)\b/i,
    /(بزنس|أعمال|تسويق|مبيعات|استثمار|وظيفة|مقابلة|ريادة)/,
  ],
  Productivity: [
    /\b(productivity|focus|deep work|pomodoro|notion|study|studying|time management|morning routine|workflow|habits?|schedule|organize)\b/i,
    /(إنتاجية|تركيز|دراسة|تنظيم الوقت|عادات|روتين)/,
  ],
  "Motivation & mindset": [
    /\b(mindset|discipline|motivation|confidence|mental health|gratitude|stoic|consistency|believe|overcome|self improvement|growth)\b/i,
    /(تحفيز|انضباط|عقلية|تطوير الذات|ثقة|نجاح)/,
  ],
  Travel: [
    /\b(travel|itinerary|flight|hotel|airport|vacation|hidden gem|city guide|beach|passport|trip|explore|cafe in|visit)\b/i,
    /(سفر|سياحة|رحلة|فندق|مطار|وجهة)/,
  ],
  Other: [],
};

function classifyHeuristicCategory(
  text: string,
  allowedCategories: string[]
): string {
  const lower = text.toLowerCase();

  // First check any custom user categories whose name words appear directly in the text
  for (const cat of allowedCategories) {
    if ((REEL_CATEGORIES as readonly string[]).includes(cat)) continue;
    const tokens = cat
      .toLowerCase()
      .split(/[\s&,/+-]+/)
      .filter((t) => t.length >= 3);
    if (tokens.some((tok) => lower.includes(tok))) {
      return cat;
    }
  }

  let bestCategory: ReelCategory = "Other";
  let bestScore = 0;

  for (const [category, patterns] of Object.entries(CATEGORY_KEYWORDS) as Array<
    [ReelCategory, RegExp[]]
  >) {
    let score = 0;
    for (const regex of patterns) {
      const globalRegex = new RegExp(
        regex.source,
        regex.flags.includes("g") ? regex.flags : `${regex.flags}g`
      );
      const matches = text.match(globalRegex);
      if (matches) score += matches.length;
    }
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  return allowedCategories.includes(bestCategory)
    ? bestCategory
    : allowedCategories[0] ?? "Other";
}

function cleanHashtags(raw: string): string {
  return raw
    .replace(/https?:\/\/\S+/g, "")
    .replace(/(?:^|\s)#[\p{L}\p{N}_]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function summarizeHeuristically(
  input: AnalyzeReelInput,
  allowedCategories: string[]
): AiSummaryResult {
  const spoken = input.spokenTranscript?.trim() ?? "";
  const caption = input.caption?.trim() ?? "";
  const combinedSource = [spoken, caption].filter(Boolean).join("\n\n").trim();

  if (!combinedSource) {
    const handleText = input.authorHandle ? ` by @${input.authorHandle}` : "";
    return {
      title: input.authorHandle
        ? `Saved Reel from @${input.authorHandle}`
        : "Saved Instagram Reel",
      transcript:
        `No audio speech or caption text was detected for this reel${handleText}. ` +
        `You can attach an MP4/MP3 clip or edit this transcript manually at any time.`,
      summary: `Saved Instagram Reel${handleText}. Upload the MP4/MP3 video or add notes to generate a detailed transcript and summary.`,
      keyPoints: [
        input.sourceUrl
          ? `Source saved: ${input.sourceUrl}`
          : "Media clip saved to your library.",
        "Tap Edit to rename the category, adjust the summary, or add personal notes.",
      ],
      category: "Other",
    };
  }

  const cleanedText = cleanHashtags(combinedSource) || combinedSource;
  const sentences = cleanedText
    .split(/(?<=[.!?؟。\n])\s+|\n+/)
    .map((s) => s.replace(/^[-•*\d.)\s]+/, "").trim())
    .filter((s) => s.length > 8);

  const category = classifyHeuristicCategory(combinedSource, allowedCategories);

  // Build concise title from first meaningful clause
  const firstClause = (sentences[0] ?? cleanedText)
    .split(/[,:;—–|-]/)[0]
    .trim();
  const titleWords = firstClause.split(/\s+/).slice(0, 8).join(" ");
  const title =
    titleWords.length >= 3
      ? titleWords.charAt(0).toUpperCase() + titleWords.slice(1)
      : `${category} Reel${input.authorHandle ? ` (@${input.authorHandle})` : ""}`;

  // Build 2-3 sentence summary
  const summarySentences = sentences.slice(0, 3);
  const summary =
    summarySentences.length > 0
      ? summarySentences
          .map((s) => (/([.!?؟])$/.test(s) ? s : `${s}.`))
          .join(" ")
      : cleanedText.slice(0, 260);

  // Extract 3-6 crisp key points
  const bulletCandidates = cleanedText
    .split(/\n+|(?<=[.!?؟])\s+|;\s+/)
    .map((line) => line.replace(/^[-•*👉✅🔥\d.)\s]+/, "").trim())
    .filter((line) => line.length >= 12 && line.length <= 180);

  const uniquePoints: string[] = [];
  for (const item of bulletCandidates) {
    if (
      !uniquePoints.some((existing) => existing.toLowerCase() === item.toLowerCase())
    ) {
      uniquePoints.push(item);
    }
    if (uniquePoints.length >= 5) break;
  }

  if (uniquePoints.length === 0) {
    uniquePoints.push(cleanedText.slice(0, 140));
  }

  const transcript = spoken
    ? spoken
    : `${cleanedText}\n\n(Note: Derived from reel caption — upload the MP4/MP3 file for full spoken audio transcription.)`;

  return {
    title: title.slice(0, 150),
    transcript,
    summary,
    keyPoints: uniquePoints.slice(0, 6),
    category,
  };
}

/**
 * Full multi-provider analyzer supporting real audio transcripts + captions + custom categories.
 * Cascades automatically across card-free & local providers so it never crashes.
 */
export async function analyzeReelContent(
  input: AnalyzeReelInput
): Promise<AiSummaryResult> {
  const allowedCategories = buildAllowedCategories(input.userCategories);
  const hasAnyText = Boolean(
    input.spokenTranscript?.trim() || input.caption?.trim()
  );

  if (!hasAnyText) {
    return summarizeHeuristically(input, allowedCategories);
  }

  const prompt = buildPrompt(input, allowedCategories);
  const preferred = ENV.AI_PROVIDER;

  if (preferred === "heuristic") {
    return summarizeHeuristically(input, allowedCategories);
  }
  if (preferred === "groq" && ENV.GROQ_API_KEY) {
    return summarizeWithGroq(prompt, allowedCategories);
  }
  if (preferred === "gemini" && ENV.GEMINI_API_KEY) {
    return summarizeWithGemini(prompt, allowedCategories);
  }
  if (preferred === "anthropic" && ENV.ANTHROPIC_API_KEY) {
    return summarizeWithAnthropic(prompt, allowedCategories);
  }
  if (preferred === "ollama") {
    return summarizeWithOllama(prompt, allowedCategories);
  }

  // "auto" cascade: Groq (free) -> Gemini (free) -> Anthropic -> Ollama (local) -> Built-in Heuristic
  const attempts: Array<() => Promise<AiSummaryResult>> = [];
  if (ENV.GROQ_API_KEY) {
    attempts.push(() => summarizeWithGroq(prompt, allowedCategories));
  }
  if (ENV.GEMINI_API_KEY) {
    attempts.push(() => summarizeWithGemini(prompt, allowedCategories));
  }
  if (ENV.ANTHROPIC_API_KEY) {
    attempts.push(() => summarizeWithAnthropic(prompt, allowedCategories));
  }

  for (const run of attempts) {
    try {
      return await run();
    } catch (err) {
      console.warn(
        "[AI] Provider attempt failed, trying next fallback:",
        err instanceof Error ? err.message : err
      );
    }
  }

  // Try local Ollama silently if running on localhost
  if (ENV.OLLAMA_BASE_URL) {
    try {
      return await summarizeWithOllama(prompt, allowedCategories);
    } catch {
      // Fall through to deterministic offline analyzer
    }
  }

  return summarizeHeuristically(input, allowedCategories);
}

/**
 * Backward-compatible helper used by existing scripts (`scripts/test-ai.ts`).
 */
export async function summarizeReelCaption(
  caption: string | null,
  authorHandle: string | null
): Promise<AiSummaryResult> {
  return analyzeReelContent({
    caption,
    authorHandle,
  });
}
