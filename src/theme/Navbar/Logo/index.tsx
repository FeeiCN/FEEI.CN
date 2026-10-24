import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import styles from './styles.module.css';

export default function NavbarLogo() {
  const homeUrl = useBaseUrl('/');

  return (
    <Link to={homeUrl} className={styles.logoLink} aria-label="FEEI 首页">
      <span className={styles.logoText}>
        FEEI
      </span>
    </Link>
  );
}
