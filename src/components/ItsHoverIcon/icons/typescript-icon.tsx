import { forwardRef, useImperativeHandle, useCallback } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "motion/react";

const TypescriptIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
  (
    { size = 24, color = "currentColor", strokeWidth = 2, className = "" },
    ref,
  ) => {
    const [scope, animate] = useAnimate();

    const start = useCallback(async () => {
      animate(
        ".ts-text",
        { pathLength: [0, 1], opacity: [0, 1] },
        { duration: 0.6, ease: "easeOut" },
      );
      await animate(
        ".border",
        { scale: [1, 1.03, 1] },
        { duration: 0.4, ease: "easeInOut" },
      );
    }, [animate]);

    const stop = useCallback(() => {
      animate(".ts-text", { pathLength: 1, opacity: 1 }, { duration: 0.2 });
      animate(".border", { scale: 1 }, { duration: 0.2 });
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
        <motion.path
          className="ts-text"
          initial={{ pathLength: 1, opacity: 1 }}
          d="M15 17.5c.32 .32 .754 .5 1.207 .5h.543c.69 0 1.25 -.56 1.25 -1.25v-.25a1.5 1.5 0 0 0 -1.5 -1.5a1.5 1.5 0 0 1 -1.5 -1.5v-.25c0 -.69 .56 -1.25 1.25 -1.25h.543c.453 0 .887 .18 1.207 .5"
        />
        <motion.path
          className="ts-text"
          initial={{ pathLength: 1, opacity: 1 }}
          d="M9 12h4"
        />
        <motion.path
          className="ts-text"
          initial={{ pathLength: 1, opacity: 1 }}
          d="M11 12v6"
        />
        <motion.path
          className="border"
          style={{ transformOrigin: "center" }}
          d="M21 19v-14a2 2 0 0 0 -2 -2h-14a2 2 0 0 0 -2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2 -2z"
        />
      </motion.svg>
    );
  },
);

TypescriptIcon.displayName = "TypescriptIcon";
export default TypescriptIcon;
