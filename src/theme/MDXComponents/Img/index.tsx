import React, {type ReactNode} from 'react';
import clsx from 'clsx';
import type {Props} from '@theme/MDXComponents/Img';
import styles from '@docusaurus/theme-classic/lib/theme/MDXComponents/Img/styles.module.css';

function transformImgClassName(className?: string): string {
  return clsx(className, styles.img);
}

export default function MDXImg(props: Props): ReactNode {
  const {className, loading, title, ...rest} = props;
  const eager = loading === 'eager';
  const caption = typeof title === 'string' ? title.trim() : undefined;
  const image = (
    <span className="markdownImageFrame markdownImageFrame--loading">
      <span className="markdownImageSkeleton" aria-hidden="true" />
      {/* eslint-disable-next-line jsx-a11y/alt-text */}
      <img
        decoding="async"
        loading={eager ? 'eager' : 'lazy'}
        fetchPriority={eager ? 'high' : undefined}
        {...rest}
        className={transformImgClassName(className)}
      />
    </span>
  );

  if (!caption) {
    return image;
  }

  return (
    <span className="markdownImageBlock">
      {image}
      {caption ? <span className="markdownImageCaption">{caption}</span> : null}
    </span>
  );
}
