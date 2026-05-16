import { forwardRef, useImperativeHandle, useCallback } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "motion/react";

const DrumIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
  (
    { size = 24, color = "currentColor", strokeWidth = 2, className = "" },
    ref,
  ) => {
    const [scope, animate] = useAnimate();

    const start = useCallback(async () => {
      animate(
        ".sticks",
        { y: [0, 3, 0, 3, 0] },
        { duration: 0.6, ease: "easeInOut" },
      );
      animate(
        ".drum-body",
        { scaleY: [1, 0.98, 1, 0.98, 1] },
        { duration: 0.6, ease: "easeInOut" },
      );
      await animate(
        ".drum-top",
        { scaleX: [1, 1.05, 1, 1.05, 1] },
        { duration: 0.6, ease: "easeInOut" },
      );
    }, [animate]);

    const stop = useCallback(() => {
      animate(
        ".sticks, .drum-body, .drum-top",
        { x: 0, y: 0, scaleX: 1, scaleY: 1 },
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
        <motion.path className="sticks" d="m2 2 8 8" />
        <motion.path className="sticks" d="m22 2-8 8" />
        <motion.ellipse
          className="drum-top"
          cx="12"
          cy="9"
          rx="10"
          ry="5"
          style={{ transformOrigin: "12px 9px" }}
        />
        <motion.path className="drum-body" d="M7 13.4v7.9" />
        <motion.path className="drum-body" d="M12 14v8" />
        <motion.path className="drum-body" d="M17 13.4v7.9" />
        <motion.path
          className="drum-body"
          style={{ transformOrigin: "12px 13px" }}
          d="M2 9v8a10 5 0 0 0 20 0V9"
        />
      </motion.svg>
    );
  },
);

DrumIcon.displayName = "DrumIcon";
export default DrumIcon;
