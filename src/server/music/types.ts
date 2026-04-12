export type PublicMusicStatus = "queued" | "processing" | "completed" | "failed";

export type ProviderAlignedLyricWord = {
  word: string;
  start_s: number;
  end_s: number;
  success?: boolean;
  p_align?: number;
};

export type CreateMusicInput = {
  userId: string;
  title: string;
  lyrics: string;
  stylePrompt: string;
  lyricMode?: "manual" | "auto" | "ai_lyrics";
  isMr?: boolean;
  vocalGender?: "auto" | "female" | "male";
  trackCount?: 1;
  modelVersion?: "v4_5_plus" | "v5" | "v5_5";
};

export type ProviderMusicResult = {
  providerTaskId: string;
  status: PublicMusicStatus;
  mp3Url?: string;
  videoUrl?: string;
  imageUrl?: string;
  imageLargeUrl?: string;
  generatedLyrics?: string;
  providerPrompt?: string;
  providerDescriptionPrompt?: string;
  errorMessage?: string;
  tracks?: Array<{
    providerTaskId: string;
    status: PublicMusicStatus;
    mp3Url?: string;
    videoUrl?: string;
    imageUrl?: string;
    imageLargeUrl?: string;
    generatedLyrics?: string;
    providerPrompt?: string;
    providerDescriptionPrompt?: string;
  }>;
};

export type MusicTrackItem = {
  id: string;
  providerTaskId?: string | null;
  status: PublicMusicStatus;
  mp3Url?: string | null;
  mp4Url?: string | null;
  imageUrl?: string | null;
  imageLargeUrl?: string | null;
  duration?: number | string | null;
  createdAt?: string | null;
  errorMessage?: string | null;
};

export type MusicItem = {
  id: string;
  requestGroupId: string | null;
  title: string;
  status: PublicMusicStatus;
  createdAt: string;
  updatedAt?: string;
  downloadAvailableAt?: string | null;
  canListen?: boolean;
  canDownload?: boolean;
  lyrics?: string | null;
  requestLyrics?: string | null;
  generatedLyrics?: string | null;
  stylePrompt?: string | null;
  imageUrl?: string | null;
  imageLargeUrl?: string | null;
  mp3Url?: string | null;
  mp4Url?: string | null;
  provider?: string | null;
  providerTaskId?: string | null;
  videoId?: string | null;
  videoStatus?: PublicMusicStatus | null;
  canCreateVideo?: boolean;
  canDownloadVideo?: boolean;
  tags?: string | null;
  duration?: number | string | null;
  errorMessage?: string | null;
  tracks?: MusicTrackItem[];
};

export type RecentMusicItem = {
  id: string;
  title: string;
  status: "completed";
  createdAt: string;
  lyrics?: string | null;
  imageUrl: string | null;
  mp3Url: string;
  mp4Url?: string | null;
  providerTaskId?: string | null;
  tags?: string | null;
};

export type MusicListResponse = {
  items: MusicItem[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export type MusicDetailResponse = {
  item: MusicItem;
};

export type RecentMusicResponse = {
  items: RecentMusicItem[];
  meta: {
    limit: number;
    fetchedAt: string;
  };
};
