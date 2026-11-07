import React, {type ReactNode} from 'react';
import clsx from 'clsx';
import {ThemeClassNames} from '@docusaurus/theme-common';
import {isActiveSidebarItem} from '@docusaurus/plugin-content-docs/client';
import Link from '@docusaurus/Link';
import isInternalUrl from '@docusaurus/isInternalUrl';
import IconExternalLink from '@theme/Icon/ExternalLink';
import type {Props} from '@theme/DocSidebarItem/Link';
import SidebarItemLabel, {SidebarLabelTooltip} from '@site/src/components/SidebarItemLabel';
import useControlledIconAnimation from '@site/src/components/ItsHoverIcon/useControlledIconAnimation';

import styles from './styles.module.css';

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
  const icon = level === 1 && customProps?.hideSidebarIcon !== true && typeof customProps?.icon === 'string'
    ? customProps.icon
    : undefined;
  const iconAnimation = useControlledIconAnimation(Boolean(icon));
  const badge = (customProps?.sidebar_badge ?? null) as {
    text: string;
    color?: string;
  } | null;
  const badgeColor = badge?.color ?? 'info';

  return (
    <li
      className={clsx(
        ThemeClassNames.docs.docSidebarItemLink,
        ThemeClassNames.docs.docSidebarItemLinkLevel(level),
        'menu__list-item',
        className,
      )}
      key={label}>
      <SidebarLabelTooltip label={label}><Link
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
        <SidebarItemLabel
          label={label}
          icon={icon}
          iconRef={iconAnimation.iconRef}
          disableHover={iconAnimation.disableHover}
          onMouseEnter={iconAnimation.onMouseEnter}
          onMouseLeave={iconAnimation.onMouseLeave}
        />
        {badge && (
          <span className={clsx('badge', `badge--${badgeColor}`)}>
            {badge.text}
          </span>
        )}
        {!isInternalLink && <IconExternalLink />}
      </Link></SidebarLabelTooltip>
    </li>
  );
}
