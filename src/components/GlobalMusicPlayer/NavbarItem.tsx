import BrowserOnly from '@docusaurus/BrowserOnly';
import GlobalMusicPlayerClient from './Client';

export default function MusicPlayerNavbarItem() {
  return <BrowserOnly fallback={null}>{() => <GlobalMusicPlayerClient />}</BrowserOnly>;
}
