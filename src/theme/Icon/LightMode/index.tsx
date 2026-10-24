import type {Props} from '@theme/Icon/LightMode';
import {getItsHoverIcon} from '@site/src/components/ItsHoverIcon';

const SunIcon = getItsHoverIcon('brightness-down-icon')!;

export default function IconLightMode({className, style, 'aria-hidden': ariaHidden}: Props) {
  return <span className={className} style={{lineHeight: 0, ...style}} aria-hidden={ariaHidden}>
    <SunIcon size={24} strokeWidth={1.6} />
  </span>;
}
