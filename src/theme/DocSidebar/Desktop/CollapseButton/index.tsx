import React, {type ReactNode} from 'react';
import clsx from 'clsx';
import {translate} from '@docusaurus/Translate';
import type {Props} from '@theme/DocSidebar/Desktop/CollapseButton';
import ArrowBigLeftDashIcon from '@site/src/components/ItsHoverIcon/icons/arrow-big-left-dash-icon';
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
      className={clsx(
        'button button--secondary button--outline',
        styles.collapseSidebarButton,
      )}
      onClick={onClick}>
      <ArrowBigLeftDashIcon
        className={styles.collapseSidebarButtonIcon}
        size={16}
        strokeWidth={1.8}
      />
    </button>
  );
}
