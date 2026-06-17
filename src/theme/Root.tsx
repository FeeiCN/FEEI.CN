import BrowserOnly from '@docusaurus/BrowserOnly';
import type {ReactNode} from 'react';
import GlobalMusicPlayerClient from '@site/src/components/GlobalMusicPlayer/Client';
import ImageLightbox from '@site/src/components/ImageLightbox';

export default function Root({children}: {children: ReactNode}) {
  return (
    <>
      {children}
      <BrowserOnly fallback={null}>
        {() => <GlobalMusicPlayerClient renderGroupSwitcher={false} />}
      </BrowserOnly>
      <ImageLightbox />
    </>
  );
}
