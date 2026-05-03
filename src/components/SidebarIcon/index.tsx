import React from 'react';
import clsx from 'clsx';
import type {LucideIcon} from 'lucide-react';
import {
  Apple,
  Ban,
  BookOpen,
  Brain,
  ChartColumn,
  ChartLine,
  ChartPie,
  Clock3,
  Coins,
  Compass,
  Dumbbell,
  Factory,
  Gem,
  GitBranch,
  GraduationCap,
  Heart,
  House,
  Hourglass,
  Languages,
  ListTree,
  PiggyBank,
  Receipt,
  Repeat,
  Rocket,
  Shield,
  Stethoscope,
  Trophy,
  Users,
} from 'lucide-react';

type Props = {
  icon?: string;
  className?: string;
};

const iconMap: Record<string, LucideIcon> = {
  'apple-whole': Apple,
  ban: Ban,
  'book-open': BookOpen,
  brain: Brain,
  'chart-column': ChartColumn,
  'chart-line': ChartLine,
  'chart-pie': ChartPie,
  clock: Clock3,
  coins: Coins,
  compass: Compass,
  dumbbell: Dumbbell,
  gem: Gem,
  'code-branch': GitBranch,
  'hourglass-end': Hourglass,
  house: House,
  industry: Factory,
  language: Languages,
  'list-tree': ListTree,
  'piggy-bank': PiggyBank,
  receipt: Receipt,
  repeat: Repeat,
  rocket: Rocket,
  shield: Shield,
  stethoscope: Stethoscope,
  trophy: Trophy,
  'user-graduate': GraduationCap,
  users: Users,
  heart: Heart,
};

export default function SidebarIcon({icon, className}: Props) {
  if (!icon) {
    return null;
  }

  const Icon = iconMap[icon];

  if (!Icon) {
    return null;
  }

  return <Icon aria-hidden="true" className={clsx('sidebarIcon', className)} />;
}
