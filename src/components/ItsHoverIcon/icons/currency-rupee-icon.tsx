import { forwardRef, useImperativeHandle } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "motion/react";

const CurrencyRupeeIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
  (
    { size = 24, color = "currentColor", strokeWidth = 2, className = "" },
    ref,
  ) => {
    const [scope, animate] = useAnimate();

    const start = async () => {
      await animate(
        ".rupee-main, .rupee-line",
        {
          pathLength: 0,
          opacity: 0,
        },
        { duration: 0 },
      );

      await animate(
        ".rupee-line",
        {
          pathLength: 1,
          opacity: 1,
        },
        {
          duration: 0.25,
          ease: "easeOut",
        },
      );

      await animate(
        ".rupee-main",
        {
          pathLength: 1,
          opacity: 1,
        },
        {
          duration: 0.35,
          ease: "easeOut",
        },
      );

      animate(
        ".rupee-symbol",
        {
          scale: [0.96, 1],
        },
        {
          duration: 0.2,
          ease: "easeOut",
        },
      );
    };

    const stop = () => {
      animate(
        ".rupee-main, .rupee-line",
        { pathLength: 1, opacity: 1 },
        { duration: 0.2 },
      );
      animate(".rupee-symbol", { scale: 1 }, { duration: 0.2 });
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
        <path stroke="none" d="M0 0h24v24H0z" fill="none" />

        <motion.g
          className="rupee-symbol"
          style={{ transformOrigin: "50% 50%" }}
        >
          <motion.path
            className="rupee-main"
            d="M18 5h-11h3a4 4 0 0 1 0 8h-3l6 6"
            pathLength={1}
          />

          <motion.path className="rupee-line" d="M7 9l11 0" pathLength={1} />
        </motion.g>
      </motion.svg>
    );
  },
);

CurrencyRupeeIcon.displayName = "CurrencyRupeeIcon";

export default CurrencyRupeeIcon;
