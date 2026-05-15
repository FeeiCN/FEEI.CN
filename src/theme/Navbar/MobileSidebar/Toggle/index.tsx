import React, {type ReactNode} from 'react';
import {useNavbarMobileSidebar} from '@docusaurus/theme-common/internal';
import {translate} from '@docusaurus/Translate';
import {MenuIcon} from '@site/src/components/ItsHoverIcon';
import useControlledIconAnimation from '@site/src/components/ItsHoverIcon/useControlledIconAnimation';

export default function MobileSidebarToggle(): ReactNode {
  const {toggle, shown} = useNavbarMobileSidebar();
  const iconAnimation = useControlledIconAnimation(true);
  return (
    <button
      onClick={toggle}
      aria-label={translate({
        id: 'theme.docs.sidebar.toggleSidebarButtonAriaLabel',
        message: 'Toggle navigation bar',
        description: 'The ARIA label for hamburger menu button of mobile navigation',
      })}
      aria-expanded={shown}
      className="navbar__toggle clean-btn"
      onMouseEnter={iconAnimation.onMouseEnter}
      onMouseLeave={iconAnimation.onMouseLeave}
      type="button">
      <MenuIcon
        ref={iconAnimation.iconRef}
        size={18}
        strokeWidth={1.6}
        disableHover={iconAnimation.disableHover}
      />
    </button>
  );
}
