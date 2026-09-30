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

type MediaPhase = 'loading' | 'ready' | 'empty' | 'error';
type ItemPhase = 'loading' | 'loaded' | 'error';

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
  const [phase, setPhase] = useState<MediaPhase>(date ? 'loading' : 'empty');
  const [media, setMedia] = useState<AlbumMedia[]>([]);
  const [itemPhases, setItemPhases] = useState<Record<string, ItemPhase>>({});
  const [itemRetries, setItemRetries] = useState<Record<string, number>>({});
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    if (!date) {
      setPhase('empty');
      setMedia([]);
      setItemPhases({});
      setItemRetries({});
      return;
    }

    setPhase('loading');
    setMedia([]);
    setItemPhases({});
    setItemRetries({});

    const [year, month] = date.split('-');
    const controller = new AbortController();
    let active = true;

    fetch(`${MEDIA_ORIGIN}/media/${year}/${month}/index.json`, {signal: controller.signal})
      .then((response) => {
        if (!response.ok) throw new Error(`media index request failed (${response.status})`);
        return response.json() as Promise<PhotoIndex>;
      })
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
        const nextMedia = uniqueMedia.map((item) => ({
          src: item.src,
          width: item.width || 4,
          height: item.height || 3,
          alt: '',
          mediaType: item.mediaType,
        } satisfies AlbumMedia));

        if (!active) return;
        if (nextMedia.length === 0) {
          setPhase('empty');
          setMedia([]);
          return;
        }

        setMedia(nextMedia);
        setItemPhases(Object.fromEntries(nextMedia.map((item) => [item.src, 'loading' as ItemPhase])));
        setPhase('ready');
      })
      .catch(() => {
        if (!active || controller.signal.aborted) return;
        setPhase('error');
        setMedia([]);
        setItemPhases({});
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [date, retryToken]);

  if (!date) return null;

  const retryMedia = (src: string) => {
    setItemPhases((current) => ({...current, [src]: 'loading'}));
    setItemRetries((current) => ({...current, [src]: (current[src] ?? 0) + 1}));
  };

  const markMediaLoaded = (src: string) => {
    setItemPhases((current) => ({...current, [src]: 'loaded'}));
  };

  const markMediaError = (src: string) => {
    setItemPhases((current) => ({...current, [src]: 'error'}));
  };

  const updatePhotoDimensions = (src: string, width: number, height: number) => {
    if (!width || !height) return;
    setMedia((current) => current.map((item) => item.src === src ? {...item, width, height} : item));
  };

  if (phase === 'loading') {
    return (
      <div className="dailyRecordPhotos dailyRecordPhotos--status" role="status" aria-live="polite" aria-busy="true">
        <span>照片和视频加载中…</span>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="dailyRecordPhotos dailyRecordPhotos--status" role="alert">
        <span>照片和视频暂时无法加载</span>
        <button type="button" onClick={() => setRetryToken((value) => value + 1)}>重试</button>
      </div>
    );
  }

  if (phase === 'empty') {
    return (
      <div className="dailyRecordPhotos dailyRecordPhotos--status" role="status">
        <span>这一天没有照片或视频</span>
      </div>
    );
  }

  const photoCount = media.filter((item) => item.mediaType === 'photo').length;
  const videoCount = media.length - photoCount;
  const mediaLabel = photoCount > 0 && videoCount > 0 ? '照片和视频' : photoCount > 0 ? '照片' : '视频';

  return (
    <div className="dailyRecordPhotos">
      <div className="dailyRecordPhotos__heading" aria-label={`${mediaLabel}，共 ${media.length} 项`}>
        ${mediaLabel}（${media.length}）
      </div>
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
              <div
                className={`dailyRecordMediaFrame dailyRecordMediaFrame--${itemPhases[photo.src] ?? 'loading'}`}
                style={{aspectRatio: `${photo.width} / ${photo.height}`}}
              >
                {photo.mediaType === 'video' ? (
                  <video
                    key={`${photo.src}:${itemRetries[photo.src] ?? 0}`}
                    className="dailyRecordVideo"
                    src={photo.src}
                    controls
                    preload="metadata"
                    playsInline
                    onLoadedMetadata={(event) => {
                      const video = event.currentTarget;
                      updatePhotoDimensions(photo.src, video.videoWidth, video.videoHeight);
                      markMediaLoaded(photo.src);
                    }}
                    onError={() => markMediaError(photo.src)}
                  />
                ) : (
                  <img
                    key={`${photo.src}:${itemRetries[photo.src] ?? 0}`}
                    className="react-photo-album--image"
                    src={photo.src}
                    alt={photo.alt}
                    loading={index < 2 ? 'eager' : 'lazy'}
                    decoding="async"
                    fetchPriority={index === 0 ? 'high' : 'auto'}
                    onLoad={(event) => {
                      const image = event.currentTarget;
                      updatePhotoDimensions(photo.src, image.naturalWidth, image.naturalHeight);
                      markMediaLoaded(photo.src);
                    }}
                    onError={() => markMediaError(photo.src)}
                  />
                )}
                {itemPhases[photo.src] === 'loading' ? (
                  <span className="dailyRecordMediaMessage" role="status">加载中…</span>
                ) : null}
                {itemPhases[photo.src] === 'error' ? (
                  <button
                    className="dailyRecordMediaMessage dailyRecordMediaMessage--error"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      retryMedia(photo.src);
                    }}
                  >
                    加载失败，重试
                  </button>
                ) : null}
              </div>
            </div>
          ),
        }}
      />
    </div>
  );
}
