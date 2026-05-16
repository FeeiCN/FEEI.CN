import { forwardRef, useImperativeHandle } from "react";
import { motion, useAnimate } from "motion/react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";

const LayoutSidebarRightCollapseIcon = forwardRef<
  AnimatedIconHandle,
  AnimatedIconProps
>(
  (
    { size = 24, color = "currentColor", strokeWidth = 2, className = "" },
    ref,
  ) => {
    const [scope, animate] = useAnimate();

    const start = async () => {
      animate(
        ".chevron",
        { x: [0, 2, 0], opacity: [1, 0.7, 1] },
        { duration: 1.5 },
      );
      animate(".sidebar", { x: [0, 2, 0] }, { duration: 2 });
    };

    const stop = () => {
      animate(".chevron", { x: 0, opacity: 1 }, { duration: 0.2 });
      animate(".sidebar", { x: 0 }, { duration: 0.2 });
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
        <path stroke="none" d="M0 0h24v24H0z" fill="none" />
        <path d="M4 4m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z" />
        <motion.path className="sidebar" d="M15 4v16" />
        <motion.path className="chevron" d="M9 10l2 2l-2 2" />
      </motion.svg>
    );
  },
);

LayoutSidebarRightCollapseIcon.displayName = "LayoutSidebarRightCollapseIcon";

export default LayoutSidebarRightCollapseIcon;
