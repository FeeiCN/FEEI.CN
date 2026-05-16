import {forwardRef, useImperativeHandle} from 'react';
import type {AnimatedIconHandle, AnimatedIconProps} from './types';
import {motion, useAnimate} from 'motion/react';

const CoffeeIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
  ({size = 24, color = 'currentColor', strokeWidth = 2, className = ''}, ref) => {
    const [scope, animate] = useAnimate();

    const start = async () => {
      animate(
        '.steam',
        {
          y: -2,
          opacity: [1, 0.5, 0],
        },
        {
          duration: 0.5,
          ease: 'easeOut',
        },
      );
    };

    const stop = () => {
      animate(
        '.steam',
        {
          y: 0,
          opacity: [1, 0.5, 1],
        },
        {
          duration: 0.5,
          ease: 'easeOut',
        },
      );
    };

    useImperativeHandle(ref, () => {
      return {
        startAnimation: start,
        stopAnimation: stop,
      };
    });

    const handleHoverStart = () => {
      start();
    };

    const handleHoverEnd = () => {
      stop();
    };

    return (
      <motion.svg
        ref={scope}
        onHoverStart={handleHoverStart}
        onHoverEnd={handleHoverEnd}
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
        style={{overflow: 'visible'}}
      >
        <motion.path className="steam" d="M6 2v3" />
        <motion.path className="steam" d="M10 2v3" />
        <motion.path className="steam" d="M14 2v3" />

        <path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1" />
      </motion.svg>
    );
  },
);

CoffeeIcon.displayName = 'CoffeeIcon';

export default CoffeeIcon;
