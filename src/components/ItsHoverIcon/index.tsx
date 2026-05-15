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

import AlarmClockPlusIconRaw from './icons/alarm-clock-plus-icon';
import AlignCenterIconRaw from './icons/align-center-icon';
import ArrowBigUpDashIconRaw from './icons/arrow-big-up-dash-icon';
import ArrowBackUpIconRaw from './icons/arrow-back-up-icon';
import ArrowNarrowLeftIconRaw from './icons/arrow-narrow-left-icon';
import ArrowNarrowRightIconRaw from './icons/arrow-narrow-right-icon';
import AtSignIconRaw from './icons/at-sign-icon';
import BananaIconRaw from './icons/banana-icon';
import BatteryChargingIconRaw from './icons/battery-charging-icon';
import BookIconRaw from './icons/book-icon';
import BrandBagsFmIconRaw from './icons/brand-bags-fm-icon';
import BulbSvgRaw from './icons/bulb-svg';
import ChartCovariateIconRaw from './icons/chart-covariate-icon';
import CoinBitcoinIconRaw from './icons/coin-bitcoin-icon';
import CreditCardRaw from './icons/credit-card';
import FocusIconRaw from './icons/focus-icon';
import GearIconRaw from './icons/gear-icon';
import HeartIconRaw from './icons/heart-icon';
import HomeIconRaw from './icons/home-icon';
import KeyframesIconRaw from './icons/keyframes-icon';
import LikeIconRaw from './icons/like-icon';
import MoonIconRaw from './icons/moon-icon';
import PlayerIconRaw from './icons/player-icon';
import PlugConnectedIconRaw from './icons/plug-connected-icon';
import RocketIconRaw from './icons/rocket-icon';
import ScanHeartIconRaw from './icons/scan-heart-icon';
import SendIconRaw from './icons/send-icon';
import ShieldCheckRaw from './icons/shield-check';
import Stack3IconRaw from './icons/stack-3-icon';
import StarIconRaw from './icons/star-icon';
import TargetIconRaw from './icons/target-icon';
import TerminalIconRaw from './icons/terminal-icon';
import UserIconRaw from './icons/user-icon';
import UserPlusIconRaw from './icons/user-plus-icon';
import UsersIconRaw from './icons/users-icon';
import VinylIconRaw from './icons/vinyl-icon';
import WorldIconRaw from './icons/world-icon';
import XIconRaw from './icons/x-icon';

type RawIconComponent = ComponentType<
  AnimatedIconProps & RefAttributes<AnimatedIconHandle>
>;

export type ControlledAnimatedIconProps = AnimatedIconProps & {
  disableHover?: boolean;
};

export type ControlledIconComponent = ForwardRefExoticComponent<
  ControlledAnimatedIconProps & RefAttributes<AnimatedIconHandle>
>;

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

    useImperativeHandle(ref, () => ({
      startAnimation: () => innerRef.current?.startAnimation(),
      stopAnimation: () => innerRef.current?.stopAnimation(),
    }), []);

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
        style={wrapperStyle}>
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

export {type AnimatedIconHandle};

export const AlarmClockPlusIcon = createControlledIcon(AlarmClockPlusIconRaw);
export const MenuIcon = createControlledIcon(AlignCenterIconRaw);
export const ArrowBigUpDashIcon = createControlledIcon(ArrowBigUpDashIconRaw);
export const ArrowBackUpIcon = createControlledIcon(ArrowBackUpIconRaw);
export const ChevronLeftIcon = createControlledIcon(ArrowNarrowLeftIconRaw);
export const ChevronRightIcon = createControlledIcon(ArrowNarrowRightIconRaw);
export const AtSignIcon = createControlledIcon(AtSignIconRaw);
export const BananaIcon = createControlledIcon(BananaIconRaw);
export const BatteryChargingIcon = createControlledIcon(BatteryChargingIconRaw);
export const BookIcon = createControlledIcon(BookIconRaw);
export const BrandBagsFmIcon = createControlledIcon(BrandBagsFmIconRaw);
export const BulbIcon = createControlledIcon(BulbSvgRaw);
export const ChartCovariateIcon = createControlledIcon(ChartCovariateIconRaw);
export const CoinBitcoinIcon = createControlledIcon(CoinBitcoinIconRaw);
export const CreditCardIcon = createControlledIcon(CreditCardRaw);
export const FocusIcon = createControlledIcon(FocusIconRaw);
export const GearIcon = createControlledIcon(GearIconRaw);
export const HeartIcon = createControlledIcon(HeartIconRaw);
export const HomeIcon = createControlledIcon(HomeIconRaw);
export const KeyframesIcon = createControlledIcon(KeyframesIconRaw);
export const LikeIcon = createControlledIcon(LikeIconRaw);
export const MoonIcon = createControlledIcon(MoonIconRaw);
export const PlayerIcon = createControlledIcon(PlayerIconRaw);
export const PlugConnectedIcon = createControlledIcon(PlugConnectedIconRaw);
export const RocketIcon = createControlledIcon(RocketIconRaw);
export const ScanHeartIcon = createControlledIcon(ScanHeartIconRaw);
export const SendIcon = createControlledIcon(SendIconRaw);
export const ShieldCheckIcon = createControlledIcon(ShieldCheckRaw);
export const Stack3Icon = createControlledIcon(Stack3IconRaw);
export const StarIcon = createControlledIcon(StarIconRaw);
export const TargetIcon = createControlledIcon(TargetIconRaw);
export const TerminalIcon = createControlledIcon(TerminalIconRaw);
export const UserIcon = createControlledIcon(UserIconRaw);
export const UserPlusIcon = createControlledIcon(UserPlusIconRaw);
export const UsersIcon = createControlledIcon(UsersIconRaw);
export const MusicIcon = createControlledIcon(VinylIconRaw);
export const WorldIcon = createControlledIcon(WorldIconRaw);
export const CloseIcon = createControlledIcon(XIconRaw);

const ICONS: Record<string, ControlledIconComponent> = {
  activity: ScanHeartIcon,
  'apple-whole': BananaIcon,
  'arrow-big-up-dash-icon': ArrowBigUpDashIcon,
  'at-sign-icon': AtSignIcon,
  ban: CloseIcon,
  'banknote-arrow-up': CreditCardIcon,
  bed: MoonIcon,
  'biceps-flexed': FocusIcon,
  'book-open': BookIcon,
  'book-open-text': BookIcon,
  'brand-bags-fm-icon': BrandBagsFmIcon,
  brain: BulbIcon,
  briefcase: GearIcon,
  calculator: CoinBitcoinIcon,
  'chart-candlestick': CoinBitcoinIcon,
  'chart-column': CoinBitcoinIcon,
  'chart-covariate-icon': ChartCovariateIcon,
  'chart-line': CoinBitcoinIcon,
  'chart-network': KeyframesIcon,
  'keyframes-icon': KeyframesIcon,
  'chart-pie': CoinBitcoinIcon,
  clock: AlarmClockPlusIcon,
  'code-branch': TerminalIcon,
  coins: CoinBitcoinIcon,
  compass: WorldIcon,
  film: PlayerIcon,
  gem: StarIcon,
  heart: HeartIcon,
  house: HomeIcon,
  'home-icon': HomeIcon,
  industry: GearIcon,
  'list-tree': Stack3Icon,
  'messages-square': SendIcon,
  'piggy-bank': CoinBitcoinIcon,
  'plug-connected-icon': PlugConnectedIcon,
  receipt: CreditCardIcon,
  rocket: RocketIcon,
  route: ArrowBackUpIcon,
  shield: ShieldCheckIcon,
  'shield-check': ShieldCheckIcon,
  spade: TargetIcon,
  'sport-shoe': BatteryChargingIcon,
  stethoscope: ScanHeartIcon,
  target: TargetIcon,
  'tent-tree': WorldIcon,
  trophy: StarIcon,
  user: UserIcon,
  'user-plus-icon': UserPlusIcon,
  'user-graduate': UserIcon,
  users: UsersIcon,
  'users-icon': UsersIcon,
  wallet: CreditCardIcon,
};

export function getItsHoverIcon(
  name?: string,
): ControlledIconComponent | undefined {
  return name ? ICONS[name] : undefined;
}
