import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { ENV } from "../config/env";
import type { SummaryStyle } from "../types/reel.types";

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
  summaryStyle?: SummaryStyle;
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

function getStylePromptDirective(style: SummaryStyle): string {
  switch (style) {
    case "numbered":
      return `Summary Style Requested: NUMBERED STEPS ("numbered")
- "summary": 1-2 ultra-brief sentences (max 28 words total) stating the exact end result + key metric/time.
- "keyPoints": 3-7 sequential, chronological step-by-step instructions in exact order. Start each item with a strong action verb (6-14 words per item). Do NOT include leading numbers like "1." inside the JSON strings (the UI renders numbers automatically).`;
    case "checklist":
      return `Summary Style Requested: ACTION CHECKLIST ("checklist")
- "summary": 1-2 ultra-brief sentences (max 28 words total) stating what you will accomplish/make.
- "keyPoints": 3-7 short, checkable action/ingredient/task items (5-12 words each) starting with an imperative verb or exact quantity. Do NOT include checkbox symbols inside the JSON strings.`;
    case "paragraph":
      return `Summary Style Requested: BRIEF COMPLETE PARAGRAPH ("paragraph")
- "summary": One cohesive, brief yet complete paragraph of 2-3 tight sentences (35-55 words max) covering the core topic, exact method/quantities, and final outcome with zero filler.
- "keyPoints": 3 ultra-short quick highlights (4-9 words each) capturing the top numbers, tools, or ingredients.`;
    case "bullets":
    default:
      return `Summary Style Requested: CRISP BULLET POINTS ("bullets")
- "summary": 1-2 ultra-brief sentences (max 28 words total) capturing the core takeaway and outcome completely with zero filler.
- "keyPoints": 3-6 punchy, self-contained bullet points (6-14 words each) covering every key fact, quantity, tip, or step without repeating the summary verbatim. Do NOT include bullet characters like "•" or "-" inside the JSON strings.`;
  }
}

function buildPrompt(
  input: AnalyzeReelInput,
  allowedCategories: string[]
): string {
  const style: SummaryStyle = input.summaryStyle ?? "bullets";
  const hasRealTranscript = Boolean(input.spokenTranscript?.trim());
  const transcriptBlock = hasRealTranscript
    ? `Spoken Audio Transcript (extracted from the reel's audio):\n"""\n${input.spokenTranscript!.trim()}\n"""`
    : "Spoken Audio Transcript: (Not provided — infer carefully from caption context)";

  const captionBlock = input.caption?.trim()
    ? `Instagram Caption:\n"""\n${input.caption.trim()}\n"""`
    : "Instagram Caption: (None)";

  return `You distill saved Instagram Reels into brief, complete, high-signal notes for a personal knowledge library.

Author: ${input.authorHandle ? `@${input.authorHandle}` : "unknown"}
Source URL: ${input.sourceUrl ?? "uploaded media"}

${transcriptBlock}

${captionBlock}

STRICT QUALITY RULES:
1) NO FLUFF OR META-TALK: Never write "In this reel...", "The creator explains...", "This video is about...", or "في هذا الفيديو...". Start directly with the substance!
2) BRIEF YET COMPLETE: Capture 100% of the essential quantities, times, tools, ingredients, exercises, or rules in half the words. Never ramble or copy long raw sentences verbatim.
3) LANGUAGE MATCH: Write "title", "summary", and "keyPoints" in the SAME primary language as the reel content (e.g. Arabic -> natural concise Arabic; English -> crisp English).
4) "title": Clear, specific 3-7 word title.
5) "transcript": If a real Spoken Audio Transcript was provided, lightly fix punctuation/spacing while preserving the exact spoken words and language. Otherwise provide a short note based on the caption.
6) ${getStylePromptDirective(style)}
7) "category": Pick the single best-fitting category from the allowed list below.

Allowed categories (choose exact string):
${allowedCategories.map((c) => `- ${c}`).join("\n")}

Return ONLY valid JSON matching this exact structure (no markdown commentary):
{
  "title": "Short specific title",
  "transcript": "Cleaned transcript text",
  "summary": "Brief, complete 1-2 sentence overview (no fluff)",
  "keyPoints": ["Concise point 1", "Concise point 2", "Concise point 3"],
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

function stripPointPrefix(point: string): string {
  return point
    .replace(/^(?:[-•*▪▸👉✅☑☐]\s*|\d+[.)]\s+|step\s+\d+[:.)-]?\s*)/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripMetaFluffOpening(summary: string): string {
  return summary
    .replace(
      /^(?:in this (?:instagram )?(?:reel|video|post|clip),?\s*(?:the (?:creator|speaker|host|author|chef|coach)\s+(?:shares|explains|shows|demonstrates|discusses|talks about)\s+(?:how to\s+)?)?|this (?:reel|video|clip) (?:explains|shows|demonstrates|covers|is about)\s+)/i,
      ""
    )
    .replace(/^([a-z])/, (_m, ch: string) => ch.toUpperCase())
    .trim();
}

function polishAiResult(
  raw: AiSummaryResult,
  style: SummaryStyle,
  allowedCategories: string[]
): AiSummaryResult {
  let summary = stripMetaFluffOpening(raw.summary);

  // Enforce brevity if a model returns an overly long wall of text
  const maxWords = style === "paragraph" ? 65 : 38;
  const words = summary.split(/\s+/);
  if (words.length > maxWords) {
    const sentences = summary
      .split(/(?<=[.!?؟])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (sentences.length >= 2) {
      summary = sentences.slice(0, style === "paragraph" ? 3 : 2).join(" ");
    } else {
      summary = `${words.slice(0, maxWords).join(" ").replace(/[,;:-]+$/, "")}.`;
    }
  }

  const cleanedPoints = raw.keyPoints
    .map(stripPointPrefix)
    .filter((p) => p.length >= 3)
    .slice(0, 7);

  return {
    title: raw.title.replace(/^["“]|["”]$/g, "").trim().slice(0, 150),
    transcript: raw.transcript.trim(),
    summary,
    keyPoints:
      cleanedPoints.length > 0 ? cleanedPoints : [summary.slice(0, 120)],
    category: normalizeCategoryChoice(raw.category, allowedCategories),
  };
}

// ─── Provider 1: Groq Free Tier (`llama-3.3-70b-versatile`) ──────────────────
async function summarizeWithGroq(
  prompt: string,
  style: SummaryStyle,
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
      temperature: 0.15,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a concise, high-signal reel summarizer. Output strict JSON only with brief, complete summaries and crisp points.",
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
  return polishAiResult(parsed, style, allowedCategories);
}

// ─── Provider 2: Google Gemini Free Tier (`gemini-2.5-flash`) ────────────────
async function summarizeWithGemini(
  prompt: string,
  style: SummaryStyle,
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
        temperature: 0.15,
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
  return polishAiResult(parsed, style, allowedCategories);
}

// ─── Provider 3: Anthropic Claude ────────────────────────────────────────────
async function summarizeWithAnthropic(
  prompt: string,
  style: SummaryStyle,
  allowedCategories: string[]
): Promise<AiSummaryResult> {
  const anthropic = new Anthropic({
    apiKey: ENV.ANTHROPIC_API_KEY || undefined,
  });

  const modelCandidates = Array.from(
    new Set([
      ENV.ANTHROPIC_MODEL,
      "claude-sonnet-4-20250514",
      "claude-3-5-haiku-latest",
    ])
  );

  let lastErr: unknown;
  for (const model of modelCandidates) {
    try {
      const message = await anthropic.messages.create({
        model,
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      });

      const content = message.content.find((block) => block.type === "text");
      if (!content || content.type !== "text") {
        throw new Error("Claude returned no text content.");
      }

      const parsed = aiAnalysisSchema.parse(parseAiJson(content.text));
      return polishAiResult(parsed, style, allowedCategories);
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!/not_found|404|model/i.test(msg)) {
        throw err;
      }
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new Error("Anthropic request failed.");
}

// ─── Provider 4: Local Ollama (100% free & offline) ──────────────────────────
async function summarizeWithOllama(
  prompt: string,
  style: SummaryStyle,
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
    return polishAiResult(parsed, style, allowedCategories);
  } finally {
    clearTimeout(timer);
  }
}

// ─── Provider 5: Smart Offline Extractive & Compression Summarizer ───────────
const CATEGORY_KEYWORDS: Record<ReelCategory, RegExp[]> = {
  Recipes: [
    /\b(recipe|cook|bake|baking|pasta|chicken|salmon|garlic|sauce|oven|pan|sear|baste|ingredients?|tablespoon|tbsp|tsp|cup|flour|butter|meal prep|dinner|lunch|breakfast|air ?fryer|dessert|rice)\b/i,
    /(وصفة|طبخ|مطبخ|مقادير|دجاج|شاورما|فرن|مقلاة|ملعقة|حلى|عشاء|فطور|غداء|تتبيلة|ثوم|ليمون)/,
  ],
  Nutrition: [
    /\b(protein|calories?|macros?|nutrition|diet|gut health|vitamins?|supplements?|creatine|fiber|fasting|hydration|sugar|healthy eating)\b/i,
    /(بروتين|سعرات|تغذية|دايت|فيتامين|صحي|مكملات)/,
  ],
  "Fitness & training": [
    /\b(workout|gym|exercise|squats?|lunge|lunges|deadlifts?|bench|hypertrophy|cardio|mobility|stretching|posture|spine|hip|thoracic|glutes|abs|reps|sets|muscle|running|pushups?|pullups?)\b/i,
    /(تمرين|تمارين|جيم|عضلات|لياقة|كارديو|نادي|إطالة)/,
  ],
  "Tech & coding": [
    /\b(code|coding|programming|javascript|typescript|node\.?js|python|flutter|react|api|http|queue|worker|ffmpeg|whisper|github|docker|linux|ai tools?|software|developer|frontend|backend|sql|database|app)\b/i,
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

function cleanHashtagsAndUrls(raw: string): string {
  return raw
    .replace(/https?:\/\/\S+/g, "")
    .replace(/(?:^|\s)#[\p{L}\p{N}_]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Compresses conversational phrasing & spoken units into crisp shorthand.
 */
function compressPhrase(text: string): string {
  return text
    .replace(
      /^(?:hey guys[,!\s]*|welcome back[,!\s]*|today we(?:'re| are) (?:going to |gonna )?(?:make|making|build|building|cover|covering|talk about|showing)\s+(?:a |an )?|in this (?:video|reel) we(?:'re| are)\s+\w+\s+)/i,
      ""
    )
    .replace(/^(?:اليوم رح نعمل|في فيديو اليوم رح نعمل|خلينا نعمل|تعالوا نعمل)\s+/u, "")
    .replace(
      /^(?:first(?:ly)?|second(?:ly)?|third(?:ly)?|fourth(?:ly)?|next|then|after that|finally|lastly)[,:\s]+/i,
      ""
    )
    .replace(/^(?:أولاً|ثانياً|ثالثاً|رابعاً|أخيراً|وبعدين|بعدين)[،,:\s]+/u, "")
    .replace(/\bone tablespoons?\s+of\b/gi, "1 tbsp")
    .replace(/\btwo tablespoons?\s+of\b/gi, "2 tbsp")
    .replace(/\bthree tablespoons?\s+of\b/gi, "3 tbsp")
    .replace(/\btablespoons?\s+of\b/gi, "tbsp")
    .replace(/\btablespoons?\b/gi, "tbsp")
    .replace(/\bteaspoons?\s+of\b/gi, "tsp")
    .replace(/\bteaspoons?\b/gi, "tsp")
    .replace(/\b(\d+)\s*grams?\s+of\b/gi, "$1g")
    .replace(/\b(\d+)\s*grams?\b/gi, "$1g")
    .replace(/\b(\d+)[- ]minutes?\b/gi, "$1-min")
    .replace(/\bfor\s+(\d+)\s+minutes?\b/gi, "for $1 min")
    .replace(/\bfor\s+(\d+)\s+seconds?\b/gi, "for $1 sec")
    .replace(/\bfive\b/gi, "5")
    .replace(/\bsix\b/gi, "6")
    .replace(/\bseven\b/gi, "7")
    .replace(/\bten\b/gi, "10")
    .replace(/\bfifteen\b/gi, "15")
    .replace(/\bthirty\b/gi, "30")
    .replace(/\s+/g, " ")
    .trim();
}

function capitalizeStart(text: string): string {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const TRAILING_DANGLING_WORDS =
  /\s+(?:and|or|with|to|for|of|in|on|at|by|from|into|a|an|the|then|و|مع|في|من|على|إلى|او|أو)$/iu;

function cleanDanglingTail(text: string): string {
  let out = text.replace(/[,;:\-–—،]+$/u, "").trim();
  while (TRAILING_DANGLING_WORDS.test(out)) {
    out = out.replace(TRAILING_DANGLING_WORDS, "").replace(/[,;:\-–—،]+$/u, "").trim();
  }
  // Balance unclosed '(' if word-truncation sliced inside parentheses
  const openParens = (out.match(/\(/g) || []).length;
  const closeParens = (out.match(/\)/g) || []).length;
  if (openParens > closeParens) {
    out = out.replace(/\([^)]*$/, "").trim();
  }
  return out;
}

function truncateWordsCleanly(text: string, maxWords: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) {
    return cleanDanglingTail(text);
  }
  return cleanDanglingTail(words.slice(0, maxWords).join(" "));
}

/**
 * Splits spoken/unpunctuated transcripts as well as structured captions into
 * atomic action/fact clauses so every Reel yields clear, separate points.
 */
function segmentIntoAtomicClauses(text: string): string[] {
  // Insert clause breaks before spoken sequence markers & compound step transitions
  const preSegmented = text
    .replace(
      /(?:[,;]\s*(?:and\s+|then\s+)?|\s+)(?=(?:First|Second|Third|Fourth|Next|Then|Finally|Start with|Lower the heat|Serve|Instead)\b)/gi,
      "\n"
    )
    .replace(/,\s+and\s+(?=(?:serve|flip|baste|toss|top|garnish|chill|bake|roast|enjoy)\b)/gi, "\n")
    .replace(
      /[،,]?\s*(?=(?:أولاً|ثانياً|ثالثاً|أخيراً|بنقطع|وبنتبلها|بنتبلها|وبنشويها|بنشويها|وبنقدمها|بنقدمها|وبنضيف|بنضيف)\b)/gu,
      "\n"
    );

  const rawChunks = preSegmented
    .split(/\n+|(?<=[.!?؟।])\s+|;\s+/)
    .map((s) => cleanDanglingTail(stripPointPrefix(s)))
    .filter((s) => s.length >= 8);

  const fineClauses: string[] = [];
  for (const chunk of rawChunks) {
    const words = chunk.split(/\s+/);
    if (words.length > 20) {
      const subParts = chunk
        .split(
          /\s+[—–-]\s+|,\s+(?:and\s+|then\s+)?(?=(?:flip|baste|toss|serve|add|sear|push|convert|stream|register|extract|upload)\b)/i
        )
        .map((p) => cleanDanglingTail(p.trim()))
        .filter((p) => p.length >= 8);
      fineClauses.push(...subParts);
    } else {
      fineClauses.push(chunk);
    }
  }

  return fineClauses;
}

export function summarizeHeuristically(
  input: AnalyzeReelInput,
  allowedCategories?: string[]
): AiSummaryResult {
  const resolvedCategories = buildAllowedCategories(
    allowedCategories ?? input.userCategories
  );
  const style: SummaryStyle = input.summaryStyle ?? "bullets";
  const spoken = input.spokenTranscript?.trim() ?? "";
  const caption = input.caption?.trim() ?? "";
  const combinedSource = [caption, spoken].filter(Boolean).join("\n").trim();

  if (!combinedSource) {
    const handleText = input.authorHandle ? ` by @${input.authorHandle}` : "";
    return {
      title: input.authorHandle
        ? `Saved Reel from @${input.authorHandle}`
        : "Saved Instagram Reel",
      transcript:
        `No audio speech or caption text was detected for this reel${handleText}. ` +
        `You can auto-convert MP3/MP4 audio or edit this transcript manually at any time.`,
      summary: `Saved Reel${handleText} awaiting audio or caption text.`,
      keyPoints: [
        "Click Auto-Convert & Transcribe to extract MP3 audio and spoken text",
        "Or edit transcript & personal notes manually anytime",
      ],
      category: "Other",
    };
  }

  const cleanCaption = cleanHashtagsAndUrls(caption);
  const cleanSpoken = cleanHashtagsAndUrls(spoken);
  const primaryBody = cleanSpoken || cleanCaption;
  const category = classifyHeuristicCategory(combinedSource, resolvedCategories);

  const clauses = segmentIntoAtomicClauses(primaryBody);
  const compressedClauses = clauses
    .map((c) => capitalizeStart(compressPhrase(c)))
    .filter((c) => c.length >= 8);

  // 1. Concise, specific title (up to 9 words so parenthetical metrics like "(46g protein)" stay intact)
  const titleSeed = cleanCaption
    ? compressPhrase(cleanCaption.split(/[.!?؟—–|\n]/)[0] ?? cleanCaption)
    : compressedClauses[0] ?? primaryBody;
  const titleWords = truncateWordsCleanly(titleSeed, 9);
  const title =
    titleWords.length >= 3
      ? capitalizeStart(titleWords.replace(/[!.:]+$/, ""))
      : `${category} Reel${input.authorHandle ? ` (@${input.authorHandle})` : ""}`;

  // 2. Crisp, distinct key points (skip pure topic-intro clauses when detailed clauses exist)
  const detailCandidates =
    compressedClauses.length > 2 &&
    cleanCaption &&
    compressedClauses[0]
      .toLowerCase()
      .slice(0, 22)
      .includes(title.toLowerCase().slice(0, 12))
      ? compressedClauses.slice(1)
      : compressedClauses;

  const maxWordsPerPoint =
    style === "checklist" ? 13 : style === "paragraph" ? 10 : 16;
  const targetPointCount = style === "paragraph" ? 3 : 6;

  const uniquePoints: string[] = [];
  for (const cand of detailCandidates) {
    const point = truncateWordsCleanly(cand, maxWordsPerPoint).replace(
      /[.]+$/,
      ""
    );
    if (point.length < 6) continue;
    const norm = point.toLowerCase();
    if (
      !uniquePoints.some(
        (existing) =>
          existing.toLowerCase() === norm ||
          existing.toLowerCase().includes(norm) ||
          norm.includes(existing.toLowerCase())
      )
    ) {
      uniquePoints.push(point);
    }
    if (uniquePoints.length >= targetPointCount) break;
  }

  if (uniquePoints.length === 0) {
    uniquePoints.push(truncateWordsCleanly(compressPhrase(primaryBody), 15));
  }

  // 3. Brief & Complete Summary (never a raw transcript dump, language-aware!)
  const isArabic = /[\u0600-\u06FF]/.test(primaryBody);
  const leadOverview = cleanCaption
    ? truncateWordsCleanly(capitalizeStart(compressPhrase(cleanCaption)), 20)
    : truncateWordsCleanly(compressedClauses[0] ?? primaryBody, 18);

  let summary: string;
  if (style === "paragraph") {
    const joiner = isArabic ? "، ثم " : ", then ";
    const flowLabel = isArabic ? "الخطوات الأساسية:" : "Key flow:";
    const coreSteps = uniquePoints
      .slice(0, 3)
      .map((p) => (isArabic ? p : p.charAt(0).toLowerCase() + p.slice(1)))
      .join(joiner);
    const leadSentence = /[.!?؟]$/.test(leadOverview)
      ? leadOverview
      : `${leadOverview}.`;
    summary = coreSteps
      ? `${leadSentence} ${flowLabel} ${coreSteps}.`
      : leadSentence;
    summary = truncateWordsCleanly(summary, 52);
    if (!/[.!?؟]$/.test(summary)) summary += ".";
  } else {
    const firstStep = uniquePoints[0]
      ? truncateWordsCleanly(uniquePoints[0], 10)
      : "";
    const lastStep =
      uniquePoints.length >= 2
        ? truncateWordsCleanly(uniquePoints[uniquePoints.length - 1], 10)
        : "";
    const baseLead = leadOverview.replace(/[.!?؟]+$/, "");
    if (
      firstStep &&
      lastStep &&
      !baseLead.toLowerCase().includes(lastStep.toLowerCase().slice(0, 10))
    ) {
      if (isArabic) {
        summary = `${baseLead}: ${firstStep} حتى ${lastStep}.`;
      } else {
        const f = firstStep.charAt(0).toLowerCase() + firstStep.slice(1);
        const l = lastStep.charAt(0).toLowerCase() + lastStep.slice(1);
        summary = `${baseLead} — ${f}, then ${l}.`;
      }
    } else {
      summary = `${baseLead}.`;
    }
    summary = truncateWordsCleanly(summary, 32);
    if (!/[.!?؟]$/.test(summary)) summary += ".";
  }

  const transcript = spoken
    ? spoken
    : `${cleanCaption}\n\n(Note: Summarized from caption — auto-convert to MP3 to transcribe spoken audio.)`;

  return {
    title: title.slice(0, 150),
    transcript,
    summary,
    keyPoints: uniquePoints,
    category,
  };
}

/**
 * Full multi-provider analyzer supporting brief & complete summaries in the user's chosen style.
 */
export async function analyzeReelContent(
  input: AnalyzeReelInput
): Promise<AiSummaryResult> {
  const style: SummaryStyle = input.summaryStyle ?? "bullets";
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
    return summarizeWithGroq(prompt, style, allowedCategories);
  }
  if (preferred === "gemini" && ENV.GEMINI_API_KEY) {
    return summarizeWithGemini(prompt, style, allowedCategories);
  }
  if (preferred === "anthropic" && ENV.ANTHROPIC_API_KEY) {
    return summarizeWithAnthropic(prompt, style, allowedCategories);
  }
  if (preferred === "ollama") {
    return summarizeWithOllama(prompt, style, allowedCategories);
  }

  const attempts: Array<() => Promise<AiSummaryResult>> = [];
  if (ENV.GROQ_API_KEY) {
    attempts.push(() => summarizeWithGroq(prompt, style, allowedCategories));
  }
  if (ENV.GEMINI_API_KEY) {
    attempts.push(() => summarizeWithGemini(prompt, style, allowedCategories));
  }
  if (ENV.ANTHROPIC_API_KEY) {
    attempts.push(() =>
      summarizeWithAnthropic(prompt, style, allowedCategories)
    );
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

  if (ENV.OLLAMA_BASE_URL && ENV.NODE_ENV !== "test") {
    try {
      return await summarizeWithOllama(prompt, style, allowedCategories);
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
