import React, {useState, type ReactNode} from 'react';
import {useDoc} from '@docusaurus/plugin-content-docs/client';
import {usePluginData} from '@docusaurus/useGlobalData';
import styles from './styles.module.css';

type CopyState = 'idle' | 'copied' | 'error';
type MarkdownMap = Record<string, string>;

export default function CopyMarkdownButton(): ReactNode {
  const {metadata} = useDoc();
  const [state, setState] = useState<CopyState>('idle');
  const canCopyMarkdown = metadata.source.endsWith('.md');

  // Plugin global data: source key → raw markdown content
  const markdownMap = usePluginData('copy-markdown-plugin') as MarkdownMap | undefined;

  async function handleCopy() {
    if (!canCopyMarkdown) {
      return;
    }

    // metadata.source is "@site/docs/path/to/file.md"
    const key = metadata.source.replace('@site/docs', '');
    const text = markdownMap?.[key];

    if (!text) {
      setState('error');
      setTimeout(() => setState('idle'), 2000);
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
      setTimeout(() => setState('idle'), 2000);
    } catch {
      setState('error');
      setTimeout(() => setState('idle'), 2000);
    }
  }

  const label = state === 'copied' ? '已复制' : state === 'error' ? '失败' : '复制';

  if (!canCopyMarkdown) {
    return null;
  }

  return (
    <button
      className={styles.copyBtn}
      onClick={handleCopy}
      title="复制 Markdown 原文"
      aria-label="复制 Markdown 原文"
      data-state={state}
    >
      {label}
    </button>
  );
}
