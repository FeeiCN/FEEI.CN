import React, {type ReactNode} from 'react';
import {translate} from '@docusaurus/Translate';
import type {Props} from '@theme/DocRoot/Layout/Sidebar/ExpandButton';
import ArrowBigLeftDashIcon from '@site/src/components/ItsHoverIcon/icons/arrow-big-left-dash-icon';

import styles from './styles.module.css';

export default function DocRootLayoutSidebarExpandButton({
  toggleSidebar,
}: Props): ReactNode {
  const title = translate({
    id: 'theme.docs.sidebar.expandButtonTitle',
    message: 'Expand sidebar',
    description: 'The ARIA label and title attribute for expand button of doc sidebar',
  });

  return (
    <div
      className={styles.expandButton}
      title={title}
      aria-label={title}
      tabIndex={0}
      role="button"
      onKeyDown={toggleSidebar}
      onClick={toggleSidebar}>
      <ArrowBigLeftDashIcon className={styles.expandButtonIcon} size={16} strokeWidth={1.8} />
    </div>
  );
}
