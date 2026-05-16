import { forwardRef, useImperativeHandle } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "motion/react";

const BrandNextjsIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
  (
    { size = 24, color = "currentColor", strokeWidth = 2, className = "" },
    ref,
  ) => {
    const [scope, animate] = useAnimate();

    const start = async () => {
      await animate(".circle", { pathLength: 0, opacity: 0 }, { duration: 0 });
      await animate(".line", { pathLength: 0, opacity: 0 }, { duration: 0 });

      await animate(
        ".circle",
        { pathLength: [0, 1], opacity: [0, 1] },
        { duration: 1.5 },
      );

      await animate(
        ".line",
        { pathLength: [0, 1], opacity: [0, 1] },
        { duration: 0.4 },
      );
    };

    const stop = () => {
      animate(".circle", { pathLength: 1, opacity: 1 }, { duration: 0.2 });
      animate(".line", { pathLength: 1, opacity: 1 }, { duration: 0.2 });
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
      <svg
        ref={scope}
        onMouseEnter={handleHoverStart}
        onMouseLeave={handleHoverEnd}
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`icon icon-tabler icons-tabler-outline icon-tabler-brand-nextjs cursor-pointer ${className}`}
      >
        <path stroke="none" d="M0 0h24v24H0z" fill="none" />
        <motion.path
          className="circle"
          d="M9 15v-6l7.745 10.65a9 9 0 1 1 2.255 -1.993"
          initial={{ pathLength: 1, opacity: 1 }}
        />
        <motion.path
          className="line"
          d="M15 12v-3"
          initial={{ pathLength: 1, opacity: 1 }}
        />
      </svg>
    );
  },
);

BrandNextjsIcon.displayName = "BrandNextjsIcon";

export default BrandNextjsIcon;
