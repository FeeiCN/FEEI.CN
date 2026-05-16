import { forwardRef, useImperativeHandle, useCallback } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "motion/react";

const ExpandIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
  (
    { size = 24, color = "currentColor", strokeWidth = 2, className = "" },
    ref,
  ) => {
    const [scope, animate] = useAnimate();

    const start = useCallback(async () => {
      animate(
        ".arrows-tr",
        { x: 2, y: -2 },
        { duration: 0.25, ease: "easeOut" },
      );
      animate(
        ".arrows-tl",
        { x: -2, y: -2 },
        { duration: 0.25, ease: "easeOut" },
      );
      animate(
        ".arrows-br",
        { x: 2, y: 2 },
        { duration: 0.25, ease: "easeOut" },
      );
      animate(
        ".arrows-bl",
        { x: -2, y: 2 },
        { duration: 0.25, ease: "easeOut" },
      );

      animate(".corners", { scale: 1.08 }, { duration: 0.25, ease: "easeOut" });
    }, [animate]);

    const stop = useCallback(() => {
      animate(
        ".arrows-tr, .arrows-tl, .arrows-br, .arrows-bl",
        { x: 0, y: 0 },
        { duration: 0.2, ease: "easeInOut" },
      );
      animate(".corners", { scale: 1 }, { duration: 0.2, ease: "easeInOut" });
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
        <motion.path className="arrows-br" d="m15 15 6 6" />
        <motion.path className="arrows-tr" d="m15 9 6-6" />
        <motion.path className="corners arrows-br" d="M21 16v5h-5" />
        <motion.path className="corners arrows-tr" d="M21 8V3h-5" />
        <motion.path className="corners arrows-bl" d="M3 16v5h5" />
        <motion.path className="arrows-bl" d="m3 21 6-6" />
        <motion.path className="corners arrows-tl" d="M3 8V3h5" />
        <motion.path className="arrows-tl" d="M9 9 3 3" />
      </motion.svg>
    );
  },
);

ExpandIcon.displayName = "ExpandIcon";
export default ExpandIcon;
