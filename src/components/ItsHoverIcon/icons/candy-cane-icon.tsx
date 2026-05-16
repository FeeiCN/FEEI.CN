import { forwardRef, useImperativeHandle } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "motion/react";

const CandyCaneIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
  (
    { size = 24, color = "currentColor", strokeWidth = 2, className = "" },
    ref,
  ) => {
    const [scope, animate] = useAnimate();

    const start = async () => {
      animate(
        ".cane",
        { rotate: [0, -10, 10, -5, 5, 0] },
        { duration: 0.6, ease: "easeInOut" },
      );
    };

    const stop = () => {
      animate(".cane", { rotate: 0 }, { duration: 0.2, ease: "easeInOut" });
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
        <motion.g className="cane" style={{ transformOrigin: "12px 12px" }}>
          <path d="M5.7 21a2 2 0 0 1-3.5-2l8.6-14a6 6 0 0 1 10.4 6 2 2 0 1 1-3.464-2 2 2 0 1 0-3.464-2Z" />
          <path d="M17.75 7 15 2.1" />
          <path d="M10.9 4.8 13 9" />
          <path d="m7.9 9.7 2 4.4" />
          <path d="M4.9 14.7 7 18.9" />
        </motion.g>
      </motion.svg>
    );
  },
);

CandyCaneIcon.displayName = "CandyCaneIcon";

export default CandyCaneIcon;
