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
  width?: unknown;
  height?: unknown;
};

type AlbumPhoto = {
  src: string;
  width: number;
  height: number;
  alt: string;
};

const MEDIA_ORIGIN = 'https://feei.cn';

function dateFromFrontMatter(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/^\/(\d{4})-(\d{2})-(\d{2})\/?$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function photoUrl(value: string, year: string, month: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^https:\/\/feei\.cn\/media\//.test(trimmed)) return trimmed;
  if (/^\/media\//.test(trimmed)) return `${MEDIA_ORIGIN}${trimmed}`;
  if (/^[^/\\?#]+\.(?:webp|jpe?g|png|gif)$/i.test(trimmed)) {
    return `${MEDIA_ORIGIN}/media/${year}/${month}/${encodeURIComponent(trimmed)}`;
  }
  return null;
}

function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export default function DailyRecordPhotos() {
  const {frontMatter} = useDoc();
  const date = dateFromFrontMatter((frontMatter as Record<string, unknown>).slug);
  const [photos, setPhotos] = useState<AlbumPhoto[]>([]);

  useEffect(() => {
    setPhotos([]);
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
              ? {value, width: positiveNumber(photo.width), height: positiveNumber(photo.height)}
              : null;
          })
          .filter((value): value is {value: string; width: number | null; height: number | null} => Boolean(value))
          .map((entry) => ({
            ...entry,
            src: photoUrl(entry.value, year, month),
          }))
          .filter((entry): entry is {value: string; width: number | null; height: number | null; src: string} => Boolean(entry.src));
        const uniquePhotos = [...new Map(candidates.map((entry) => [entry.src, entry])).values()];
        Promise.all(uniquePhotos.map((photo) => {
          if (photo.width && photo.height) {
            return Promise.resolve({src: photo.src, width: photo.width, height: photo.height, alt: ''});
          }

          return new Promise<AlbumPhoto>((resolve) => {
            const image = new Image();
            image.onload = () => resolve({
              src: photo.src,
              width: image.naturalWidth || 4,
              height: image.naturalHeight || 3,
              alt: '',
            });
            image.onerror = () => resolve({src: photo.src, width: 4, height: 3, alt: ''});
            image.src = photo.src;
          });
        })).then(setPhotos);
      })
      .catch(() => {});

    return () => controller.abort();
  }, [date]);

  if (photos.length === 0) return null;

  return (
    <div className="dailyRecordPhotos">
      <RowsPhotoAlbum
        photos={photos}
        targetRowHeight={220}
        spacing={4}
        rowConstraints={{singleRowMaxHeight: 360}}
        componentsProps={{image: {decoding: 'async'}}}
        render={{
          image: (props, {index}) => (
            <img
              {...props}
              loading={index < 2 ? 'eager' : 'lazy'}
              fetchPriority={index === 0 ? 'high' : 'auto'}
              style={{
                ...props.style,
                backgroundColor: 'var(--ifm-color-emphasis-200)',
              }}
            />
          ),
        }}
      />
    </div>
  );
}
