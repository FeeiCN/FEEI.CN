import type {ReactNode} from 'react';
import ImageLightbox from '@site/src/components/ImageLightbox';

export default function Root({children}: {children: ReactNode}) {
  return (
    <>
      {children}
      <ImageLightbox />
    </>
  );
}
