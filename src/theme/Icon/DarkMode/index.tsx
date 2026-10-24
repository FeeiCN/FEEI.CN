import type {Props} from '@theme/Icon/DarkMode';
import {getItsHoverIcon} from '@site/src/components/ItsHoverIcon';

const MoonIcon = getItsHoverIcon('moon-icon')!;

export default function IconDarkMode({className, style, 'aria-hidden': ariaHidden}: Props) {
  return <span className={className} style={{lineHeight: 0, ...style}} aria-hidden={ariaHidden}>
    <MoonIcon size={24} strokeWidth={1.6} />
  </span>;
}
