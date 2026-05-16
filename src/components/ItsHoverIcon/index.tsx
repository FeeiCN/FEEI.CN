import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type CSSProperties,
  type ComponentType,
  type ForwardRefExoticComponent,
  type HTMLAttributes,
  type RefAttributes,
} from 'react';
import clsx from 'clsx';
import type {AnimatedIconHandle, AnimatedIconProps} from './icons/types';

type RawIconComponent = ComponentType<
  AnimatedIconProps & RefAttributes<AnimatedIconHandle>
>;

type RawIconModule = {
  default: RawIconComponent;
};

interface IconModuleContext {
  keys(): string[];
  <T = RawIconModule>(id: string): T;
}

declare const require: {
  context: (
    directory: string,
    useSubdirectories: boolean,
    regExp: RegExp,
  ) => IconModuleContext;
};

export type ControlledAnimatedIconProps = AnimatedIconProps & {
  disableHover?: boolean;
};

export type ControlledIconComponent = ForwardRefExoticComponent<
  ControlledAnimatedIconProps & RefAttributes<AnimatedIconHandle>
>;

const iconModuleContext = require.context('./icons', false, /\.tsx$/);
const rawIconRegistry = new Map<string, RawIconComponent>();

for (const key of iconModuleContext.keys()) {
  const slug = key.replace(/^\.\//, '').replace(/\.tsx$/, '');
  const mod = iconModuleContext(key) as RawIconModule;
  rawIconRegistry.set(slug, mod.default);
}

const controlledIconRegistry = new Map<string, ControlledIconComponent>();

function createControlledIcon(RawIcon: RawIconComponent): ControlledIconComponent {
  const ControlledIcon = forwardRef<
    AnimatedIconHandle,
    ControlledAnimatedIconProps
  >(function ControlledIcon(
    {
      className,
      style,
      disableHover = false,
      size = '1em',
      color = 'currentColor',
      strokeWidth = 2,
      ...rest
    },
    ref,
  ) {
    const innerRef = useRef<AnimatedIconHandle>(null);

    useImperativeHandle(
      ref,
      () => ({
        startAnimation: () => innerRef.current?.startAnimation(),
        stopAnimation: () => innerRef.current?.stopAnimation(),
      }),
      [],
    );

    useEffect(() => {
      if (disableHover) {
        innerRef.current?.stopAnimation();
      }
    }, [disableHover]);

    const wrapperStyle: CSSProperties = {
      display: 'inline-flex',
      lineHeight: 0,
      ...(disableHover ? {pointerEvents: 'none'} : null),
      ...(style ?? null),
    };

    return (
      <span
        {...(rest as HTMLAttributes<HTMLSpanElement>)}
        className={clsx(className)}
        style={wrapperStyle}
      >
        <RawIcon
          ref={innerRef}
          size={size}
          color={color}
          strokeWidth={strokeWidth}
        />
      </span>
    );
  });

  ControlledIcon.displayName =
    `Controlled${RawIcon.displayName ?? RawIcon.name ?? 'Icon'}`;
  return ControlledIcon;
}

function getControlledIcon(slug: string): ControlledIconComponent | undefined {
  const cached = controlledIconRegistry.get(slug);
  if (cached) {
    return cached;
  }

  const raw = rawIconRegistry.get(slug);
  if (!raw) {
    return undefined;
  }

  const icon = createControlledIcon(raw);
  controlledIconRegistry.set(slug, icon);
  return icon;
}

function getRequiredIcon(slug: string): ControlledIconComponent {
  const icon = getControlledIcon(slug);
  if (!icon) {
    throw new Error(`Missing Its Hover icon: ${slug}`);
  }
  return icon;
}

export {type AnimatedIconHandle};

export const MenuIcon = getRequiredIcon('align-center-icon');
export const ChevronLeftIcon = getRequiredIcon('arrow-narrow-left-icon');
export const ChevronRightIcon = getRequiredIcon('arrow-narrow-right-icon');
export const MusicIcon = getRequiredIcon('vinyl-icon');
export const CloseIcon = getRequiredIcon('x-icon');

const ICON_ALIASES: Record<string, string> = {
  activity: 'scan-heart-icon',
  'apple-whole': 'banana-icon',
  ban: 'x-icon',
  'banknote-arrow-up': 'credit-card',
  bed: 'moon-icon',
  'biceps-flexed': 'focus-icon',
  brain: 'bulb-svg',
  briefcase: 'gear-icon',
  calculator: 'coin-bitcoin-icon',
  'book-open': 'book-icon',
  'book-open-text': 'book-icon',
  'chart-candlestick': 'coin-bitcoin-icon',
  'chart-column': 'coin-bitcoin-icon',
  'chart-network': 'keyframes-icon',
  clock: 'alarm-clock-plus-icon',
  'code-branch': 'terminal-icon',
  coins: 'coin-bitcoin-icon',
  compass: 'world-icon',
  film: 'player-icon',
  gem: 'star-icon',
  heart: 'heart-icon',
  house: 'home-icon',
  industry: 'gear-icon',
  'messages-square': 'send-icon',
  'piggy-bank': 'coin-bitcoin-icon',
  receipt: 'credit-card',
  rocket: 'rocket-icon',
  route: 'arrow-back-up-icon',
  shield: 'shield-check',
  'shield-check': 'shield-check',
  spade: 'target-icon',
  'sport-shoe': 'battery-charging-icon',
  stethoscope: 'scan-heart-icon',
  target: 'target-icon',
  'tent-tree': 'world-icon',
  trophy: 'star-icon',
  user: 'user-icon',
  'user-graduate': 'user-icon',
  users: 'users-icon',
  wallet: 'wallet-icon',
  'bulb-icon': 'bulb-svg',
  'check-icon': 'simple-checked-icon',
  'nxt-icon': 'brand-nextjs-icon',
  'phone-icon': 'telephone-icon',
  'play-icon': 'player-icon',
  'sun-icon': 'brightness-down-icon',
  'text-icon': 'letter-t-icon',
};

export function getItsHoverIcon(
  name?: string,
): ControlledIconComponent | undefined {
  if (!name) {
    return undefined;
  }

  return getControlledIcon(ICON_ALIASES[name] ?? name);
}
