import React, {useEffect, useState, type ReactElement} from 'react';
import {Portal, Tooltip} from '@chakra-ui/react';
import SidebarIcon from '@site/src/components/SidebarIcon';
import type {AnimatedIconHandle} from '@site/src/components/ItsHoverIcon';
import {sidebarLabel} from '@site/src/utils/sidebarLabel';
import styles from './styles.module.css';

type Props = {
  label: string;
  icon?: string;
  iconRef: React.RefObject<AnimatedIconHandle | null>;
  disableHover: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
};

export default function SidebarItemLabel({label, icon, iconRef, disableHover, onMouseEnter, onMouseLeave}: Props) {
  const {name, number} = sidebarLabel(label);
  return (
    <span className={styles.label} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      {icon && (
        <span className={styles.icon} aria-hidden="true">
          <SidebarIcon icon={icon} iconRef={iconRef} disableHover={disableHover} />
        </span>
      )}
      <span className={styles.text}>
        {number && <span className={styles.number}>{number}</span>}
        <span className={styles.name} data-sidebar-name>{name}</span>
      </span>
    </span>
  );
}

export function SidebarLabelTooltip({label, children}: {label: string; children: ReactElement}) {
  const [trigger, setTrigger] = useState<HTMLElement | null>(null);
  const [truncated, setTruncated] = useState(false);
  useEffect(() => {
    const name = trigger?.querySelector<HTMLElement>('[data-sidebar-name]');
    if (!trigger || !name) return undefined;
    const measure = () => setTruncated(name.scrollWidth > name.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(name);
    observer.observe(trigger);
    return () => observer.disconnect();
  }, [trigger, label]);

  return (
    <Tooltip.Root disabled={!truncated} openDelay={300} closeDelay={80} lazyMount unmountOnExit
      positioning={{placement: 'right-start', strategy: 'fixed', gutter: 8}}>
      <Tooltip.Trigger asChild ref={setTrigger}>{children}</Tooltip.Trigger>
      <Portal><Tooltip.Positioner><Tooltip.Content className={styles.tooltip}>
        {label}
      </Tooltip.Content></Tooltip.Positioner></Portal>
    </Tooltip.Root>
  );
}
