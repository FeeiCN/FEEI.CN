import { forwardRef, useImperativeHandle } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "motion/react";

const BellOffIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
  (
    { size = 24, color = "currentColor", strokeWidth = 2, className = "" },
    ref,
  ) => {
    const [scope, animate] = useAnimate();

    const start = async () => {
      animate(
        ".bell",
        { x: [-1, 1, -1, 1, 0] },
        { duration: 0.4, ease: "easeInOut" },
      );
      await animate(
        ".slash",
        { pathLength: [0, 1], opacity: [0, 1] },
        { duration: 0.5, ease: "easeOut" },
      );
    };

    const stop = () => {
      animate(".slash", { pathLength: 1, opacity: 1 }, { duration: 0.2 });
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
      >
        <motion.path className="bell" d="M10.268 21a2 2 0 0 0 3.464 0" />
        <motion.path
          className="bell"
          d="M17 17H4a1 1 0 0 1-.74-1.673C4.59 13.956 6 12.499 6 8a6 6 0 0 1 .258-1.742"
        />
        <motion.path
          className="slash"
          d="m2 2 20 20"
          initial={{ pathLength: 1, opacity: 1 }}
        />
        <motion.path
          className="bell"
          d="M8.668 3.01A6 6 0 0 1 18 8c0 2.687.77 4.653 1.707 6.05"
        />
      </motion.svg>
    );
  },
);

BellOffIcon.displayName = "BellOffIcon";

export default BellOffIcon;
