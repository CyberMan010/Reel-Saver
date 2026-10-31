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

export const aiSummarySchema = z.object({
  transcript: z.string().min(1),
  summary: z.string().min(1),
  keyPoints: z.array(z.string().min(1)).min(1).max(8),
  category: z.enum(REEL_CATEGORIES),
});

export type AiSummaryResult = z.infer<typeof aiSummarySchema>;

const anthropic = new Anthropic({
  apiKey: ENV.ANTHROPIC_API_KEY || undefined,
});

function buildPrompt(caption: string, authorHandle: string | null): string {
  return `You summarize Instagram Reels for a personal library app.

The only available content is the reel caption and the author handle. There is no actual audio or video feed available.

Author: ${authorHandle ?? "unknown"}
Caption:
"""
${caption}
"""

Your task:
1) Produce a plausible spoken transcript for the reel based on the caption and author context.
2) Write a short 2-3 sentence summary of the reel.
3) Create 3-6 concise key points.
4) Choose exactly one category from the allowed list.

Return ONLY valid JSON with this exact shape:
{
  "transcript": "Plausible transcript text",
  "summary": "2-3 sentence brief of what the reel is about",
  "keyPoints": ["3-6 concise bullet points"],
  "category": "<one category from the allowed list>"
}

Allowed categories (pick exactly one):
${REEL_CATEGORIES.map((c) => `- ${c}`).join("\n")}

If the caption is sparse or missing, infer a reasonable transcript and summary from the available text, but be explicit that the transcript is an inferred approximation.`;
}

function parseAiJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  return JSON.parse(candidate);
}

export async function summarizeReelCaption(
  caption: string | null,
  authorHandle: string | null
): Promise<AiSummaryResult> {
  if (!ENV.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not configured.");
  }

  const text = caption?.trim();
  if (!text) {
    return {
      transcript: authorHandle
        ? `No caption was provided for this reel by ${authorHandle}. No transcript could be inferred.`
        : "No caption was provided for this reel. No transcript could be inferred.",
      summary: authorHandle
        ? `No caption was provided for this reel by ${authorHandle}.`
        : "No caption was provided for this reel.",
      keyPoints: ["No caption was available for this reel."],
      category: "Other",
    };
  }

  const message = await anthropic.messages.create({
    model: ENV.ANTHROPIC_MODEL,
    max_tokens: 1024,
    messages: [{ role: "user", content: buildPrompt(text, authorHandle) }],
  });

  const content = message.content.find((block) => block.type === "text");
  if (!content || content.type !== "text") {
    throw new Error("Claude returned no text content.");
  }

  let parsed: unknown;
  try {
    parsed = parseAiJson(content.text);
  } catch {
    throw new Error("Claude response was not valid JSON.");
  }

  const validated = aiSummarySchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(`Claude JSON failed validation: ${validated.error.message}`);
  }

  return validated.data;
}
