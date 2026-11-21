import {useLayoutEffect, useRef, type ReactNode} from 'react';
import {useLocation} from '@docusaurus/router';
import useBaseUrl from '@docusaurus/useBaseUrl';
import {useColorMode} from '@docusaurus/theme-common';
import OriginalNavbar from '@theme-original/Navbar';
import styles from './styles.module.css';

type Palette = Record<string, string>;
let previousPalette: Palette | undefined;

export default function Navbar(): ReactNode {
  const {pathname} = useLocation();
  const {colorMode} = useColorMode();
  const homeUrl = useBaseUrl('/');
  const isHome = pathname.replace(/\/$/, '') === homeUrl.replace(/\/$/, '');
  const frame = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = frame.current;
    if (!root) return;
    const computed = getComputedStyle(root);
    const palette = Object.fromEntries(
      ['background', 'border', 'text', 'strong', 'search-background', 'search-text', 'muted'].map((key) => [
        key,
        computed.getPropertyValue(`--nav-${key}`).trim(),
      ]),
    );
    const from = previousPalette;
    previousPalette = palette;
    if (!from || from.background === palette.background || matchMedia('(prefers-reduced-motion: reduce)').matches)
      return;
    const animations: Animation[] = [];
    function animate(selector: string, properties: Record<string, string>) {
      root!.querySelectorAll<HTMLElement>(selector).forEach((element) => {
        if (typeof element.animate !== 'function') return;
        animations.push(
          element.animate(
            [
              Object.fromEntries(Object.entries(properties).map(([property, key]) => [property, from![key]])),
              Object.fromEntries(Object.entries(properties).map(([property, key]) => [property, palette[key]])),
            ],
            {duration: 280, easing: 'ease', fill: 'backwards'},
          ),
        );
      });
    }
    // Docusaurus remounts the navbar on navigation, so CSS transitions alone cannot retain the previous palette.
    animate('.navbar', {backgroundColor: 'background', borderBottomColor: 'border'});
    animate(
      '.navbar__inner .navbar__link, .navbar__inner .clean-btn, .navbar__inner .sidebarIcon, .navbar__inner [data-music-trigger], .navbar__search > svg',
      {color: 'text'},
    );
    animate('.navbar__inner a[aria-label="FEEI 首页"] > span', {color: 'strong'});
    animate('.navbar__search-input', {backgroundColor: 'search-background', color: 'search-text'});
    animate('.navbar__search kbd', {color: 'muted', borderColor: 'muted'});
    return () => animations.forEach((animation) => animation.cancel());
  }, [isHome, colorMode]);

  return (
    <div ref={frame} className={`${styles.frame} ${isHome ? styles.home : ''}`}>
      <OriginalNavbar />
    </div>
  );
}
