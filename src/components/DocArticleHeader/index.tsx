import React, {useLayoutEffect, useRef, type ReactNode} from 'react';
import StandardRelations from '@site/src/components/ComplianceKnowledge/StandardRelations';
import styles from './styles.module.css';

export default function DocArticleHeader({
  children,
  as: Element = 'header',
}: {
  children: ReactNode;
  as?: 'header' | 'div';
}): ReactNode {
  const headerRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const header = headerRef.current;
    const heading = header?.querySelector('h1');
    if (!header || !heading) return;

    const desktop = window.matchMedia('(min-width: 997px)');
    let frame = 0;
    let disposed = false;
    const fit = () => {
      heading.style.removeProperty('--doc-title-font-size');
      if (!desktop.matches) return;

      const text = heading.querySelector<HTMLElement>('.docTitleWithIcon > span:last-child') ?? heading;
      const maxSize = Number.parseFloat(getComputedStyle(heading).fontSize);
      const minSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) * 1.6;
      const whiteSpace = heading.style.whiteSpace;
      heading.style.whiteSpace = 'nowrap';
      const available = heading.getBoundingClientRect().right - text.getBoundingClientRect().left;
      const natural = Math.max(text.scrollWidth, text.getBoundingClientRect().width);
      heading.style.whiteSpace = whiteSpace;
      if (available <= 0 || natural <= available) return;

      const size = Math.max(minSize, Math.floor(maxSize * (available - 1) / natural * 10) / 10);
      heading.style.setProperty('--doc-title-font-size', `${size}px`);
    };
    const schedule = () => {
      if (disposed) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(header);
    desktop.addEventListener('change', schedule);
    document.fonts.ready.then(schedule);
    document.fonts.addEventListener('loadingdone', schedule);
    fit();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      desktop.removeEventListener('change', schedule);
      document.fonts.removeEventListener('loadingdone', schedule);
      heading.style.removeProperty('--doc-title-font-size');
    };
  }, [children]);

  return (
    <>
      <Element ref={node => { headerRef.current = node; }} className={styles.header}>{children}</Element>
      <StandardRelations />
    </>
  );
}
