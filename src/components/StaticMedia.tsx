import React, {type ComponentProps} from 'react';
import {staticAssetSrcSet, staticAssetUrl} from '@site/src/utils/staticAssets';

export function StaticVideo(props: ComponentProps<'video'>) {
  return <video {...props} src={staticAssetUrl(props.src)} poster={staticAssetUrl(props.poster)} />;
}

export function StaticAudio(props: ComponentProps<'audio'>) {
  return <audio {...props} src={staticAssetUrl(props.src)} />;
}

export function StaticSource(props: ComponentProps<'source'>) {
  return <source {...props} src={staticAssetUrl(props.src)} srcSet={staticAssetSrcSet(props.srcSet)} />;
}
