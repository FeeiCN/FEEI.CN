import { forwardRef, useImperativeHandle, useCallback } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "motion/react";

const FocusIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
  (
    { size = 24, color = "currentColor", strokeWidth = 2, className = "" },
    ref,
  ) => {
    const [scope, animate] = useAnimate();

    const start = useCallback(async () => {
      animate(".center", { scale: 1.4 }, { duration: 0.25, ease: "easeOut" });

      animate(".corners", { scale: 0.85 }, { duration: 0.25, ease: "easeOut" });
    }, [animate]);

    const stop = useCallback(() => {
      animate(
        ".center, .corners",
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
        <motion.circle
          className="center"
          cx="12"
          cy="12"
          r="3"
          style={{ transformOrigin: "12px 12px" }}
        />
        <motion.path className="corners" d="M3 7V5a2 2 0 0 1 2-2h2" />
        <motion.path className="corners" d="M17 3h2a2 2 0 0 1 2 2v2" />
        <motion.path className="corners" d="M21 17v2a2 2 0 0 1-2 2h-2" />
        <motion.path className="corners" d="M7 21H5a2 2 0 0 1-2-2v-2" />
      </motion.svg>
    );
  },
);

FocusIcon.displayName = "FocusIcon";
export default FocusIcon;
