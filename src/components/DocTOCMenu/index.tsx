import React, {useState} from 'react';
import {Popover, Portal} from '@chakra-ui/react';
import {useDoc} from '@docusaurus/plugin-content-docs/client';
import TOCItems from '@theme/TOCItems';
import styles from './styles.module.css';

export default function DocTOCMenu() {
  const {toc, frontMatter} = useDoc();
  const [open, setOpen] = useState(false);

  return (
    <Popover.Root open={open} onOpenChange={({open}) => setOpen(open)} lazyMount unmountOnExit
      positioning={{placement: 'bottom-end', strategy: 'fixed', gutter: 6, hideWhenDetached: true}}>
      <Popover.Trigger asChild>
        <button type="button" className={styles.trigger} aria-label="本页目录">目录</button>
      </Popover.Trigger>
      <Portal>
        <Popover.Positioner>
          <Popover.Content className={styles.content} aria-label="本页目录">
            <Popover.Title className={styles.title}>本页目录</Popover.Title>
            <nav className={styles.links} aria-label="本页章节" onClick={(event) => {
              if (event.target instanceof Element && event.target.closest('a[href^="#"]')) setOpen(false);
            }}>
              <TOCItems toc={toc} minHeadingLevel={frontMatter.toc_min_heading_level}
                maxHeadingLevel={frontMatter.toc_max_heading_level}
                linkClassName="table-of-contents__link" linkActiveClassName="table-of-contents__link--active" />
            </nav>
          </Popover.Content>
        </Popover.Positioner>
      </Portal>
    </Popover.Root>
  );
}
