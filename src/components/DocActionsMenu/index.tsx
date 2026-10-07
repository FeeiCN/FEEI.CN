import React, {useState, type ReactNode} from 'react';
import {Menu, Portal} from '@chakra-ui/react';
import {useDoc} from '@docusaurus/plugin-content-docs/client';
import {usePluginData} from '@docusaurus/useGlobalData';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import {getItsHoverIcon} from '@site/src/components/ItsHoverIcon';
import styles from './styles.module.css';

type DocMetadata = {
  updatedAt: number;
  revisionCount?: number;
};
type DocMetadataMap = Record<string, number | DocMetadata>;
type CopyState = 'idle' | 'copying' | 'copied' | 'error';

const ICON_SIZE = '16px';

const IconCopy    = getItsHoverIcon('copy-icon');
const IconCopied  = getItsHoverIcon('simple-checked-icon');
const IconGitHub  = getItsHoverIcon('github-icon');
const IconBug     = getItsHoverIcon('bug-icon');
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

function markdownUrlFromSource(source: string, baseUrl: string): string {
  const docsPath = source.replace(/^@site\/docs\/?/, '');
  const encodedPath = docsPath
    .split('/')
    .filter(Boolean)
    .map(segment => encodeURIComponent(segment))
    .join('/');
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${normalizedBaseUrl}markdown/${encodedPath}`;
}

function normalizeDocMetadata(value: number | DocMetadata | undefined): DocMetadata | undefined {
  if (typeof value === 'number') {
    return {updatedAt: value};
  }

  return value;
}

function issueUrl(title: string, pageUrl: string, selectedText = ''): string {
  const url = new URL('https://github.com/FeeiCN/FEEI.CN/issues/new');
  const quote = selectedText
    ? `引用原文：\n> ${selectedText.replace(/\n/g, '\n> ')}\n\n`
    : '';
  url.searchParams.set('title', `文章纠错：${title}`);
  url.searchParams.set('body', `文章链接：${pageUrl}\n\n${quote}问题描述：\n\n建议修改：\n`);
  return url.toString();
}

export default function DocActionsMenu(): ReactNode {
  const {metadata} = useDoc();
  const {siteConfig} = useDocusaurusContext();
  const [open, setOpen] = useState(false);
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const metadataMap = usePluginData('doc-mtime-plugin') as DocMetadataMap | undefined;
  const canCopyMarkdown = metadata.source.endsWith('.md');
  const docMetadata = normalizeDocMetadata(metadata.source ? metadataMap?.[metadata.source] : undefined);
  const fileName = fileNameFromSource(metadata.source);

  const pageUrl = `${siteConfig.url}${metadata.permalink}`;
  const aiQuery = encodeURIComponent(`Read ${pageUrl} and answer questions about the content.`);
  const claudeUrl = `https://claude.ai/new?q=${aiQuery}`;
  const chatgptUrl = `https://chat.openai.com/?q=${aiQuery}`;
  const reportIssueUrl = issueUrl(metadata.title, pageUrl);

  async function handleCopy() {
    if (!canCopyMarkdown) {
      return;
    }

    setOpen(false);
    setCopyState('copying');
    try {
      const response = await fetch(markdownUrlFromSource(metadata.source, siteConfig.baseUrl), {cache: 'no-cache'});
      if (!response.ok) {
        throw new Error(`Markdown request failed: ${response.status}`);
      }
      const text = await response.text();
      if (response.headers.get('content-type')?.includes('text/html')
        || /^\s*(?:<!doctype\s+html|<html\b)/i.test(text) || !text.trim()) {
        throw new Error('Invalid Markdown response');
      }
      await navigator.clipboard.writeText(text);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 2000);
    } catch {
      setCopyState('error');
      setTimeout(() => setCopyState('idle'), 2000);
    }
  }

  const TriggerIcon = copyState === 'copied' ? IconCopied : IconCopy;
  const triggerLabel = copyState === 'copying' ? '正在复制' : copyState === 'copied' ? '已复制' : copyState === 'error' ? '复制失败' : '复制 Markdown';

  return (
    <Menu.Root open={open} onOpenChange={(details) => setOpen(details.open)}
      positioning={{placement: 'bottom-end', gutter: 6}}>
      <div className={styles.wrapper} data-open={open ? 'true' : undefined}>
      {/* Split-pill: left clicks copy directly, right clicks open dropdown */}
      <div className={styles.trigger} data-state={copyState}>
        {canCopyMarkdown && (
          <>
            <button
              className={styles.triggerMain}
              onClick={handleCopy}
              disabled={copyState === 'copying'}
              aria-label={triggerLabel}
              title={triggerLabel}
              data-state={copyState}
            >
              {TriggerIcon && (
                <span className={styles.triggerIcon}>
                  <TriggerIcon size={ICON_SIZE} disableHover />
                </span>
              )}
            </button>
            <span className={styles.triggerSep} aria-hidden="true" />
          </>
        )}
        <Menu.Trigger asChild><button
          className={styles.triggerChevron}
          aria-label="更多操作"
        >
          <ChevronIcon open={open} />
        </button></Menu.Trigger>
      </div>

      <Portal><Menu.Positioner><Menu.Content className={styles.menu}>
          {metadata.editUrl && (
            <Menu.Item value="edit" asChild><a
              className={styles.item}
              href={metadata.editUrl}
              target="_blank"
              rel="noopener noreferrer"
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
            </a></Menu.Item>
          )}

          <Menu.Item value="report" asChild><a
            className={styles.item}
            href={reportIssueUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => {
              const selectedText = window.getSelection()?.toString().trim().slice(0, 500) ?? '';
              event.currentTarget.href = issueUrl(metadata.title, pageUrl, selectedText);
              setOpen(false);
            }}
          >
            {IconBug && (
              <span className={styles.itemIconWrap}>
                <IconBug size={ICON_SIZE} disableHover />
              </span>
            )}
            <span className={styles.itemBody}>
              <span className={styles.itemTitle}>
                文章纠错 <ExternalArrow />
              </span>
              <span className={styles.itemDesc}>在 GitHub 提交问题或修改建议</span>
            </span>
          </a></Menu.Item>

          <Menu.Separator className={styles.divider} />

          {/* Open in Claude */}
          <Menu.Item value="claude" asChild><a
            className={styles.item}
            href={claudeUrl}
            target="_blank"
            rel="noopener noreferrer"
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
          </a></Menu.Item>

          {/* Open in ChatGPT */}
          <Menu.Item value="chatgpt" asChild><a
            className={styles.item}
            href={chatgptUrl}
            target="_blank"
            rel="noopener noreferrer"
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
          </a></Menu.Item>

          <Menu.Separator className={styles.divider} />
          <div className={styles.menuMeta}>
            {docMetadata
              ? `${docMetadata.revisionCount ? `本文件迭代 ${docMetadata.revisionCount} 版，` : '本文件'}最后更新于 ${dateFormatter.format(new Date(docMetadata.updatedAt))}`
              : fileName}
          </div>
      </Menu.Content></Menu.Positioner></Portal>
      </div>
    </Menu.Root>
  );
}
