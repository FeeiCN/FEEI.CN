import {useCallback, useEffect, useRef, useState} from 'react';
import type {TouchEvent} from 'react';
import justifiedLayout from 'justified-layout';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
} from '@site/src/components/ItsHoverIcon';

type LightboxImage = {
  src: string;
  alt: string;
  caption: string;
};

type ImageMetrics = {
  lightRatio: number;
  darkRatio: number;
  averageSaturation: number;
};

function imageFromElement(image: HTMLImageElement): LightboxImage {
  return {
    src: image.currentSrc || image.src,
    alt: image.alt || '',
    caption: image.dataset.caption || image.alt || '',
  };
}

function getImageMetrics(image: HTMLImageElement): ImageMetrics | null {
  const canvas = document.createElement('canvas');
  const size = 48;
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext('2d', {willReadFrequently: true});
  if (!context) {
    return null;
  }

  try {
    context.drawImage(image, 0, 0, size, size);
    const pixels = context.getImageData(0, 0, size, size).data;
    let light = 0;
    let dark = 0;
    let saturation = 0;
    const total = size * size;

    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      const max = Math.max(red, green, blue);
      const min = Math.min(red, green, blue);
      const brightness = (red + green + blue) / 3;

      if (brightness > 235) {
        light += 1;
      }
      if (brightness < 45) {
        dark += 1;
      }
      saturation += max === 0 ? 0 : (max - min) / max;
    }

    return {
      lightRatio: light / total,
      darkRatio: dark / total,
      averageSaturation: saturation / total,
    };
  } catch {
    return null;
  }
}

function updateImageGroupType(group: Element) {
  if (!group.matches('p')) {
    return;
  }

  const images = Array.from(group.querySelectorAll(':scope > img'));
  if (images.length <= 1) {
    return;
  }

  const enough = Math.max(2, images.length / 2);
  const count = (className: string) => images.filter((item) => item.classList.contains(className)).length;

  group.classList.toggle('markdownImageGroup--posters', count('markdownImage--poster') >= enough);
  group.classList.toggle('markdownImageGroup--documents', count('markdownImage--document') >= enough);
  group.classList.toggle('markdownImageGroup--cards', count('markdownImage--card') >= enough);
  group.classList.toggle('markdownImageGroup--appSnapshots', count('markdownImage--appSnapshot') >= enough);
  group.classList.toggle('markdownImageGroup--wideScreenshots', count('markdownImage--wideScreenshot') >= enough);
}

// Store original image order per paragraph for resize recalculation
const justifiedImages = new WeakMap<HTMLElement, HTMLImageElement[]>();

function applyJustifiedLayout(paragraph: HTMLElement, images: HTMLImageElement[]) {
  const containerWidth = paragraph.offsetWidth;
  if (!containerWidth || images.length < 2) return;

  const dimensions = images.map(img => ({
    width: parseInt(img.getAttribute('width') ?? '0') || img.naturalWidth,
    height: parseInt(img.getAttribute('height') ?? '0') || img.naturalHeight,
  }));

  if (dimensions.some(d => !d.width || !d.height)) return;

  const isMobile = containerWidth < 640;
  const spacing = isMobile ? 4 : 6;

  const layout = justifiedLayout(dimensions, {
    containerWidth,
    targetRowHeight: isMobile ? 150 : 240,
    targetRowHeightTolerance: 0.2,
    boxSpacing: spacing,
    containerPadding: 0,
  });

  // Group boxes into rows by top position
  const rowMap = new Map<number, Array<{box: typeof layout.boxes[0]; img: HTMLImageElement}>>();
  layout.boxes.forEach((box, i) => {
    const rowKey = Math.round(box.top);
    if (!rowMap.has(rowKey)) rowMap.set(rowKey, []);
    rowMap.get(rowKey)!.push({box, img: images[i]});
  });

  // Rebuild paragraph with row structure
  while (paragraph.firstChild) paragraph.removeChild(paragraph.firstChild);
  paragraph.dataset.justified = 'true';
  paragraph.style.display = 'flex';
  paragraph.style.flexDirection = 'column';
  paragraph.style.gap = `${spacing}px`;

  for (const [, items] of [...rowMap.entries()].sort((a, b) => a[0] - b[0])) {
    const row = document.createElement('div');
    row.className = 'justifiedImageRow';
    row.style.display = 'flex';
    row.style.gap = `${spacing}px`;

    items.forEach(({box, img}) => {
      img.style.cssText = `width:${box.width}px;height:${box.height}px;display:block;object-fit:cover;flex-shrink:0;border-radius:0.5rem;`;
      row.appendChild(img);
    });

    paragraph.appendChild(row);
  }
}

function refreshJustifiedParagraph(paragraph: HTMLElement) {
  const images = justifiedImages.get(paragraph);
  if (!images) return;
  applyJustifiedLayout(paragraph, images);
}

export default function ImageLightbox() {
  const [images, setImages] = useState<LightboxImage[]>([]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [isZoomed, setIsZoomed] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const isOpen = activeIndex !== null;
  const currentIndex = activeIndex ?? 0;
  const activeImage = isOpen ? images[currentIndex] : null;

  const close = useCallback(() => {
    setActiveIndex(null);
  }, []);

  const showPrevious = useCallback(() => {
    setActiveIndex((currentIndex) => {
      if (currentIndex === null || images.length === 0) {
        return currentIndex;
      }
      return (currentIndex - 1 + images.length) % images.length;
    });
    setIsZoomed(false);
  }, [images.length]);

  const showNext = useCallback(() => {
    setActiveIndex((currentIndex) => {
      if (currentIndex === null || images.length === 0) {
        return currentIndex;
      }
      return (currentIndex + 1) % images.length;
    });
    setIsZoomed(false);
  }, [images.length]);

  useEffect(() => {
    function enhanceImage(image: HTMLImageElement) {
      if (image.dataset.lightboxEnhanced === 'true') {
        return;
      }
      image.dataset.lightboxEnhanced = 'true';
      image.loading = 'lazy';
      image.decoding = 'async';

      const caption = image.parentElement?.nextElementSibling?.textContent?.trim();
      if (caption && caption.length <= 80) {
        image.dataset.caption = caption;
      }

      function classifyLoadedImage() {
        const width = image.naturalWidth;
        const height = image.naturalHeight;
        if (!width || !height) {
          return;
        }

        const aspectRatio = width / height;
        const metrics = getImageMetrics(image);
        const lightRatio = metrics?.lightRatio ?? 0;
        const darkRatio = metrics?.darkRatio ?? 0;
        const averageSaturation = metrics?.averageSaturation ?? 1;
        const isPortrait = aspectRatio < 0.9;
        const isTallPortrait = aspectRatio < 0.68;

        const looksLikeDocument =
          isPortrait && lightRatio > 0.42 && darkRatio < 0.18 && averageSaturation < 0.24;
        const looksLikeDataCard =
          isTallPortrait && !looksLikeDocument && (darkRatio > 0.28 || averageSaturation < 0.32);
        const looksLikePoster = aspectRatio < 0.82 && !looksLikeDataCard && !looksLikeDocument;
        const looksLikeWideScreenshot =
          aspectRatio > 1.55 && (darkRatio > 0.24 || lightRatio > 0.3 || averageSaturation < 0.34);
        const looksLikeAppSnapshot =
          !looksLikeDocument &&
          !looksLikeDataCard &&
          !looksLikePoster &&
          !looksLikeWideScreenshot &&
          aspectRatio >= 0.75 &&
          aspectRatio <= 1.8 &&
          (lightRatio > 0.3 || darkRatio > 0.3 || averageSaturation < 0.3);
        const looksLikeScreenshot =
          aspectRatio > 1.75 ||
          looksLikeDocument ||
          looksLikeDataCard ||
          looksLikeAppSnapshot ||
          looksLikeWideScreenshot;

        image.classList.toggle('markdownImage--screenshot', looksLikeScreenshot);
        image.classList.toggle('markdownImage--wideScreenshot', looksLikeWideScreenshot && looksLikeScreenshot);
        image.classList.toggle('markdownImage--document', looksLikeDocument);
        image.classList.toggle('markdownImage--card', looksLikeDataCard);
        image.classList.toggle('markdownImage--appSnapshot', looksLikeAppSnapshot);
        image.classList.toggle('markdownImage--poster', looksLikePoster && !looksLikeScreenshot);
        image.classList.toggle(
          'markdownImage--photo',
          !looksLikeScreenshot && !looksLikePoster && !looksLikeDataCard && !looksLikeAppSnapshot,
        );

        const group = image.parentElement;
        if (group) {
          updateImageGroupType(group);
        }
      }

      if (image.complete) {
        const idle = (window as Window & {requestIdleCallback?: (cb: () => void) => void}).requestIdleCallback;
        if (idle) {
          idle(classifyLoadedImage);
        } else {
          setTimeout(classifyLoadedImage, 0);
        }
      } else {
        image.addEventListener('load', classifyLoadedImage, {once: true});
      }
    }

    function enhanceMarkdownImages() {
      document.querySelectorAll<HTMLImageElement>('.markdown img').forEach(enhanceImage);
      document.querySelectorAll<HTMLElement>('.markdown p').forEach((paragraph) => {
        // Skip already-justified paragraphs — avoid infinite loop with MutationObserver
        if (paragraph.dataset.justified) return;

        const images = Array.from(paragraph.querySelectorAll<HTMLImageElement>(':scope > img'));
        if (images.length > 1) {
          paragraph.dataset.imageCount = String(images.length);
          justifiedImages.set(paragraph, images);
          applyJustifiedLayout(paragraph, images);
          updateImageGroupType(paragraph);
        }
      });
    }

    enhanceMarkdownImages();

    const observer = new MutationObserver(enhanceMarkdownImages);
    observer.observe(document.body, {childList: true, subtree: true});

    let resizeTimer: ReturnType<typeof setTimeout>;
    const resizeObserver = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        document.querySelectorAll<HTMLElement>('.markdown p[data-justified]').forEach(refreshJustifiedParagraph);
      }, 150);
    });
    const markdownEl = document.querySelector('.markdown');
    if (markdownEl) resizeObserver.observe(markdownEl);

    function handleClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof HTMLImageElement)) {
        return;
      }

      const markdownRoot = target.closest('.markdown');
      if (!markdownRoot) {
        return;
      }

      const pageImages = Array.from(markdownRoot.querySelectorAll('img')).filter(
        (image) => image.width > 48 && image.height > 48,
      );
      const targetIndex = pageImages.indexOf(target);
      if (targetIndex < 0) {
        return;
      }

      event.preventDefault();
      setImages(pageImages.map(imageFromElement));
      setActiveIndex(targetIndex);
      setIsZoomed(false);
    }

    document.addEventListener('click', handleClick);
    return () => {
      observer.disconnect();
      resizeObserver.disconnect();
      clearTimeout(resizeTimer);
      document.removeEventListener('click', handleClick);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        close();
      }
      if (event.key === 'ArrowLeft') {
        showPrevious();
      }
      if (event.key === 'ArrowRight') {
        showNext();
      }
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [close, isOpen, showNext, showPrevious]);

  if (!activeImage) {
    return null;
  }

  const hasMultipleImages = images.length > 1;
  const imageClassName = `imageLightbox__image${isZoomed ? ' imageLightbox__image--zoomed' : ''}`;

  function handleTouchStart(event: TouchEvent) {
    const touch = event.touches[0];
    touchStartX.current = touch.clientX;
    touchStartY.current = touch.clientY;
  }

  function handleTouchEnd(event: TouchEvent) {
    if (touchStartX.current === null || touchStartY.current === null) {
      return;
    }

    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - touchStartX.current;
    const deltaY = touch.clientY - touchStartY.current;
    touchStartX.current = null;
    touchStartY.current = null;

    if (Math.abs(deltaX) < 48 || Math.abs(deltaX) < Math.abs(deltaY) * 1.2) {
      return;
    }

    if (deltaX > 0) {
      showPrevious();
    } else {
      showNext();
    }
  }

  return (
    <div
      className="imageLightbox"
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onClick={close}>
      <button className="imageLightbox__close" type="button" aria-label="关闭图片预览" onClick={close}>
        <CloseIcon size={22} />
      </button>

      {hasMultipleImages && (
        <button
          className="imageLightbox__nav imageLightbox__nav--previous"
          type="button"
          aria-label="上一张图片"
          onClick={(event) => {
            event.stopPropagation();
            showPrevious();
          }}>
          <ChevronLeftIcon size={30} />
        </button>
      )}

      <div className="imageLightbox__stage">
        <img
          className={imageClassName}
          src={activeImage.src}
          alt={activeImage.alt}
          onDoubleClick={(event) => {
            event.stopPropagation();
            setIsZoomed((value) => !value);
          }}
          onClick={(event) => event.stopPropagation()}
        />
      </div>

      {hasMultipleImages && (
        <button
          className="imageLightbox__nav imageLightbox__nav--next"
          type="button"
          aria-label="下一张图片"
          onClick={(event) => {
            event.stopPropagation();
            showNext();
          }}>
          <ChevronRightIcon size={30} />
        </button>
      )}

      {hasMultipleImages && (
        <div className="imageLightbox__counter">
          {currentIndex + 1} / {images.length}
        </div>
      )}

      {activeImage.caption && <div className="imageLightbox__caption">{activeImage.caption}</div>}
    </div>
  );
}
