import { forwardRef, useImperativeHandle, useCallback } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "motion/react";

const RainbowIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
  (
    { size = 24, color = "currentColor", strokeWidth = 2, className = "" },
    ref,
  ) => {
    const [scope, animate] = useAnimate();

    const start = useCallback(async () => {
      animate(
        ".arc1",
        { pathLength: [0, 1] },
        { duration: 0.6, ease: "easeOut" },
      );
      animate(
        ".arc2",
        { pathLength: [0, 1] },
        { duration: 0.6, ease: "easeOut", delay: 0.1 },
      );
      await animate(
        ".arc3",
        { pathLength: [0, 1] },
        { duration: 0.6, ease: "easeOut", delay: 0.2 },
      );
    }, [animate]);

    const stop = useCallback(() => {
      animate(".arc1, .arc2, .arc3", { pathLength: 1 }, { duration: 0.2 });
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
          className="arc1"
          d="M22 17a10 10 0 0 0-20 0"
          initial={{ pathLength: 1 }}
        />
        <motion.path
          className="arc2"
          d="M6 17a6 6 0 0 1 12 0"
          initial={{ pathLength: 1 }}
        />
        <motion.path
          className="arc3"
          d="M10 17a2 2 0 0 1 4 0"
          initial={{ pathLength: 1 }}
        />
      </motion.svg>
    );
  },
);

RainbowIcon.displayName = "RainbowIcon";
export default RainbowIcon;
