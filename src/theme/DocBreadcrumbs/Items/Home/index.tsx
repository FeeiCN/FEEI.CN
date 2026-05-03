import React, {type ReactNode} from 'react';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import {translate} from '@docusaurus/Translate';
import SidebarIcon from '@site/src/components/SidebarIcon';

import styles from './styles.module.css';

export default function HomeBreadcrumbItem(): ReactNode {
  const homeHref = useBaseUrl('/');

  return (
    <li className="breadcrumbs__item">
      <Link
        aria-label={translate({
          id: 'theme.docs.breadcrumbs.home',
          message: 'Home page',
          description: 'The ARIA label for the home page in the breadcrumbs',
        })}
        className="breadcrumbs__link"
        href={homeHref}>
        <SidebarIcon icon="house" className={styles.breadcrumbHomeIcon} />
      </Link>
    </li>
  );
}
