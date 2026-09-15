import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import {useColorMode} from '@docusaurus/theme-common';
import styles from './styles.module.css';

export default function NavbarLogo() {
  const homeUrl = useBaseUrl('/');
  const {colorMode} = useColorMode();
  const isLight = colorMode === 'light';

  return (
    <Link to={homeUrl} className={styles.logoLink} aria-label="FEEI 首页">
      <span
        className={styles.logoText}
        style={{
          color: isLight ? '#111111' : '#9ca3af',
          WebkitTextStroke: isLight ? '0.75px #111111' : '0.75px #9ca3af',
        }}
      >
        FEEI
      </span>
    </Link>
  );
}
