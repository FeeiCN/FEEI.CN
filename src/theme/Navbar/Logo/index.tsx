import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import {useColorMode} from '@docusaurus/theme-common';
import ShinyText from '@site/src/components/ShinyText';
import styles from './styles.module.css';

export default function NavbarLogo() {
  const homeUrl = useBaseUrl('/');
  const {colorMode} = useColorMode();
  const isLight = colorMode === 'light';

  return (
    <Link to={homeUrl} className={styles.logoLink} aria-label="FEEI 首页">
      <ShinyText
        text="FEEI"
        speed={4}
        color={isLight ? '#111111' : '#555555'}
        shineColor={isLight ? '#888888' : '#ffffff'}
        spread={120}
        className={styles.logoText}
        style={{WebkitTextStroke: isLight ? '2.5px #111111' : '2.5px #888888'}}
      />
    </Link>
  );
}
