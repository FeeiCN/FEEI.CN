import { forwardRef, useImperativeHandle, useCallback } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "motion/react";

const SlackIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
  (
    { size = 24, color = "currentColor", strokeWidth = 2, className = "" },
    ref,
  ) => {
    const [scope, animate] = useAnimate();

    const start = useCallback(async () => {
      animate(
        ".piece1",
        { rotate: [0, -90, 0] },
        { duration: 0.6, ease: "easeInOut" },
      );
      animate(
        ".piece2",
        { rotate: [0, 90, 0] },
        { duration: 0.6, ease: "easeInOut", delay: 0.1 },
      );
      animate(
        ".piece3",
        { rotate: [0, -90, 0] },
        { duration: 0.6, ease: "easeInOut", delay: 0.2 },
      );
      animate(
        ".piece4",
        { rotate: [0, 90, 0] },
        { duration: 0.6, ease: "easeInOut", delay: 0.3 },
      );
    }, [animate]);

    const stop = useCallback(() => {
      animate(
        ".piece1, .piece2, .piece3, .piece4",
        { rotate: 0 },
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
      >
        <path stroke="none" d="M0 0h24v24H0z" fill="none" />
        <motion.g className="piece1" style={{ transformOrigin: "center" }}>
          <path d="M12 12v-6a2 2 0 0 1 4 0v6m0 -2a2 2 0 1 1 2 2h-6" />
        </motion.g>
        <motion.g className="piece2" style={{ transformOrigin: "center" }}>
          <path d="M12 12h6a2 2 0 0 1 0 4h-6m2 0a2 2 0 1 1 -2 2v-6" />
        </motion.g>
        <motion.g className="piece3" style={{ transformOrigin: "center" }}>
          <path d="M12 12v6a2 2 0 0 1 -4 0v-6m0 2a2 2 0 1 1 -2 -2h6" />
        </motion.g>
        <motion.g className="piece4" style={{ transformOrigin: "center" }}>
          <path d="M12 12h-6a2 2 0 0 1 0 -4h6m-2 0a2 2 0 1 1 2 -2v6" />
        </motion.g>
      </motion.svg>
    );
  },
);

SlackIcon.displayName = "SlackIcon";
export default SlackIcon;
