import { forwardRef, useImperativeHandle } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "motion/react";

const FlameIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
  (
    { size = 24, color = "currentColor", strokeWidth = 2, className = "" },
    ref,
  ) => {
    const [scope, animate] = useAnimate();

    const start = async () => {
      await animate(
        ".flame-group",
        {
          y: [0, -2, -1, -2, 0],
          rotate: [0, 4, -3, 2, 0],
          x: [0, 1, -1, 0.5, 0],
        },
        {
          duration: 0.6,
          ease: "easeOut",
        },
      );
    };

    const stop = () => {
      animate(
        ".flame-group",
        { x: 0, y: 0, rotate: 0 },
        { duration: 0.2, ease: "easeOut" },
      );
    };

    useImperativeHandle(ref, () => ({
      startAnimation: start,
      stopAnimation: stop,
    }));

    return (
      <motion.svg
        ref={scope}
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`cursor-pointer ${className}`}
        style={{ overflow: "visible" }}
        onHoverStart={start}
        onHoverEnd={stop}
      >
        <motion.g
          className="flame-group"
          style={{
            transformOrigin: "50% 100%",
            transformBox: "fill-box",
          }}
        >
          <motion.path d="M12 10.941c2.333 -3.308 .167 -7.823 -1 -8.941c0 3.395 -2.235 5.299 -3.667 6.706c-1.43 1.408 -2.333 3.621 -2.333 5.588c0 3.704 3.134 6.706 7 6.706s7 -3.002 7 -6.706c0 -1.712 -1.232 -4.403 -2.333 -5.588c-2.084 3.353 -3.257 3.353 -4.667 2.235" />
        </motion.g>
      </motion.svg>
    );
  },
);

FlameIcon.displayName = "FlameIcon";
export default FlameIcon;
