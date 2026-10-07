import {ChakraProvider} from '@chakra-ui/react';
import {feeiSystem} from '@site/src/components/ui/system';
import BrowserOnly from '@docusaurus/BrowserOnly';
import type {ReactNode} from 'react';
import GlobalMusicPlayerClient from '@site/src/components/GlobalMusicPlayer/Client';
import ImageLightbox from '@site/src/components/ImageLightbox';

export default function Root({children}: {children: ReactNode}) {
  return (
    <ChakraProvider value={feeiSystem}>
      {children}
      <BrowserOnly fallback={null}>
        {() => <GlobalMusicPlayerClient />}
      </BrowserOnly>
      <ImageLightbox />
    </ChakraProvider>
  );
}
