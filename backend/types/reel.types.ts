export type ReelStatus =
  | "PENDING"
  | "EXTRACTING"
  | "TRANSCRIBING"
  | "SUMMARIZING"
  | "DONE"
  | "FAILED";

export interface Reel {
  id: string;
  userId: string;
  sourceUrl: string;
  title: string | null;
  authorHandle: string | null;
  caption: string | null;
  thumbnailUrl: string | null;
  transcript: string | null;
  summary: string | null;
  keyPoints: string[];
  notes: string | null;
  audioUrl: string | null;
  audioDurationSec: number | null;
  transcriptionSource: string | null;
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

export interface CategoryWithCount extends Category {
  reelCount: number;
}

export interface CreateReelBody {
  sourceUrl?: string;
  title?: string;
  authorHandle?: string;
  caption?: string;
  thumbnailUrl?: string;
  transcript?: string;
  notes?: string;
  categoryName?: string;
}

export interface UpdateReelBody {
  title?: string | null;
  authorHandle?: string | null;
  caption?: string | null;
  thumbnailUrl?: string | null;
  transcript?: string | null;
  summary?: string | null;
  keyPoints?: string[];
  notes?: string | null;
  categoryName?: string | null;
  categoryId?: string | null;
  resummarize?: boolean;
}

export interface ListReelsQuery {
  status?: ReelStatus;
  categoryId?: string;
  search?: string;
}

export interface ReelWithCategory extends Reel {
  category?: Pick<Category, "id" | "name"> | null;
}
