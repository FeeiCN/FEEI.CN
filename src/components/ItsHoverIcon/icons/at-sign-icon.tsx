import { forwardRef, useImperativeHandle } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "motion/react";

const AtSignIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
  (
    { size = 24, color = "currentColor", strokeWidth = 2, className = "" },
    ref,
  ) => {
    const [scope, animate] = useAnimate();

    const start = async () => {
      animate(".draw", { pathLength: 0, opacity: 0 }, { duration: 0 });

      await animate(
        ".outer",
        { pathLength: [0, 1], opacity: [0, 1] },
        { duration: 0.45, ease: "easeOut" },
      );

      await animate(
        ".path",
        { pathLength: [0, 1], opacity: [0, 1] },
        { duration: 0.6, ease: "easeOut" },
      );

      animate(
        ".inner",
        { pathLength: [0, 1], opacity: [0, 1] },
        { duration: 0.3, ease: "easeOut" },
      );
    };

    const stop = () => {
      animate(".draw", { pathLength: 1, opacity: 1 }, { duration: 0.2 });
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
        <motion.circle
          className="draw inner"
          cx="12"
          cy="12"
          r="4"
          initial={{ pathLength: 1, opacity: 1 }}
        />
        <motion.path
          className="draw path"
          d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"
          initial={{ pathLength: 1, opacity: 1 }}
        />
        <motion.circle
          className="draw outer"
          cx="12"
          cy="12"
          r="10"
          initial={{ pathLength: 1, opacity: 1 }}
        />
      </motion.svg>
    );
  },
);

AtSignIcon.displayName = "AtSignIcon";

export default AtSignIcon;
