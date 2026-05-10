import type {ReactNode} from 'react';
import GlobalMusicPlayer from '@site/src/components/GlobalMusicPlayer';
import ImageLightbox from '@site/src/components/ImageLightbox';

export default function Root({children}: {children: ReactNode}) {
  return (
    <>
      {children}
      <GlobalMusicPlayer />
      <ImageLightbox />
    </>
  );
}
