import React, {type ReactNode} from 'react';
import clsx from 'clsx';
import {ThemeClassNames} from '@docusaurus/theme-common';
import {isActiveSidebarItem} from '@docusaurus/plugin-content-docs/client';
import Link from '@docusaurus/Link';
import isInternalUrl from '@docusaurus/isInternalUrl';
import IconExternalLink from '@theme/Icon/ExternalLink';
import type {Props} from '@theme/DocSidebarItem/Link';
import SidebarIcon from '@site/src/components/SidebarIcon';
import type {AnimatedIconHandle} from '@site/src/components/ItsHoverIcon';
import useControlledIconAnimation from '@site/src/components/ItsHoverIcon/useControlledIconAnimation';

import styles from './styles.module.css';

function LinkLabel({
  label,
  icon,
  iconRef,
  disableHover,
  onMouseEnter,
  onMouseLeave,
}: {
  label: string;
  icon?: string;
  iconRef: React.RefObject<AnimatedIconHandle | null>;
  disableHover: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  return (
    <span
      className={styles.linkLabelTrigger}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}>
      <SidebarIcon icon={icon} iconRef={iconRef} disableHover={disableHover} />
      <span title={label} className={styles.linkLabel}>
        {label}
      </span>
    </span>
  );
}

export default function DocSidebarItemLink({
  item,
  onItemClick,
  activePath,
  level,
  index,
  ...props
}: Props): ReactNode {
  const {href, label, className, autoAddBaseUrl, customProps} = item;
  const isActive = isActiveSidebarItem(item, activePath);
  const isInternalLink = isInternalUrl(href);
  const icon =
    typeof customProps?.icon === 'string' ? customProps.icon : undefined;
  const iconAnimation = useControlledIconAnimation(Boolean(icon));

  return (
    <li
      className={clsx(
        ThemeClassNames.docs.docSidebarItemLink,
        ThemeClassNames.docs.docSidebarItemLinkLevel(level),
        'menu__list-item',
        className,
      )}
      key={label}>
      <Link
        className={clsx(
          'menu__link',
          styles.menuLinkWithIcon,
          !isInternalLink && styles.menuExternalLink,
          {
            'menu__link--active': isActive,
          },
        )}
        autoAddBaseUrl={autoAddBaseUrl}
        aria-current={isActive ? 'page' : undefined}
        to={href}
        {...(isInternalLink && {
          onClick: onItemClick ? () => onItemClick(item) : undefined,
        })}
        {...props}>
        <LinkLabel
          label={label}
          icon={icon}
          iconRef={iconAnimation.iconRef}
          disableHover={iconAnimation.disableHover}
          onMouseEnter={iconAnimation.onMouseEnter}
          onMouseLeave={iconAnimation.onMouseLeave}
        />
        {!isInternalLink && <IconExternalLink />}
      </Link>
    </li>
  );
}
