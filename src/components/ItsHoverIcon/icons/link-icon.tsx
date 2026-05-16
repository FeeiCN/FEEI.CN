import { forwardRef, useImperativeHandle, useCallback } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "motion/react";

const LinkIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
  (
    { size = 24, color = "currentColor", strokeWidth = 2, className = "" },
    ref,
  ) => {
    const [scope, animate] = useAnimate();

    const start = useCallback(async () => {
      animate(
        ".link-top",
        { x: 1.5, y: -1.5 },
        { duration: 0.25, ease: "easeOut" },
      );

      animate(
        ".link-bottom",
        { x: -1.5, y: 1.5 },
        { duration: 0.25, ease: "easeOut" },
      );

      animate(
        ".link-middle",
        { opacity: [0.6, 1], scale: [0.95, 1] },
        { duration: 0.2, ease: "easeOut" },
      );
    }, [animate]);

    const stop = useCallback(async () => {
      animate(
        ".link-top, .link-bottom, .link-middle",
        { x: 0, y: 0, opacity: 1, scale: 1 },
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
          d="M9 15l6 -6"
          className="link-middle"
          style={{ transformOrigin: "50% 50%" }}
        />

        <motion.path
          d="M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464"
          className="link-top"
          style={{ transformOrigin: "50% 50%" }}
        />

        <motion.path
          d="M13 18l-.397 .534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463"
          className="link-bottom"
          style={{ transformOrigin: "50% 50%" }}
        />
      </motion.svg>
    );
  },
);

LinkIcon.displayName = "LinkIcon";
export default LinkIcon;
