import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import {useThemeConfig} from '@docusaurus/theme-common';
import type {Props} from '@theme/Logo';
import ShinyText from '@site/src/components/ShinyText';

export default function Logo({className, imageClassName, titleClassName, ...rest}: Props) {
  const {navbar: {logo}} = useThemeConfig();
  const logoLink = useBaseUrl(logo?.href || '/');

  return (
    <Link to={logoLink} className={className} {...rest}>
      <div className={imageClassName}>
        <ShinyText
          text="FEEI"
          speed={3}
          color="#888888"
          shineColor="#ffffff"
          spread={90}
          style={{fontSize: '1.1rem', fontWeight: 700, letterSpacing: '0.08em'}}
        />
      </div>
    </Link>
  );
}
