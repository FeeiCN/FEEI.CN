import clsx from 'clsx';
import useIsBrowser from '@docusaurus/useIsBrowser';
import {useColorMode} from '@docusaurus/theme-common';
import IconLightMode from '@theme/Icon/LightMode';
import IconDarkMode from '@theme/Icon/DarkMode';
import type {Props} from '@theme/ColorModeToggle';
import styles from './styles.module.css';

export default function ColorModeToggle({className, buttonClassName, onChange}: Props) {
  const {colorMode} = useColorMode();
  const isBrowser = useIsBrowser();
  const nextMode = colorMode === 'dark' ? 'light' : 'dark';
  const label = nextMode === 'light' ? '切换为浅色模式' : '切换为深色模式';

  return <div className={clsx(styles.toggle, className)}>
    <button type="button" className={clsx('clean-btn', styles.button, buttonClassName)} disabled={!isBrowser}
      onClick={() => onChange(nextMode)} title={label} aria-label={label}>
      <IconLightMode aria-hidden className={styles.lightIcon} />
      <IconDarkMode aria-hidden className={styles.darkIcon} />
    </button>
  </div>;
}
