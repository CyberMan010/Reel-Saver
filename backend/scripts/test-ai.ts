import { extractReelContent } from "../services/extraction.service";
import { summarizeReelCaption } from "../services/ai.service";

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: npm run test:ai -- <instagram-reel-url>");
    process.exit(1);
  }

  console.log("Extracting reel metadata from URL:", url);
  const extracted = await extractReelContent(url);
  console.log("Extracted metadata:", extracted);

  console.log("Calling AI to infer transcript and summary...");
  const aiResult = await summarizeReelCaption(extracted.caption, extracted.authorHandle);

  console.log("AI result:");
  console.log(JSON.stringify(aiResult, null, 2));
}

main().catch((err) => {
  console.error("Test failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});