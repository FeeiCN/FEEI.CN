import {useEffect, useState} from 'react';
import {useDoc} from '@docusaurus/plugin-content-docs/client';
import {RowsPhotoAlbum} from 'react-photo-album';
import 'react-photo-album/rows.css';

type PhotoIndex = {
  month?: string;
  days?: Record<string, unknown>;
};

type PhotoEntry = {
  name?: unknown;
  url?: unknown;
  type?: unknown;
  width?: unknown;
  height?: unknown;
};

type AlbumMedia = {
  src: string;
  width: number;
  height: number;
  alt: string;
  mediaType: 'photo' | 'video';
};

const MEDIA_ORIGIN = 'https://feei.cn';

function dateFromFrontMatter(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/^\/(\d{4})-(\d{2})-(\d{2})\/?$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function mediaUrl(value: string, year: string, month: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^https:\/\/feei\.cn\/media\//.test(trimmed)) return trimmed;
  if (/^\/media\//.test(trimmed)) return `${MEDIA_ORIGIN}${trimmed}`;
  if (/^[^/\\?#]+\.(?:webp|jpe?g|png|gif|mp4|webm|mov)$/i.test(trimmed)) {
    return `${MEDIA_ORIGIN}/media/${year}/${month}/${encodeURIComponent(trimmed)}`;
  }
  return null;
}

function isVideoUrl(value: string): boolean {
  return /\.(?:mp4|webm|mov)$/i.test(value.split(/[?#]/, 1)[0]);
}

function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export default function DailyRecordPhotos() {
  const {frontMatter} = useDoc();
  const date = dateFromFrontMatter((frontMatter as Record<string, unknown>).slug);
  const [media, setMedia] = useState<AlbumMedia[]>([]);

  useEffect(() => {
    setMedia([]);
    if (!date) return;

    const [year, month] = date.split('-');
    const controller = new AbortController();
    fetch(`${MEDIA_ORIGIN}/media/${year}/${month}/index.json`, {signal: controller.signal})
      .then((response) => (response.ok ? response.json() as Promise<PhotoIndex> : null))
      .then((index) => {
        const values = index?.days?.[date];
        const entries: unknown[] = Array.isArray(values)
          ? values
          : values && typeof values === 'object' && Array.isArray((values as {files?: unknown[]}).files)
            ? (values as {files: unknown[]}).files
            : [];

        const candidates = entries
          .map((entry) => {
            if (typeof entry === 'string') return {value: entry, width: null, height: null};
            if (!entry || typeof entry !== 'object') return null;
            const photo = entry as PhotoEntry;
            const value = typeof photo.url === 'string' ? photo.url : photo.name;
            return typeof value === 'string'
              ? {
                  value,
                  width: positiveNumber(photo.width),
                  height: positiveNumber(photo.height),
                  mediaType: photo.type === 'video' || isVideoUrl(value) ? 'video' : 'photo',
                }
              : null;
          })
          .filter((value): value is {
            value: string;
            width: number | null;
            height: number | null;
            mediaType: 'photo' | 'video';
          } => Boolean(value))
          .map((entry) => ({
            ...entry,
            src: mediaUrl(entry.value, year, month),
          }))
          .filter((entry): entry is {
            value: string;
            width: number | null;
            height: number | null;
            mediaType: 'photo' | 'video';
            src: string;
          } => Boolean(entry.src));
        const uniqueMedia = [...new Map(candidates.map((entry) => [entry.src, entry])).values()];
        Promise.all(uniqueMedia.map((item) => {
          if (item.mediaType === 'video' || (item.width && item.height)) {
            return Promise.resolve({
              src: item.src,
              width: item.width || 4,
              height: item.height || 3,
              alt: '',
              mediaType: item.mediaType,
            } satisfies AlbumMedia);
          }

          return new Promise<AlbumMedia>((resolve) => {
            const image = new Image();
            image.onload = () => resolve({
              src: item.src,
              width: image.naturalWidth || 4,
              height: image.naturalHeight || 3,
              alt: '',
              mediaType: 'photo',
            });
            image.onerror = () => resolve({
              src: item.src,
              width: 4,
              height: 3,
              alt: '',
              mediaType: 'photo',
            });
            image.src = item.src;
          });
        })).then(setMedia);
      })
      .catch(() => {});

    return () => controller.abort();
  }, [date]);

  if (media.length === 0) return null;

  return (
    <div className="dailyRecordPhotos">
      <RowsPhotoAlbum
        photos={media}
        targetRowHeight={220}
        spacing={4}
        rowConstraints={{singleRowMaxHeight: 360}}
        componentsProps={{image: {decoding: 'async'}}}
        render={{
          photo: ({onClick}, {photo, index, width}) => (
            <div
              className="react-photo-album--photo"
              style={{width: `${width}px`, padding: 0, flexShrink: 0}}
              onClick={onClick}
            >
              {photo.mediaType === 'video' ? (
                <video
                  className="dailyRecordVideo"
                  src={photo.src}
                  controls
                  preload="metadata"
                  playsInline
                  style={{width: '100%', aspectRatio: `${photo.width} / ${photo.height}`}}
                />
              ) : (
                <img
                  src={photo.src}
                  alt={photo.alt}
                  loading={index < 2 ? 'eager' : 'lazy'}
                  decoding="async"
                  fetchPriority={index === 0 ? 'high' : 'auto'}
                  style={{
                    width: '100%',
                    height: 'auto',
                    display: 'block',
                    backgroundColor: 'var(--ifm-color-emphasis-200)',
                  }}
                />
              )}
            </div>
          ),
        }}
      />
    </div>
  );
}
