import React from 'react';
import clsx from 'clsx';
import {
  getItsHoverIcon,
  type AnimatedIconHandle,
} from '@site/src/components/ItsHoverIcon';

type Props = {
  icon?: string;
  className?: string;
  iconRef?: React.Ref<AnimatedIconHandle>;
  disableHover?: boolean;
};

export default function SidebarIcon({
  icon,
  className,
  iconRef,
  disableHover,
}: Props) {
  if (!icon) return null;
  const Icon = getItsHoverIcon(icon);
  if (!Icon) return null;
  return (
    <Icon
      ref={iconRef}
      size="1em"
      strokeWidth={1.6}
      disableHover={disableHover}
      className={clsx('sidebarIcon', className)}
    />
  );
}
