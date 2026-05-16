import { forwardRef, useImperativeHandle } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "motion/react";

const AngryIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
  (
    { size = 24, color = "currentColor", strokeWidth = 2, className = "" },
    ref,
  ) => {
    const [scope, animate] = useAnimate();

    const start = async () => {
      animate(
        ".eyebrows",
        { y: 1, scaleY: 1.2 },
        { duration: 0.3, ease: "easeOut" },
      );
      animate(".mouth", { scaleY: 1.2 }, { duration: 0.3, ease: "easeOut" });
      animate(".eyes", { scale: 0.8 }, { duration: 0.3, ease: "easeOut" });
    };

    const stop = () => {
      animate(
        ".eyebrows",
        { y: 0, scaleY: 1 },
        { duration: 0.2, ease: "easeInOut" },
      );
      animate(".mouth", { scaleY: 1 }, { duration: 0.2, ease: "easeInOut" });
      animate(".eyes", { scale: 1 }, { duration: 0.2, ease: "easeInOut" });
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
        <circle cx="12" cy="12" r="10" />
        <motion.path
          className="mouth"
          style={{ transformOrigin: "12px 16px" }}
          d="M16 16s-1.5-2-4-2-4 2-4 2"
        />
        <motion.g className="eyebrows">
          <path d="M7.5 8 10 9" />
          <path d="m14 9 2.5-1" />
        </motion.g>
        <motion.g className="eyes">
          <path d="M9 10h.01" />
          <path d="M15 10h.01" />
        </motion.g>
      </motion.svg>
    );
  },
);

AngryIcon.displayName = "AngryIcon";

export default AngryIcon;
