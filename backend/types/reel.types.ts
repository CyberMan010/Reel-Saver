export type ReelStatus = "PENDING" | "EXTRACTING" | "SUMMARIZING" | "DONE" | "FAILED";

export interface Reel {
  id: string;
  userId: string;
  sourceUrl: string;
  authorHandle: string | null;
  caption: string | null;
  thumbnailUrl: string | null;
  transcript: string | null;
  summary: string | null;
  keyPoints: string[];
  status: ReelStatus;
  errorMessage: string | null;
  categoryId: string | null;
  createdAt: string;
  processedAt: string | null;
}

export interface Category {
  id: string;
  name: string;
  userId: string;
  createdAt: string;
}

export interface CreateReelBody {
  sourceUrl: string;
}

export interface ListReelsQuery {
  status?: ReelStatus;
  categoryId?: string;
}

export interface ReelWithCategory extends Reel {
  category?: Pick<Category, "id" | "name"> | null;
}
