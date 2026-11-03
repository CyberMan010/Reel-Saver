import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { ensureUploadDirs, resolveFfmpegPath } from "./media.service";

const execFileAsync = promisify(execFile);

export interface DemoReelPreset {
  shortcode: string;
  url: string;
  badge: string;
  authorHandle: string;
  caption: string;
  spokenTranscript: string;
  durationSec: number;
  chordExpr: string;
}

export const DEMO_REEL_PRESETS: DemoReelPreset[] = [
  {
    shortcode: "DEMO_CHICKEN_01",
    url: "https://www.instagram.com/reel/DEMO_CHICKEN_01/",
    badge: "🍗 Cooking Reel (English)",
    authorHandle: "chef.kareem",
    caption:
      "15-Minute Crispy Honey Garlic Chicken Bowl — 46g protein meal prep that stays crunchy!",
    spokenTranscript:
      "Today we are making a 15-minute crispy honey garlic chicken bowl with 46 grams of protein. Start with 500 grams of diced chicken breast, toss with salt, black pepper, smoked paprika, and one tablespoon of cornstarch for an ultra-crispy crust. Sear on high heat for five minutes without crowding the pan. Lower the heat, add three minced garlic cloves, two tablespoons of low-sodium soy sauce, one tablespoon of honey, and fresh lemon juice. Toss for 60 seconds until glossy and serve over warm jasmine rice.",
    durationSec: 4,
    chordExpr:
      "0.22*sin(2*PI*261.63*t)*exp(-0.35*t)+0.18*sin(2*PI*329.63*t)*exp(-0.3*t)+0.15*sin(2*PI*392.00*t)*exp(-0.25*t)",
  },
  {
    shortcode: "DEMO_TECH_02",
    url: "https://www.instagram.com/reel/DEMO_TECH_02/",
    badge: "💻 Coding & Architecture Reel",
    authorHandle: "dev.tariq",
    caption:
      "3 rules for designing zero-block background queues when transcribing video & audio in Node.js.",
    spokenTranscript:
      "Never run FFmpeg video conversion or Whisper speech-to-text inside your main HTTP request Cycle. Instead, return HTTP 202 Accepted immediately, push the Reel ID onto an async worker queue, convert the heavy MP4 video into a lightweight 16-kilohertz mono MP3 stream that is thirty times smaller on disk, and stream status updates from Extracting to Transcribing to Summarizing.",
    durationSec: 4,
    chordExpr:
      "0.22*sin(2*PI*293.66*t)*exp(-0.35*t)+0.18*sin(2*PI*369.99*t)*exp(-0.3*t)+0.15*sin(2*PI*440.00*t)*exp(-0.25*t)",
  },
  {
    shortcode: "DEMO_FITNESS_03",
    url: "https://www.instagram.com/reel/DEMO_FITNESS_03/",
    badge: "🏋️ Desk Mobility Reel",
    authorHandle: "coach.layla",
    caption:
      "5-minute daily spine & hip mobility flow if you sit at a desk all day.",
    spokenTranscript:
      "If your lower back and shoulders feel stiff after sitting at your desk all day, run through these three drills every evening. First, perform ten slow 90-90 hip switches keeping your chest tall. Second, do six world's greatest lunges with thoracic reach per side. Third, finish with a 45-second deep squat pry hold while breathing slowly through your nose.",
    durationSec: 4,
    chordExpr:
      "0.22*sin(2*PI*329.63*t)*exp(-0.35*t)+0.18*sin(2*PI*415.30*t)*exp(-0.3*t)+0.15*sin(2*PI*493.88*t)*exp(-0.25*t)",
  },
  {
    shortcode: "DEMO_ARABIC_04",
    url: "https://www.instagram.com/reel/DEMO_ARABIC_04/",
    badge: "🇯🇴 ريل طبخ بالعربي (Arabic)",
    authorHandle: "amman.kitchen",
    caption:
      "وصفة شاورما دجاج صحية بالبيت بـ ١٥ دقيقة بس وبتتبيلة المطاعم الأصلية!",
    spokenTranscript:
      "اليوم رح نعمل أطيب شاورما دجاج صحية بالبيت بخمسطعشر دقيقة بس. بنقطع صدور الدجاج شرائح رفيعة، وبنتبلها بملعقتين لبن زبادي، عصير ليمون، ثوم مهروس، بهارات شاورما، بابريكا ورشة هيل مطحون. بنشويها بمقلاة حامية مع مسحة زيت زيتون لمدة سبع دقائق لحتى تتحمر، وبنقدمها بخبز الشراك مع مثومة خفيفة ومخلل.",
    durationSec: 4,
    chordExpr:
      "0.22*sin(2*PI*349.23*t)*exp(-0.35*t)+0.18*sin(2*PI*440.00*t)*exp(-0.3*t)+0.15*sin(2*PI*523.25*t)*exp(-0.25*t)",
  },
];

export function getDemoPresetByUrl(sourceUrl: string): DemoReelPreset | null {
  if (!sourceUrl) return null;
  for (const preset of DEMO_REEL_PRESETS) {
    if (sourceUrl.toUpperCase().includes(preset.shortcode)) {
      return preset;
    }
  }
  return null;
}

/**
 * Synthesizes a real animated 9:16 vertical MP4 video clip with AAC audio via FFmpeg
 * so the live demo exercises the genuine MP4 -> 16kHz MP3 conversion & thumbnail pipeline.
 */
export async function generateDemoReelMp4(
  reelId: string,
  preset: DemoReelPreset
): Promise<string | null> {
  const ffmpegBin = resolveFfmpegPath();
  if (!ffmpegBin) return null;

  const { rawDir } = ensureUploadDirs();
  const outMp4 = path.join(rawDir, `${reelId}-demo.mp4`);

  try {
    await execFileAsync(
      ffmpegBin,
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        `testsrc2=size=360x640:rate=24:duration=${preset.durationSec}`,
        "-f",
        "lavfi",
        "-i",
        `aevalsrc=${preset.chordExpr}:d=${preset.durationSec}`,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-preset",
        "ultrafast",
        "-c:a",
        "aac",
        "-b:a",
        "96k",
        "-shortest",
        outMp4,
      ],
      { timeout: 20000 }
    );
    return fs.existsSync(outMp4) ? outMp4 : null;
  } catch {
    return null;
  }
}
