import { forwardRef, useImperativeHandle, useCallback } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "motion/react";

const ScanHeartIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
  (
    { size = 24, color = "currentColor", strokeWidth = 2, className = "" },
    ref,
  ) => {
    const [scope, animate] = useAnimate();

    const start = useCallback(async () => {
      animate(".heart", { scale: 1.3 }, { duration: 0.25, ease: "easeOut" });
      animate(".corners", { scale: 0.85 }, { duration: 0.25, ease: "easeOut" });
    }, [animate]);

    const stop = useCallback(() => {
      animate(
        ".heart, .corners",
        { scale: 1 },
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
        <motion.path className="corners" d="M17 3h2a2 2 0 0 1 2 2v2" />
        <motion.path className="corners" d="M21 17v2a2 2 0 0 1-2 2h-2" />
        <motion.path className="corners" d="M3 7V5a2 2 0 0 1 2-2h2" />
        <motion.path className="corners" d="M7 21H5a2 2 0 0 1-2-2v-2" />
        <motion.path
          className="heart"
          style={{ transformOrigin: "12px 13px" }}
          d="M7.828 13.07A3 3 0 0 1 12 8.764a3 3 0 0 1 4.172 4.306l-3.447 3.62a1 1 0 0 1-1.449 0z"
        />
      </motion.svg>
    );
  },
);

ScanHeartIcon.displayName = "ScanHeartIcon";
export default ScanHeartIcon;
