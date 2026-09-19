import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import {useThemeConfig, type NavbarLogo} from '@docusaurus/theme-common';
import ThemedImage from '@theme/ThemedImage';
import type {Props} from '@theme/Logo';

function LogoImage({
  logo,
  alt,
  imageClassName,
}: {
  logo: NavbarLogo;
  alt: string;
  imageClassName?: string;
}) {
  const image = (
    <ThemedImage
      className={logo.className}
      sources={{
        light: useBaseUrl(logo.src),
        dark: useBaseUrl(logo.srcDark || logo.src),
      }}
      height={logo.height}
      width={logo.width}
      alt={alt}
      style={logo.style}
    />
  );

  return imageClassName ? <div className={imageClassName}>{image}</div> : image;
}

export default function Logo(props: Props): ReactNode {
  const {
    siteConfig: {title},
  } = useDocusaurusContext();
  const {
    navbar: {title: navbarTitle, logo},
  } = useThemeConfig();
  const {imageClassName, titleClassName, ...linkProps} = props;
  const logoLink = useBaseUrl(logo?.href || '/');
  const alt = logo?.alt ?? (navbarTitle ? '' : title);

  return (
    <Link
      to={logoLink}
      {...linkProps}
      {...(logo?.target && {target: logo.target})}
    >
      {logo ? <LogoImage logo={logo} alt={alt} imageClassName={imageClassName} /> : null}
      {navbarTitle != null ? <b className={titleClassName}>{navbarTitle}</b> : null}
    </Link>
  );
}
