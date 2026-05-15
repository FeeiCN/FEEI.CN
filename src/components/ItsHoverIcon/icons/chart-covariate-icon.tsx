import { forwardRef, useImperativeHandle, useCallback } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "motion/react";

const ChartCovariateIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
  (
    { size = 24, color = "currentColor", strokeWidth = 2, className = "" },
    ref,
  ) => {
    const [scope, animate] = useAnimate();

    const start = useCallback(() => {
      animate(
        ".dot-1",
        { scale: [0, 1.2, 1], opacity: [0, 1] },
        { duration: 0.25, ease: "easeOut" },
      );
      animate(
        ".dot-2",
        { scale: [0, 1.2, 1], opacity: [0, 1] },
        { duration: 0.25, ease: "easeOut", delay: 0.08 },
      );
      animate(
        ".dot-3",
        { scale: [0, 1.2, 1], opacity: [0, 1] },
        { duration: 0.25, ease: "easeOut", delay: 0.16 },
      );
      animate(
        ".dot-4",
        { scale: [0, 1.2, 1], opacity: [0, 1] },
        { duration: 0.25, ease: "easeOut", delay: 0.24 },
      );
      animate(
        ".trend-line",
        { pathLength: [0, 1] },
        { duration: 0.5, ease: "easeInOut", delay: 0.3 },
      );
    }, [animate]);

    const stop = useCallback(() => {
      animate(
        ".dot-1 , .dot-2 , .dot-3 , .dot-4",
        { scale: 1, opacity: 1 },
        { duration: 0.2, ease: "easeInOut" },
      );
      animate(
        ".trend-line",
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
        <motion.path
          d="M18 11h.009"
          className="dot-4"
          style={{ transformOrigin: "18px 11px" }}
        />
        <motion.path
          d="M14 15h.009"
          className="dot-3"
          style={{ transformOrigin: "14px 15px" }}
        />
        <motion.path
          d="M12 6h.009"
          className="dot-2"
          style={{ transformOrigin: "12px 6px" }}
        />
        <motion.path
          d="M8 10h.009"
          className="dot-1"
          style={{ transformOrigin: "8px 10px" }}
        />
        <motion.path
          d="M3 21l17 -17"
          className="trend-line"
          initial={{ pathLength: 1 }}
        />
        <path d="M3 3v18h18" />
      </motion.svg>
    );
  },
);

ChartCovariateIcon.displayName = "ChartCovariateIcon";
export default ChartCovariateIcon;
