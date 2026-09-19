import {forwardRef, useImperativeHandle} from 'react';
import {motion, useAnimate} from 'motion/react';
import type {AnimatedIconHandle, AnimatedIconProps} from './types';

const ShuffleIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
  ({size = 24, color = 'currentColor', strokeWidth = 2, className = ''}, ref) => {
    const [scope, animate] = useAnimate();
    const start = () => animate('.shuffle-arrow', {x: [0, 1.5, 0]}, {duration: 0.35});
    const stop = () => animate('.shuffle-arrow', {x: 0}, {duration: 0.15});

    useImperativeHandle(ref, () => ({startAnimation: start, stopAnimation: stop}));

    return (
      <motion.svg ref={scope} xmlns="http://www.w3.org/2000/svg" width={size} height={size}
        viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth}
        strokeLinecap="round" strokeLinejoin="round" className={className}
        onHoverStart={start} onHoverEnd={stop}>
        <path d="M4 7h3.5c4.5 0 4.5 10 9 10H20" />
        <path d="M4 17h3.5c1.7 0 2.8-1.4 3.8-3" />
        <path d="M14.2 9.8C15 8.2 15.8 7 17 7h3" />
        <motion.path className="shuffle-arrow" d="m17 4 3 3-3 3M17 14l3 3-3 3" />
      </motion.svg>
    );
  },
);

ShuffleIcon.displayName = 'ShuffleIcon';

export default ShuffleIcon;
