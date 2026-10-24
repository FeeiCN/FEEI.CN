import React, {type ReactNode} from 'react';
import clsx from 'clsx';
import {translate} from '@docusaurus/Translate';
import type {Props} from '@theme/DocSidebar/Desktop/CollapseButton';
import SidebarIcon from '@site/src/components/SidebarIcon';
import styles from './styles.module.css';

export default function CollapseButton({onClick}: Props): ReactNode {
  const label = translate({
    id: 'theme.docs.sidebar.collapseButtonTitle',
    message: 'Collapse sidebar',
    description: 'The title attribute for collapse button of doc sidebar',
  });

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-expanded
      className={clsx(
        'docRailToggle',
        styles.collapseSidebarButton,
      )}
      onClick={onClick}>
      <SidebarIcon
        icon="arrow-big-left-dash-icon"
        disableHover
        className={styles.collapseSidebarButtonIcon}
      />
    </button>
  );
}
