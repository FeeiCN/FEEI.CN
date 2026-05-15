import { forwardRef, useImperativeHandle, useCallback } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "motion/react";

const Stack3Icon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
  (
    { size = 24, color = "currentColor", strokeWidth = 2, className = "" },
    ref,
  ) => {
    const [scope, animate] = useAnimate();

    const start = useCallback(async () => {
      // top layer
      animate(
        ".layer-1",
        { y: -3, scale: 1.05 },
        { duration: 0.3, ease: "easeOut" },
      );

      // middle layers
      animate(
        ".layer-2",
        { y: -1, opacity: 0.8 },
        { duration: 0.3, delay: 0.05, ease: "easeOut" },
      );

      // bottom layer
      animate(
        ".layer-3",
        { y: 1, opacity: 0.6 },
        { duration: 0.3, delay: 0.1, ease: "easeOut" },
      );
    }, [animate]);

    const stop = useCallback(() => {
      animate(".layer-1", { y: 0, scale: 1 }, { duration: 0.25 });
      animate(".layer-2", { y: 0, opacity: 1 }, { duration: 0.25 });
      animate(".layer-3", { y: 0, opacity: 1 }, { duration: 0.25 });
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
        {/* top */}
        <motion.path className="layer-1" d="M12 2l-8 4l8 4l8 -4l-8 -4" />

        {/* middle */}
        <motion.path className="layer-2" d="M4 10l8 4l8 -4" />
        <motion.path className="layer-2" d="M4 14l8 4l8 -4" />

        {/* bottom */}
        <motion.path className="layer-3" d="M4 18l8 4l8 -4" />
      </motion.svg>
    );
  },
);

Stack3Icon.displayName = "Stack3Icon";
export default Stack3Icon;
