import type {ReactNode} from 'react';
import clsx from 'clsx';
import OriginalNavbarSearch from '@theme-original/Navbar/Search';
import type {Props} from '@theme/Navbar/Search';
import MusicButton from '@site/src/components/GlobalMusicPlayer/NavbarButton';
import styles from './styles.module.css';

export default function NavbarSearch(props: Props): ReactNode {
  return <>
    <OriginalNavbarSearch {...props} className={clsx(props.className, styles.search)} />
    <MusicButton />
  </>;
}
