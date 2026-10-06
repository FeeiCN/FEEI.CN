export type RecordMetrics = {characters: number; images: number; videos: number};

export function measureRecord(markdown: string): RecordMetrics {
  const body = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
  const images = (body.match(/!\[[^\]]*\]\([^)]*\)|<img\b/gi) || []).length;
  const videos = (body.match(/<video\b/gi) || []).length;
  const text = body.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/^\s*(?:import|export)\b.*$/gm, '')
    .replace(/https?:\/\/\S+/g, '');
  return {characters: (text.match(/[\p{L}\p{N}]/gu) || []).length, images, videos};
}

export function measureMedia(values: unknown): Pick<RecordMetrics, 'images' | 'videos'> {
  const entries = Array.isArray(values) ? values
    : values && typeof values === 'object' && 'files' in values && Array.isArray(values.files) ? values.files : [];
  const unique = new Map<string, boolean>();
  for (const entry of entries) {
    const value = typeof entry === 'string' ? entry : entry?.url ?? entry?.name;
    if (typeof value !== 'string') continue;
    const path = value.replace(/^https:\/\/feei\.cn/, '').split(/[?#]/)[0];
    if (!/\.(webp|jpe?g|png|gif|mp4|webm|mov)$/i.test(path) || /-poster\.webp$/i.test(path)) continue;
    unique.set(path.split('/').pop()!, entry?.type === 'video' || /\.(mp4|webm|mov)$/i.test(path));
  }
  const videos = [...unique.values()].filter(Boolean).length;
  return {images: unique.size - videos, videos};
}

export function intensityLevel(metrics: RecordMetrics): number {
  const score = metrics.characters + metrics.images * 100 + metrics.videos * 300;
  return score < 300 ? 1 : score < 800 ? 2 : score < 1600 ? 3 : 4;
}
