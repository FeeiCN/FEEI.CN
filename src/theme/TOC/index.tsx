import React, {type ReactNode} from 'react';
import clsx from 'clsx';
import TOCItems from '@theme/TOCItems';
import type {Props} from '@theme/TOC';
import SidebarIcon from '@site/src/components/SidebarIcon';

import styles from './styles.module.css';

const LINK_CLASS_NAME = 'table-of-contents__link toc-highlight';
const LINK_ACTIVE_CLASS_NAME = 'table-of-contents__link--active';

export default function TOC({className, ...props}: Props): ReactNode {
  return (
    <div className={clsx(styles.tableOfContents, 'thin-scrollbar', className)}>
      <div className="tocHeader">
        <SidebarIcon icon="list-tree" className="tocHeaderIcon" />
        <span>本章内容大纲</span>
      </div>
      <TOCItems
        {...props}
        linkClassName={LINK_CLASS_NAME}
        linkActiveClassName={LINK_ACTIVE_CLASS_NAME}
      />
    </div>
  );
}
