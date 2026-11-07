import React, {useEffect} from 'react';
import {useNavbarMobileSidebar} from '@docusaurus/theme-common/internal';
import DocSidebarMobile from '@theme-original/DocSidebar/Mobile';
import type {Props} from '@theme/DocSidebar/Mobile';
import {revealSidebarItem} from '@site/src/utils/sidebarScroll';

export default function MobileSidebar(props: Props) {
  const {shown} = useNavbarMobileSidebar();
  useEffect(() => {
    if (!shown) return undefined;
    const frame = requestAnimationFrame(() => {
      revealSidebarItem(document.querySelector('.navbar-sidebar .theme-doc-sidebar-menu'));
    });
    return () => cancelAnimationFrame(frame);
  }, [shown, props.path]);
  return <DocSidebarMobile {...props} />;
}
