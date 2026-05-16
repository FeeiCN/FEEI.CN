import { forwardRef, useImperativeHandle, useCallback } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "motion/react";

const ChartHistogramIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
  (
    { size = 24, color = "currentColor", strokeWidth = 2, className = "" },
    ref,
  ) => {
    const [scope, animate] = useAnimate();

    const start = useCallback(() => {
      animate(
        ".histogram-bar-1",
        { scaleY: [0, 1] },
        { duration: 0.25, ease: "easeOut" },
      );
      animate(
        ".histogram-bar-2",
        { scaleY: [0, 1] },
        { duration: 0.25, ease: "easeOut", delay: 0.08 },
      );
      animate(
        ".histogram-bar-3",
        { scaleY: [0, 1] },
        { duration: 0.25, ease: "easeOut", delay: 0.16 },
      );
      animate(
        ".histogram-bar-4",
        { scaleY: [0, 1] },
        { duration: 0.25, ease: "easeOut", delay: 0.24 },
      );
      animate(
        ".histogram-curve",
        { pathLength: [0, 1] },
        { duration: 0.5, ease: "easeInOut", delay: 0.3 },
      );
    }, [animate]);

    const stop = useCallback(() => {
      animate(
        ".histogram-bar-1, .histogram-bar-2, .histogram-bar-3, .histogram-bar-4",
        { scaleY: 1 },
        { duration: 0.2, ease: "easeInOut" },
      );
      animate(
        ".histogram-curve",
        { pathLength: 1 },
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
        <path stroke="none" d="M0 0h24v24H0z" fill="none" />

        <path d="M3 3v18h18" />

        <motion.path
          d="M20 18v3"
          className="histogram-bar-4"
          style={{ transformOrigin: "20px 21px" }}
        />
        <motion.path
          d="M16 16v5"
          className="histogram-bar-3"
          style={{ transformOrigin: "16px 21px" }}
        />
        <motion.path
          d="M12 13v8"
          className="histogram-bar-2"
          style={{ transformOrigin: "12px 21px" }}
        />
        <motion.path
          d="M8 16v5"
          className="histogram-bar-1"
          style={{ transformOrigin: "8px 21px" }}
        />

        <motion.path
          d="M3 11c6 0 5 -5 9 -5s3 5 9 5"
          className="histogram-curve"
          initial={{ pathLength: 1 }}
        />
      </motion.svg>
    );
  },
);

ChartHistogramIcon.displayName = "ChartHistogramIcon";
export default ChartHistogramIcon;
