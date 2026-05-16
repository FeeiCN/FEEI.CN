import { forwardRef, useImperativeHandle, useCallback } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "motion/react";

const TwitterIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
  (
    { size = 24, color = "currentColor", strokeWidth = 2, className = "" },
    ref,
  ) => {
    const [scope, animate] = useAnimate();

    const start = useCallback(async () => {
      await animate(
        ".bird",
        {
          y: [0, -6, -13],
          x: [0, 4, 8],
          rotate: [0, -8, -16],
          scale: [1, 1.05, 1.1],
          opacity: [1, 1, 0],
        },
        {
          duration: 0.8,
          ease: "easeIn",
        },
      );

      animate(
        ".bird",
        {
          y: 0,
          x: 0,
          rotate: 0,
          scale: 1,
          opacity: 1,
        },
        {
          duration: 0.6,
          ease: "easeOut",
        },
      );
    }, [animate]);

    const stop = useCallback(() => {
      animate(
        ".bird",
        {
          y: 0,
          x: 0,
          rotate: 0,
          scale: 1,
          opacity: 1,
        },
        {
          duration: 0.2,
          ease: "easeOut",
        },
      );
    }, [animate]);

    useImperativeHandle(ref, () => ({
      startAnimation: start,
      stopAnimation: stop,
    }));

    return (
      <motion.svg
        ref={scope}
        onHoverStart={start}
        onHoverEnd={stop}
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
      >
        <motion.path
          className="bird"
          style={{ transformOrigin: "12px 12px" }}
          d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z"
        />
      </motion.svg>
    );
  },
);

TwitterIcon.displayName = "TwitterIcon";
export default TwitterIcon;
