import { forwardRef, useImperativeHandle } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "motion/react";

const ArrowDown10Icon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
  (
    { size = 24, color = "currentColor", strokeWidth = 2, className = "" },
    ref,
  ) => {
    const [scope, animate] = useAnimate();

    const swapDistance = 10;

    const start = async () => {
      animate(
        ".one",
        { y: swapDistance },
        { duration: 0.3, ease: "easeInOut" },
      );
      animate(
        ".zero",
        { y: -swapDistance },
        { duration: 0.3, ease: "easeInOut" },
      );
    };

    const stop = async () => {
      animate(".one, .zero", { y: 0 }, { duration: 0.3, ease: "easeInOut" });
    };

    useImperativeHandle(ref, () => {
      return {
        startAnimation: start,
        stopAnimation: stop,
      };
    });

    const handleHoverStart = () => {
      start();
    };

    const handleHoverEnd = () => {
      stop();
    };

    return (
      <motion.svg
        ref={scope}
        onHoverStart={handleHoverStart}
        onHoverEnd={handleHoverEnd}
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
        <path d="m3 16 4 4 4-4" />
        <path d="M7 20V4" />
        <motion.g className="one">
          <path d="M17 10V4h-2" />
          <path d="M15 10h4" />
        </motion.g>
        <motion.rect
          className="zero"
          x="15"
          y="14"
          width="4"
          height="6"
          ry="2"
        />
      </motion.svg>
    );
  },
);

ArrowDown10Icon.displayName = "ArrowDown10Icon";

export default ArrowDown10Icon;
