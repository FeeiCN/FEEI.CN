import React, {useState, useEffect, useRef, type ReactNode} from 'react';
import {useDoc} from '@docusaurus/plugin-content-docs/client';
import {usePluginData} from '@docusaurus/useGlobalData';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import {getItsHoverIcon} from '@site/src/components/ItsHoverIcon';
import styles from './styles.module.css';

type MarkdownMap = Record<string, string>;
type DocMetadata = {
  updatedAt: number;
  revisionCount?: number;
};
type DocMetadataMap = Record<string, number | DocMetadata>;
type CopyState = 'idle' | 'copied' | 'error';

const ICON_SIZE = '16px';

const IconCopy    = getItsHoverIcon('copy-icon');
const IconCopied  = getItsHoverIcon('simple-checked-icon');
const IconGitHub  = getItsHoverIcon('github-icon');
const IconClaude  = getItsHoverIcon('brand-anthropic-icon');
const IconOpenAI  = getItsHoverIcon('brand-openai-icon');

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

function ChevronIcon({open}: {open: boolean}) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{
        transition: 'transform 0.15s',
        transform: open ? 'rotate(180deg)' : 'none',
        flexShrink: 0,
      }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function ExternalArrow() {
  return <span className={styles.externalArrow}>↗</span>;
}

function fileNameFromSource(source: string): string {
  const docsPath = source.replace(/^@site\/docs\/?/, '');
  return docsPath.split('/').filter(Boolean).at(-1) ?? docsPath;
}

function normalizeDocMetadata(value: number | DocMetadata | undefined): DocMetadata | undefined {
  if (typeof value === 'number') {
    return {updatedAt: value};
  }

  return value;
}

export default function DocActionsMenu(): ReactNode {
  const {metadata} = useDoc();
  const {siteConfig} = useDocusaurusContext();
  const [open, setOpen] = useState(false);
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const markdownMap = usePluginData('copy-markdown-plugin') as MarkdownMap | undefined;
  const metadataMap = usePluginData('doc-mtime-plugin') as DocMetadataMap | undefined;
  const canCopyMarkdown = metadata.source.endsWith('.md');
  const docMetadata = normalizeDocMetadata(metadata.source ? metadataMap?.[metadata.source] : undefined);
  const fileName = fileNameFromSource(metadata.source);

  const pageUrl = `${siteConfig.url}${metadata.permalink}`;
  const aiQuery = encodeURIComponent(`Read ${pageUrl} and answer questions about the content.`);
  const claudeUrl = `https://claude.ai/new?q=${aiQuery}`;
  const chatgptUrl = `https://chat.openai.com/?q=${aiQuery}`;

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [open]);

  async function handleCopy() {
    if (!canCopyMarkdown) {
      return;
    }

    const key = metadata.source.replace('@site/docs', '');
    const text = markdownMap?.[key];
    setOpen(false);
    if (!text) {
      setCopyState('error');
      setTimeout(() => setCopyState('idle'), 2000);
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 2000);
    } catch {
      setCopyState('error');
      setTimeout(() => setCopyState('idle'), 2000);
    }
  }

  const TriggerIcon = copyState === 'copied' ? IconCopied : IconCopy;
  const triggerLabel = copyState === 'copied' ? '已复制' : copyState === 'error' ? '失败' : '复制Markdown';

  if (metadata.source.endsWith('.mdx')) {
    return null;
  }

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      {/* Split-pill: left clicks copy directly, right clicks open dropdown */}
      <div className={styles.trigger} data-state={copyState}>
        {canCopyMarkdown && (
          <>
            <button
              className={styles.triggerMain}
              onClick={handleCopy}
              aria-label="复制 Markdown 原文"
              data-state={copyState}
            >
              {TriggerIcon && (
                <span className={styles.triggerIcon}>
                  <TriggerIcon size={ICON_SIZE} disableHover />
                </span>
              )}
              <span className={styles.triggerText}>{triggerLabel}</span>
            </button>
            <span className={styles.triggerSep} aria-hidden="true" />
          </>
        )}
        <button
          className={styles.triggerChevron}
          onClick={() => setOpen(o => !o)}
          aria-haspopup="true"
          aria-expanded={open}
          aria-label="更多操作"
        >
          <ChevronIcon open={open} />
        </button>
      </div>

      {open && (
        <div className={styles.menu} role="menu">
          {metadata.editUrl && (
            <a
              className={styles.item}
              href={metadata.editUrl}
              target="_blank"
              rel="noopener noreferrer"
              role="menuitem"
              onClick={() => setOpen(false)}
            >
              {IconGitHub && (
                <span className={styles.itemIconWrap}>
                  <IconGitHub size={ICON_SIZE} disableHover />
                </span>
              )}
              <span className={styles.itemBody}>
                <span className={styles.itemTitle}>
                  在 GitHub 上编辑 <ExternalArrow />
                </span>
                <span className={styles.itemDesc}>查看并编辑此页面的源文件</span>
              </span>
            </a>
          )}

          <div className={styles.divider} />

          {/* Open in Claude */}
          <a
            className={styles.item}
            href={claudeUrl}
            target="_blank"
            rel="noopener noreferrer"
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            {IconClaude && (
              <span className={styles.itemIconWrap}>
                <IconClaude size={ICON_SIZE} disableHover />
              </span>
            )}
            <span className={styles.itemBody}>
              <span className={styles.itemTitle}>
                在 Claude 中打开 <ExternalArrow />
              </span>
              <span className={styles.itemDesc}>向 Claude 询问此页面的内容</span>
            </span>
          </a>

          {/* Open in ChatGPT */}
          <a
            className={styles.item}
            href={chatgptUrl}
            target="_blank"
            rel="noopener noreferrer"
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            {IconOpenAI && (
              <span className={styles.itemIconWrap}>
                <IconOpenAI size={ICON_SIZE} disableHover />
              </span>
            )}
            <span className={styles.itemBody}>
              <span className={styles.itemTitle}>
                在 ChatGPT 中打开 <ExternalArrow />
              </span>
              <span className={styles.itemDesc}>向 ChatGPT 询问此页面的内容</span>
            </span>
          </a>

          <div className={styles.divider} />
          <div className={styles.menuMeta}>
            {docMetadata
              ? `${docMetadata.revisionCount ? `本文件迭代 ${docMetadata.revisionCount} 版，` : '本文件'}最后更新于 ${dateFormatter.format(new Date(docMetadata.updatedAt))}`
              : fileName}
          </div>
        </div>
      )}
    </div>
  );
}
