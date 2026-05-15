import { forwardRef, useImperativeHandle, useCallback } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "motion/react";

const KeyframesIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
  (
    { size = 24, color = "currentColor", strokeWidth = 2, className = "" },
    ref,
  ) => {
    const [scope, animate] = useAnimate();

    const start = useCallback(async () => {
      animate(
        ".frame-1",
        { x: [0, -2, 0] },
        { duration: 0.4, ease: "easeInOut" },
      );
      animate(
        ".frame-2",
        { x: [0, 2, 0] },
        { duration: 0.4, ease: "easeInOut", delay: 0.1 },
      );
      animate(
        ".frame-3",
        { x: [0, 4, 0] },
        { duration: 0.4, ease: "easeInOut", delay: 0.2 },
      );
    }, [animate]);

    const stop = useCallback(() => {
      animate(
        ".frame-1, .frame-2, .frame-3",
        { x: 0 },
        { duration: 0.2, ease: "easeOut" },
      );
    }, [animate]);

    useImperativeHandle(ref, () => ({
      startAnimation: start,
      stopAnimation: stop,
    }));

    return (
      <motion.div
        ref={scope}
        className={`inline-flex cursor-pointer items-center justify-center ${className}`}
        onHoverStart={start}
        onHoverEnd={stop}
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
          <motion.path
            className="frame-1"
            d="M9.225 18.412a1.595 1.595 0 0 1 -1.225 .588c-.468 0 -.914 -.214 -1.225 -.588l-4.361 -5.248a1.844 1.844 0 0 1 0 -2.328l4.361 -5.248a1.595 1.595 0 0 1 1.225 -.588c.468 0 .914 .214 1.225 .588l4.361 5.248a1.844 1.844 0 0 1 0 2.328l-4.361 5.248z"
          />
          <motion.path
            className="frame-2"
            d="M17 5l4.586 5.836a1.844 1.844 0 0 1 0 2.328l-4.586 5.836"
          />
          <motion.path
            className="frame-3"
            d="M13 5l4.586 5.836a1.844 1.844 0 0 1 0 2.328l-4.586 5.836"
          />
        </svg>
      </motion.div>
    );
  },
);

KeyframesIcon.displayName = "KeyframesIcon";
export default KeyframesIcon;
