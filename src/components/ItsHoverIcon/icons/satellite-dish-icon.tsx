import { forwardRef, useImperativeHandle, useCallback } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "motion/react";

const SatelliteDishIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
  (
    { size = 24, color = "currentColor", strokeWidth = 2, className = "" },
    ref,
  ) => {
    const [scope, animate] = useAnimate();

    const start = useCallback(async () => {
      animate(
        ".signal-inner",
        {
          scale: [1, 1.15, 1],
          opacity: [1, 0.6, 1],
        },
        {
          duration: 0.6,
          ease: "easeInOut",
        },
      );

      await animate(
        ".signal-outer",
        {
          scale: [1, 1.25, 1],
          opacity: [1, 0.4, 1],
        },
        {
          duration: 0.7,
          ease: "easeInOut",
          delay: 0.1,
        },
      );

      animate(
        ".dish",
        {
          rotate: [0, -2, 2, 0],
        },
        {
          duration: 0.5,
          ease: "easeInOut",
        },
      );
    }, [animate]);

    const stop = useCallback(() => {
      animate(
        ".signal-inner, .signal-outer, .dish",
        { scale: 1, opacity: 1, rotate: 0 },
        { duration: 0.2, ease: "easeInOut" },
      );
    }, [animate]);

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
        <motion.path
          className="dish"
          d="M4 10a7.31 7.31 0 0 0 10 10Z"
          style={{ transformOrigin: "9px 15px" }}
        />

        <path d="m9 15 3-3" />

        <motion.path
          className="signal-inner"
          d="M17 13a6 6 0 0 0-6-6"
          style={{ transformOrigin: "14px 10px" }}
        />

        <motion.path
          className="signal-outer"
          d="M21 13A10 10 0 0 0 11 3"
          style={{ transformOrigin: "16px 8px" }}
        />
      </motion.svg>
    );
  },
);

SatelliteDishIcon.displayName = "SatelliteDishIcon";
export default SatelliteDishIcon;
