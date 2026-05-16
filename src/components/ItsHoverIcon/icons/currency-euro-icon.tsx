import { forwardRef, useImperativeHandle } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "motion/react";

const CurrencyEuroIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
  (
    { size = 24, color = "currentColor", strokeWidth = 2, className = "" },
    ref,
  ) => {
    const [scope, animate] = useAnimate();

    const start = async () => {
      await animate(
        ".eur-curve, .eur-line",
        { pathLength: 0, opacity: 0 },
        { duration: 0 },
      );

      await animate(
        ".eur-line",
        { pathLength: 1, opacity: 1 },
        { duration: 0.25, ease: "easeOut" },
      );

      await animate(
        ".eur-curve",
        { pathLength: 1, opacity: 1 },
        { duration: 0.4, ease: "easeOut" },
      );

      animate(
        ".eur-symbol",
        { scale: [0.96, 1] },
        { duration: 0.2, ease: "easeOut" },
      );
    };

    const stop = () => {
      animate(
        ".eur-curve, .eur-line",
        { pathLength: 1, opacity: 1 },
        { duration: 0.2 },
      );
      animate(".eur-symbol", { scale: 1 }, { duration: 0.2 });
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
      <motion.div
        ref={scope}
        onHoverStart={handleHoverStart}
        onHoverEnd={handleHoverEnd}
        className={`inline-flex cursor-pointer items-center justify-center ${className}`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path stroke="none" d="M0 0h24v24H0z" fill="none" />

          <motion.g
            className="eur-symbol"
            style={{ transformOrigin: "50% 50%" }}
          >
            <motion.path
              className="eur-curve"
              d="M17.2 7a6 7 0 1 0 0 10"
              pathLength={1}
            />
            <motion.path className="eur-line" d="M13 10h-8" pathLength={1} />
            <motion.path className="eur-line" d="M5 14h8" pathLength={1} />
          </motion.g>
        </svg>
      </motion.div>
    );
  },
);

CurrencyEuroIcon.displayName = "CurrencyEuroIcon";

export default CurrencyEuroIcon;
