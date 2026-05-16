import {forwardRef, useImperativeHandle} from 'react';
import type {AnimatedIconHandle, AnimatedIconProps} from './types';
import {motion, useAnimate} from 'motion/react';

const ChartPieIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
  ({size = 24, color = 'currentColor', strokeWidth = 2, className = ''}, ref) => {
    const [scope, animate] = useAnimate();

    const start = async () => {
      animate(
        '.pie-main',
        {pathLength: [0, 1]},
        {duration: 0.5, ease: 'easeOut'},
      );

      animate(
        '.pie-slice',
        {pathLength: [0, 1], rotate: [0, 5]},
        {duration: 0.4, ease: 'easeOut', delay: 0.2},
      );
    };

    const stop = async () => {
      animate(
        '.pie-main',
        {pathLength: 1},
        {duration: 0.2, ease: 'easeInOut'},
      );

      animate(
        '.pie-slice',
        {pathLength: 1, rotate: 0},
        {duration: 0.2, ease: 'easeInOut'},
      );
    };

    useImperativeHandle(ref, () => ({
      startAnimation: start,
      stopAnimation: stop,
    }));

    return (
      <motion.svg
        ref={scope}
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`cursor-pointer ${className}`}
        onHoverStart={start}
        onHoverEnd={stop}
      >
        <path stroke="none" d="M0 0h24v24H0z" fill="none" />
        <motion.path
          d="M10 3.2a9 9 0 1 0 10.8 10.8a1 1 0 0 0 -1 -1h-6.8a2 2 0 0 1 -2 -2v-7a.9 .9 0 0 0 -1 -.8"
          className="pie-main"
          initial={{pathLength: 1}}
        />
        <motion.path
          d="M15 3.5a9 9 0 0 1 5.5 5.5h-4.5a1 1 0 0 1 -1 -1v-4.5"
          className="pie-slice"
          style={{transformOrigin: '17.5px 6px'}}
          initial={{pathLength: 1}}
        />
      </motion.svg>
    );
  },
);

ChartPieIcon.displayName = 'ChartPieIcon';

export default ChartPieIcon;
