import React, {type ReactNode} from 'react';
import clsx from 'clsx';
import SidebarIcon from '@site/src/components/SidebarIcon';
import {useDoc} from '@docusaurus/plugin-content-docs/client';

type Props = {
  icon?: string;
  children: ReactNode;
  className?: string;
};

export default function DocTitleWithIcon({icon, children, className}: Props) {
  let isStandard = false;
  try {
    isStandard = (useDoc().frontMatter as Record<string, unknown>).standard_source === true;
  } catch {
    // Titles can also be rendered outside documentation pages.
  }
  const standard = isStandard && typeof children === 'string'
    ? children.match(/^((?:GB(?:\/[TZ])?|G[MA]\/T)\s+\d+(?:\.\d+)*[-—–]\d{4})\s+(.+)$/)
    : null;
  const title = standard ? (
    <>
      <span className="docTitleIdentifier">{standard[1]}</span>{' '}
      <span className="docTitleName">{standard[2].split(/(第\s*\d+\s*部分|信息安全技术)/).map((part, index) => (
        /^(?:第\s*\d+\s*部分|信息安全技术)$/.test(part)
          ? <span className="docTitlePhrase" key={index}>{part}</span>
          : part
      ))}</span>
    </>
  ) : children;
  if (!icon) {
    return <>{title}</>;
  }

  return (
    <span className={clsx('docTitleWithIcon', className)}>
      <SidebarIcon icon={icon} className="docTitleIcon" />
      <span>{title}</span>
    </span>
  );
}
