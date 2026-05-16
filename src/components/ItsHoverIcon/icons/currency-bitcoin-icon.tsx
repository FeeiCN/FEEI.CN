import { forwardRef, useImperativeHandle } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "motion/react";

const CurrencyBitcoinIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
  (
    { size = 24, color = "currentColor", strokeWidth = 2, className = "" },
    ref,
  ) => {
    const [scope, animate] = useAnimate();

    const start = async () => {
      await animate(
        ".btc-main, .btc-lines, .btc-center",
        { pathLength: 0, opacity: 0 },
        { duration: 0 },
      );

      await animate(
        ".btc-lines",
        { pathLength: 1, opacity: 1 },
        { duration: 0.25, ease: "easeOut" },
      );

      await animate(
        ".btc-main",
        { pathLength: 1, opacity: 1 },
        { duration: 0.35, ease: "easeOut" },
      );

      await animate(
        ".btc-center",
        { pathLength: 1, opacity: 1 },
        { duration: 0.2, ease: "easeOut" },
      );

      animate(
        ".btc-symbol",
        { scale: [0.95, 1] },
        { duration: 0.2, ease: "easeOut" },
      );
    };

    const stop = () => {
      animate(
        ".btc-main, .btc-lines, .btc-center",
        { pathLength: 1, opacity: 1 },
        { duration: 0.2 },
      );
      animate(".btc-symbol", { scale: 1 }, { duration: 0.2 });
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
            className="btc-symbol"
            style={{ transformOrigin: "50% 50%" }}
          >
            <motion.g className="btc-main">
              <motion.path
                d="M6 6h8a3 3 0 0 1 0 6a3 3 0 0 1 0 6h-8"
                pathLength={1}
              />
              <motion.path d="M8 6l0 12" pathLength={1} />
            </motion.g>

            <motion.path className="btc-center" d="M8 12l6 0" pathLength={1} />

            <motion.g className="btc-lines">
              <motion.path d="M9 3l0 3" pathLength={1} />
              <motion.path d="M13 3l0 3" pathLength={1} />
              <motion.path d="M9 18l0 3" pathLength={1} />
              <motion.path d="M13 18l0 3" pathLength={1} />
            </motion.g>
          </motion.g>
        </svg>
      </motion.div>
    );
  },
);

CurrencyBitcoinIcon.displayName = "CurrencyBitcoinIcon";

export default CurrencyBitcoinIcon;
