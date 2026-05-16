import { forwardRef, useImperativeHandle, useCallback } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "motion/react";

const MehIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
  (
    { size = 24, color = "currentColor", strokeWidth = 2, className = "" },
    ref,
  ) => {
    const [scope, animate] = useAnimate();

    const start = useCallback(async () => {
      animate(
        ".eyes",
        { scaleY: [1, 0.3, 1, 0.3, 1] },
        { duration: 0.8, ease: "easeInOut" },
      );
      await animate(
        ".mouth",
        { scaleX: [1, 0.9, 1] },
        { duration: 0.5, ease: "easeInOut" },
      );
    }, [animate]);

    const stop = useCallback(() => {
      animate(
        ".eyes, .mouth",
        { scaleY: 1, scaleX: 1 },
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
        <circle cx="12" cy="12" r="10" />
        <motion.line
          className="mouth"
          x1="8"
          x2="16"
          y1="15"
          y2="15"
          style={{ transformOrigin: "12px 15px" }}
        />
        <motion.line
          className="eyes"
          x1="9"
          x2="9.01"
          y1="9"
          y2="9"
          style={{ transformOrigin: "9px 9px" }}
        />
        <motion.line
          className="eyes"
          x1="15"
          x2="15.01"
          y1="9"
          y2="9"
          style={{ transformOrigin: "15px 9px" }}
        />
      </motion.svg>
    );
  },
);

MehIcon.displayName = "MehIcon";
export default MehIcon;
