import { forwardRef, useImperativeHandle, useCallback } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "motion/react";

const SnapchatIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
  (
    { size = 24, color = "currentColor", strokeWidth = 2, className = "" },
    ref,
  ) => {
    const [scope, animate] = useAnimate();

    const start = useCallback(async () => {
      animate(
        ".ghost",
        { y: [0, -2, 0], scale: [1, 1.05, 1] },
        { duration: 0.6, ease: "easeInOut" },
      );
      animate(
        ".arms",
        { scaleX: [1, 1.1, 1] },
        { duration: 0.4, ease: "easeInOut" },
      );
    }, [animate]);

    const stop = useCallback(() => {
      animate(
        ".ghost, .arms",
        { y: 0, scale: 1, scaleX: 1 },
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
        <path stroke="none" d="M0 0h24v24H0z" fill="none" />
        <motion.path
          className="ghost"
          style={{ transformOrigin: "center" }}
          d="M16.882 7.842a4.882 4.882 0 0 0 -9.764 0c0 4.273 -.213 6.409 -4.118 8.118c2 .882 2 .882 3 3c3 0 4 2 6 2s3 -2 6 -2c1 -2.118 1 -2.118 3 -3c-3.906 -1.709 -4.118 -3.845 -4.118 -8.118z"
        />
        <motion.path
          className="arms"
          style={{ transformOrigin: "center" }}
          d="M3 16.01c4 -2.118 4 -4.118 1 -7.118"
        />
        <motion.path
          className="arms"
          style={{ transformOrigin: "center" }}
          d="M21 16.01c-4 -2.118 -4 -4.118 -1 -7.118"
        />
      </motion.svg>
    );
  },
);

SnapchatIcon.displayName = "SnapchatIcon";
export default SnapchatIcon;
