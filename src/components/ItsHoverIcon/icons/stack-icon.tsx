import { forwardRef, useImperativeHandle, useCallback } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "motion/react";

const StackIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
  (
    { size = 24, color = "currentColor", strokeWidth = 2, className = "" },
    ref,
  ) => {
    const [scope, animate] = useAnimate();

    const start = useCallback(() => {
      animate(
        ".layer-top",
        { y: -2, scale: 1.05 },
        { duration: 0.3, ease: "easeOut" },
      );

      animate(
        ".layer-bottom",
        { y: 1, opacity: 0.7 },
        { duration: 0.3, ease: "easeOut" },
      );
    }, [animate]);

    const stop = useCallback(() => {
      animate(
        ".layer-top",
        { y: 0, scale: 1 },
        { duration: 0.25, ease: "easeInOut" },
      );

      animate(
        ".layer-bottom",
        { y: 0, opacity: 1 },
        { duration: 0.25, ease: "easeInOut" },
      );
    }, [animate]);

    useImperativeHandle(ref, () => ({
      startAnimation: start,
      stopAnimation: stop,
    }));

    return (
      <motion.svg
        ref={scope}
        onHoverStart={start}
        onHoverEnd={stop}
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
        style={{ overflow: "visible" }}
      >
        {/* Top layer */}
        <motion.path className="layer-top" d="M12 6l-8 4l8 4l8 -4l-8 -4" />

        {/* Bottom layer */}
        <motion.path className="layer-bottom" d="M4 14l8 4l8 -4" />
      </motion.svg>
    );
  },
);

StackIcon.displayName = "StackIcon";
export default StackIcon;
