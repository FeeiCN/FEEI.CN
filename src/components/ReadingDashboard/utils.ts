export function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return '0';
  if (seconds < 60) return `${seconds}秒`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return s ? `${m}分${s}秒` : `${m}分钟`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}小时${rm}分` : `${h}小时`;
}

export function formatDurationLong(seconds: number): string {
  if (!seconds || seconds < 0) return '0 分钟';
  if (seconds < 60) return `${seconds} 秒`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h} 小时 ${rm} 分` : `${h} 小时`;
}

export function formatRelativeTime(ts: number | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  const now = Date.now();
  const diffMs = now - d.getTime();
  if (diffMs < 0) return d.toLocaleDateString('zh-CN');
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) {
    const diffH = Math.floor(diffMs / 3600000);
    if (diffH === 0) {
      const diffM = Math.max(1, Math.floor(diffMs / 60000));
      return `${diffM} 分钟前`;
    }
    return `${diffH} 小时前`;
  }
  if (diffDays === 1) return '昨天';
  if (diffDays < 7) return `${diffDays} 天前`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} 周前`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} 个月前`;
  return d.toLocaleDateString('zh-CN');
}

export function formatDateOnly(ts: number | null | undefined): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleDateString('zh-CN');
}

export function ratingDisplay(
  newRating?: number,
  count?: number,
): {score: string; outOf5: number; count: number} | null {
  if (!count || !newRating) return null;
  // weread newRating 是 0-1000 标度（= rating×100），按 10 分制显示，除 2 换算成 5 星
  const safe = Math.max(0, Math.min(1000, newRating));
  const outOf10 = safe / 100;
  const outOf5 = outOf10 / 2;
  return {
    score: outOf10.toFixed(1),
    outOf5,
    count,
  };
}

export function safeRepeat(ch: string, n: number): string {
  const safe = Math.max(0, Math.floor(n));
  return ch.repeat(safe);
}

export function shortAuthor(author: string): string {
  if (!author) return '';
  return author.length > 30 ? `${author.slice(0, 28)}…` : author;
}

export function humanizeDays(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return '今天';
  if (days === 1) return '1 天前';
  return `${days} 天前`;
}

export function isStale(iso: string | undefined, thresholdDays = 7): boolean {
  if (!iso) return false;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return days > thresholdDays;
}
