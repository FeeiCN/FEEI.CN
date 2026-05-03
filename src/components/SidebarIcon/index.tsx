import React from 'react';
import clsx from 'clsx';
import * as LucideIcons from 'lucide-react';
import type {LucideIcon} from 'lucide-react';

type Props = {
  icon?: string;
  className?: string;
};

// Legacy aliases: frontmatter names that don't match Lucide's PascalCase directly
const aliases: Record<string, string> = {
  'apple-whole': 'Apple',
  'clock': 'Clock3',
  'code-branch': 'GitBranch',
  'hourglass-end': 'Hourglass',
  'industry': 'Factory',
  'language': 'Languages',
  'user-graduate': 'GraduationCap',
};

function toPascalCase(str: string): string {
  return str
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

export default function SidebarIcon({icon, className}: Props) {
  if (!icon) return null;

  const lucideName = aliases[icon] ?? toPascalCase(icon);
  const Icon = (LucideIcons as Record<string, unknown>)[lucideName] as LucideIcon | undefined;

  if (!Icon) return null;

  return <Icon aria-hidden="true" className={clsx('sidebarIcon', className)} />;
}
