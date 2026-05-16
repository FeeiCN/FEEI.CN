import { forwardRef, useImperativeHandle } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "motion/react";

const AnnoyedIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
  (
    { size = 24, color = "currentColor", strokeWidth = 2, className = "" },
    ref,
  ) => {
    const [scope, animate] = useAnimate();

    const start = async () => {
      animate(".eyes", { scaleX: 0.7 }, { duration: 0.2, ease: "easeOut" });
      animate(".mouth", { y: 1 }, { duration: 0.3, ease: "easeOut" });
    };

    const stop = () => {
      animate(".eyes", { scaleX: 1 }, { duration: 0.2, ease: "easeInOut" });
      animate(".mouth", { y: 0 }, { duration: 0.2, ease: "easeInOut" });
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
        <motion.path className="mouth" d="M8 15h8" />
        <motion.g className="eyes">
          <path d="M8 9h2" />
          <path d="M14 9h2" />
        </motion.g>
      </motion.svg>
    );
  },
);

AnnoyedIcon.displayName = "AnnoyedIcon";

export default AnnoyedIcon;
