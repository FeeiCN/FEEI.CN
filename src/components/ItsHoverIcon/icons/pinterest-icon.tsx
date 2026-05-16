import { forwardRef, useImperativeHandle, useCallback } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "motion/react";

const PinterestIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
  (
    { size = 24, color = "currentColor", strokeWidth = 2, className = "" },
    ref,
  ) => {
    const [scope, animate] = useAnimate();

    const start = useCallback(async () => {
      animate(
        ".pin",
        { y: [0, -3, 0], rotate: [0, -10, 0] },
        { duration: 0.6, ease: "easeInOut" },
      );
      await animate(
        ".circle",
        { scale: [1, 1.05, 1] },
        { duration: 0.4, ease: "easeInOut" },
      );
    }, [animate]);

    const stop = useCallback(() => {
      animate(
        ".pin, .circle",
        { y: 0, rotate: 0, scale: 1 },
        { duration: 0.2, ease: "easeInOut" },
      );
    }, [animate]);

    useImperativeHandle(ref, () => ({
      startAnimation: start,
      stopAnimation: stop,
    }));

    return (
      <motion.svg
        ref={scope}
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
        onHoverStart={start}
        onHoverEnd={stop}
      >
        <path stroke="none" d="M0 0h24v24H0z" fill="none" />
        <motion.path
          className="pin"
          style={{ transformOrigin: "center" }}
          d="M8 20l4 -9"
        />
        <motion.path
          className="pin"
          style={{ transformOrigin: "center" }}
          d="M10.7 14c.437 1.263 1.43 2 2.55 2c2.071 0 3.75 -1.554 3.75 -4a5 5 0 1 0 -9.7 1.7"
        />
        <motion.path
          className="circle"
          style={{ transformOrigin: "center" }}
          d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"
        />
      </motion.svg>
    );
  },
);

PinterestIcon.displayName = "PinterestIcon";
export default PinterestIcon;
