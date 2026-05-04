import React, {type ReactNode} from 'react';
import {useNavbarMobileSidebar} from '@docusaurus/theme-common/internal';
import {translate} from '@docusaurus/Translate';
import {Menu} from 'lucide-react';

export default function MobileSidebarToggle(): ReactNode {
  const {toggle, shown} = useNavbarMobileSidebar();
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
      type="button">
      <Menu
        aria-hidden="true"
        size={18}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{display: 'block'}}
      />
    </button>
  );
}
