import BrowserOnly from '@docusaurus/BrowserOnly';
import GlobalMusicPlayerClient from './Client';

export default function MusicPlayerNavbarItem({mobile}: {mobile?: boolean}) {
  if (mobile) return null;
  return <BrowserOnly fallback={null}>{() => <GlobalMusicPlayerClient />}</BrowserOnly>;
}
