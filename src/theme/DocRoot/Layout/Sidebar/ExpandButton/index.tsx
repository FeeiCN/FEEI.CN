import React, {type ReactNode, useEffect, useRef} from 'react';
import {translate} from '@docusaurus/Translate';
import type {Props} from '@theme/DocRoot/Layout/Sidebar/ExpandButton';
import SidebarIcon from '@site/src/components/SidebarIcon';

import styles from './styles.module.css';

export default function DocRootLayoutSidebarExpandButton({
  toggleSidebar,
}: Props): ReactNode {
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => buttonRef.current?.focus({preventScroll: true}), []);
  const title = translate({
    id: 'theme.docs.sidebar.expandButtonTitle',
    message: 'Expand sidebar',
    description: 'The ARIA label and title attribute for expand button of doc sidebar',
  });

  return (
    <button
      ref={buttonRef}
      type="button"
      className={`docRailToggle ${styles.expandButton}`}
      title={title}
      aria-label={title}
      aria-expanded={false}
      onClick={(event) => {
        const sidebar = event.currentTarget.closest('.theme-doc-sidebar-container');
        toggleSidebar();
        requestAnimationFrame(() => {
          sidebar?.querySelector<HTMLButtonElement>('.docRailToggle[aria-expanded="true"]')?.focus({preventScroll: true});
        });
      }}>
      <SidebarIcon icon="arrow-big-left-dash-icon" className={styles.expandButtonIcon} disableHover />
    </button>
  );
}
