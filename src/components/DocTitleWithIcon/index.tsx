import React, {type ReactNode} from 'react';
import clsx from 'clsx';
import SidebarIcon from '@site/src/components/SidebarIcon';

type Props = {
  icon?: string;
  children: ReactNode;
  className?: string;
};

export default function DocTitleWithIcon({icon, children, className}: Props) {
  if (!icon) {
    return <>{children}</>;
  }

  return (
    <span className={clsx('docTitleWithIcon', className)}>
      <SidebarIcon icon={icon} className="docTitleIcon" />
      <span>{children}</span>
    </span>
  );
}
