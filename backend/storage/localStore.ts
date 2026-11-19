import fs from "fs";
import path from "path";
import { ENV } from "../config/env";
import type { User } from "../types/auth.types";
import type { Category, Reel } from "../types/reel.types";

export interface LocalDbSchema {
  users: User[];
  reels: Reel[];
  categories: Category[];
}

function getDbFilePath(): string {
  fs.mkdirSync(ENV.LOCAL_DATA_DIR, { recursive: true });
  return path.join(ENV.LOCAL_DATA_DIR, "local-db.json");
}

let memoryCache: LocalDbSchema | null = null;

export function readLocalDb(): LocalDbSchema {
  if (memoryCache) {
    return memoryCache;
  }

  const filePath = getDbFilePath();
  if (!fs.existsSync(filePath)) {
    memoryCache = {
      users: [],
      reels: [],
      categories: [],
    };
    writeLocalDb(memoryCache);
    return memoryCache;
  }

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<LocalDbSchema>;
    memoryCache = {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      reels: Array.isArray(parsed.reels) ? parsed.reels : [],
      categories: Array.isArray(parsed.categories) ? parsed.categories : [],
    };
    return memoryCache;
  } catch (error) {
    // Never replace a damaged or unreadable database with an empty one.
    throw Object.assign(new Error(`Cannot read local database at ${filePath}. Restore it from a backup before continuing.`), { statusCode: 503, cause: error });
  }
}

export function writeLocalDb(data: LocalDbSchema): void {
  memoryCache = data;
  const filePath = getDbFilePath();
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmpPath, filePath);
}

export function mutateLocalDb<T>(mutator: (db: LocalDbSchema) => T): T {
  const db = readLocalDb();
  const result = mutator(db);
  writeLocalDb(db);
  return result;
}
