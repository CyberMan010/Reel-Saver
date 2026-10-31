import { randomUUID } from "crypto";
import multer from "multer";
import path from "path";
import { ENV } from "../config/env";
import { ensureUploadDirs } from "../services/media.service";

const ALLOWED_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".m4v",
  ".webm",
  ".mkv",
  ".mp3",
  ".m4a",
  ".wav",
  ".ogg",
  ".aac",
  ".flac",
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const { rawDir } = ensureUploadDirs();
    cb(null, rawDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".mp4";
    cb(null, `${randomUUID()}${ext}`);
  },
});

export const mediaUpload = multer({
  storage,
  limits: {
    fileSize: ENV.MAX_UPLOAD_MB * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const isMediaMime =
      file.mimetype.startsWith("video/") || file.mimetype.startsWith("audio/");

    if (isMediaMime || ALLOWED_EXTENSIONS.has(ext)) {
      cb(null, true);
      return;
    }

    cb(
      Object.assign(
        new Error(
          "Unsupported file format. Please upload an MP4/MOV/WEBM video or MP3/M4A/WAV/OGG audio file."
        ),
        { statusCode: 422 }
      )
    );
  },
});
