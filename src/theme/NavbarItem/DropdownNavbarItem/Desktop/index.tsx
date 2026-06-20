import React, {useState, useRef, useEffect, type ReactNode} from 'react';
import clsx from 'clsx';
import {useLocalPathname} from '@docusaurus/theme-common/internal';
import NavbarNavLink from '@theme/NavbarItem/NavbarNavLink';
import NavbarItem from '@theme/NavbarItem';
import type {Props} from '@theme/NavbarItem/DropdownNavbarItem/Desktop';

export default function DropdownNavbarItemDesktop({
  items,
  position,
  className,
  onClick,
  ...props
}: Props): ReactNode {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [hasActiveChild, setHasActiveChild] = useState(false);
  const localPathname = useLocalPathname();

  useEffect(() => {
    const handleClickOutside = (
      event: MouseEvent | TouchEvent | FocusEvent,
    ) => {
      if (
        !dropdownRef.current ||
        dropdownRef.current.contains(event.target as Node)
      ) {
        return;
      }
      setShowDropdown(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    document.addEventListener('focusin', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('focusin', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    const root = dropdownRef.current;
    if (!root) {
      setHasActiveChild(false);
      return;
    }
    const syncActiveState = () => {
      const active = Boolean(root.querySelector('.dropdown__link--active'));
      setHasActiveChild(active);
      const trigger = root.querySelector('.navbar__link');
      if (trigger) {
        trigger.classList.toggle('navbar__link--active', active);
      }
    };

    syncActiveState();

    const observer = new MutationObserver(() => {
      syncActiveState();
    });
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'aria-current'],
    });

    return () => {
      observer.disconnect();
    };
  }, [localPathname]);

  return (
    <div
      ref={dropdownRef}
      className={clsx('navbar__item', 'dropdown', 'dropdown--hoverable', {
        'dropdown--right': position === 'right',
        'dropdown--show': showDropdown,
      })}>
      <NavbarNavLink
        aria-haspopup="true"
        aria-expanded={showDropdown}
        role="button"
        href={props.to ? undefined : '#'}
        className={clsx('navbar__link', className, {
          'navbar__link--active': hasActiveChild,
        })}
        {...props}
        onClick={props.to ? undefined : (e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setShowDropdown(!showDropdown);
          }
        }}>
        {props.children ?? props.label}
      </NavbarNavLink>
      <ul className="dropdown__menu">
        {items.map((childItemProps, i) => (
          <NavbarItem
            isDropdownItem
            activeClassName="dropdown__link--active"
            {...childItemProps}
            key={i}
          />
        ))}
      </ul>
    </div>
  );
}
