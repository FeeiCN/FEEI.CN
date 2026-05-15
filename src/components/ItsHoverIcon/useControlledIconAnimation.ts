import {useEffect, useRef} from 'react';
import type {AnimatedIconHandle} from './icons/types';

export default function useControlledIconAnimation(isAnimated: boolean = true) {
  const iconRef = useRef<AnimatedIconHandle>(null);

  useEffect(() => {
    if (!isAnimated) {
      iconRef.current?.stopAnimation();
    }
  }, [isAnimated]);

  return {
    iconRef,
    disableHover: true,
    onMouseEnter: () => {
      if (isAnimated) {
        iconRef.current?.startAnimation();
      }
    },
    onMouseLeave: () => {
      if (isAnimated) {
        iconRef.current?.stopAnimation();
      }
    },
  };
}
