import React, {useState, useRef, useEffect, type ReactNode} from 'react';
import {Menu, Portal} from '@chakra-ui/react';
import clsx from 'clsx';
import {useLocalPathname} from '@docusaurus/theme-common/internal';
import NavbarItem from '@theme/NavbarItem';
import SidebarIcon from '@site/src/components/SidebarIcon';
import useControlledIconAnimation from '@site/src/components/ItsHoverIcon/useControlledIconAnimation';
import type {Props} from '@theme/NavbarItem/DropdownNavbarItem/Desktop';
import styles from './styles.module.css';

export default function DropdownNavbarItemDesktop({
  items,
  position,
  className,
  onClick,
  ...props
}: Props): ReactNode {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const openedByHover = useRef(false);
  const [menuContent, setMenuContent] = useState<HTMLUListElement | null>(null);
  const [hasActiveChild, setHasActiveChild] = useState(false);
  const localPathname = useLocalPathname();
  const icon = (props as typeof props & {icon?: string}).icon;
  const iconAnimation = useControlledIconAnimation(Boolean(icon));

  useEffect(() => {
    const root = menuContent;
    if (!root) {
      setHasActiveChild(false);
      return;
    }
    const syncActiveState = () => {
      const active = Boolean(root.querySelector('.dropdown__link--active'));
      setHasActiveChild(active);
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
  }, [localPathname, menuContent]);

  return (
    <Menu.Root
      onOpenChange={({open}) => {if (!open) openedByHover.current = false;}}
      positioning={{placement: position === 'right' ? 'bottom-end' : 'bottom-start', gutter: 0}}
      loopFocus lazyMount={false} unmountOnExit={false}>
      <Menu.Context>{(menu) => <div ref={dropdownRef} className={clsx('navbar__item', styles.root)}
        onPointerLeave={(event) => {
          if (event.pointerType !== 'mouse' || !openedByHover.current) return;
          if (event.relatedTarget instanceof Node && menuContent?.contains(event.relatedTarget)) return;
          menu.setOpen(false);
        }}>
        <Menu.Trigger className={clsx('navbar__link', styles.trigger, className, {
          'navbar__link--active': hasActiveChild,
        })}
          onPointerEnter={(event) => {
            if (event.pointerType !== 'mouse' || menu.open) return;
            openedByHover.current = true;
            menu.setOpen(true);
          }}
          onClickCapture={(event) => {
            if (event.detail > 0 && openedByHover.current && menu.open) {
              openedByHover.current = false;
              event.stopPropagation();
            }
          }}
          onKeyDownCapture={() => {openedByHover.current = false;}}>
          <span className="navbarItemLabel"
            onMouseEnter={iconAnimation.onMouseEnter}
            onMouseLeave={iconAnimation.onMouseLeave}>
            <SidebarIcon icon={icon} className="navbarItemIcon" iconRef={iconAnimation.iconRef}
              disableHover={iconAnimation.disableHover} />
            <span>{props.children ?? props.label}</span>
          </span>
        </Menu.Trigger>
        <Portal><Menu.Positioner>
          <Menu.Content asChild className={styles.menu}
            onPointerLeave={(event) => {
              if (event.pointerType !== 'mouse' || !openedByHover.current) return;
              if (event.relatedTarget instanceof Node && dropdownRef.current?.contains(event.relatedTarget)) return;
              menu.setOpen(false);
            }}
            onKeyDownCapture={(event) => {
              if (event.key === 'Tab') {
                event.stopPropagation();
                dropdownRef.current?.querySelector<HTMLButtonElement>('[data-part="trigger"]')?.focus({preventScroll: true});
                menu.setOpen(false);
              }
            }}>
            <ul ref={setMenuContent}>
              {items.map((childItemProps, i) => (
                <Menu.Item asChild value={String(i)} key={i}>
                  <NavbarItem isDropdownItem activeClassName="dropdown__link--active" {...childItemProps} />
                </Menu.Item>
              ))}
            </ul>
          </Menu.Content>
        </Menu.Positioner></Portal>
      </div>}</Menu.Context>
    </Menu.Root>
  );
}
