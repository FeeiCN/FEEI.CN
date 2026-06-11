export type LibraryBook = {
  bookId: string;
  title: string;
  author: string;
  cover: string;
  category: string;
  totalReadTime: number | null;
  progress: number | null;
  markedStatus: number | null;
  noteCount: number;
  bookmarkCount: number;
  reviewCount: number;
  startReadTime: number | null;
  lastReadTime: number | null;
  finishTime: number | null;
  year: number | null;
  publisher: string;
  isbn: string;
  intro: string;
};

export type LongestRead = {
  bookId: string;
  title: string;
  author: string;
  cover: string;
  readTime: number;
} | null;

export type YearlySummary = {
  year: string;
  activeDays: number;
  totalReadSeconds: number;
  booksRead: number;
  booksFinished: number;
  notesCount: number;
  longestRead: LongestRead;
};

export type Totals = {
  activeDays: number;
  totalReadSeconds: number;
  booksInLibrary: number;
  booksFinished: number;
  notesTotal: number;
  bookmarksTotal: number;
  traceableCount: number;
};

export type Collection = {
  name: string;
  bookIds: string[];
};

export type Stats = {
  exportedAt: string;
  totals: Totals;
  yearly: YearlySummary[];
  library: LibraryBook[];
  collections: Collection[];
  dateRange: {start: string; end: string} | null;
};

export type BookInfo = {
  bookId?: string;
  title?: string;
  author?: string;
  cover?: string;
  isbn?: string;
  intro?: string;
  newRatingCount?: number;
  newRating?: number;
  category?: string;
  publisher?: string;
  publishTime?: string;
};

export type BookHighlight = {
  bookmarkId?: string;
  chapterUid?: number;
  range?: string;
  markText?: string;
  totalCount?: number;
};

export type BookBestBookmarks = {
  totalCount?: number;
  items?: BookHighlight[];
};

export type BookReview = {
  reviewId?: string;
  content?: string;
  title?: string;
  star?: number;
  createTime?: number;
};

export type BookReviews = {
  totalCount?: number;
  reviews?: BookReview[];
};

export type BookChapter = {
  chapterUid: number;
  title?: string;
  wordCount?: number;
  updateTime?: number;
};

export type BookChapters = {
  chapters?: BookChapter[];
};

export type BookProgress = {
  book?: {
    progress?: number;
    chapterUid?: number;
    chapterIdx?: number;
    chapterOffset?: number;
    updateTime?: number;
    startReadingTime?: number;
    readingTime?: number;
  };
};
