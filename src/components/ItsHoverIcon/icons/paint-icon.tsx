import { forwardRef, useImperativeHandle, useCallback } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "motion/react";

const PaintIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
  (
    { size = 24, color = "currentColor", strokeWidth = 2, className = "" },
    ref,
  ) => {
    const [scope, animate] = useAnimate();

    const start = useCallback(async () => {
      animate(
        ".roller-symbol",
        {
          y: [0, 4],
          rotate: [0, 12],
        },
        {
          duration: 0.35,
          ease: "easeOut",
        },
      );

      animate(
        ".paint-stroke",
        {
          scaleX: [0, 1],
          opacity: [0, 1],
        },
        {
          duration: 0.35,
          ease: "easeOut",
        },
      );
    }, [animate]);

    const stop = useCallback(async () => {
      animate(
        ".roller-symbol, .paint-stroke",
        {
          y: 0,
          rotate: 0,
          scaleX: 1,
          opacity: 1,
        },
        {
          duration: 0.3,
          ease: "easeInOut",
        },
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

        <motion.rect
          className="paint-stroke"
          x="4"
          y="9"
          width="16"
          height="3"
          rx="1.5"
          fill={color}
          style={{
            transformOrigin: "left center",
            opacity: 0,
          }}
        />

        <motion.g
          className="roller-symbol"
          style={{ transformOrigin: "50% 50%" }}
        >
          <path d="M5 3m0 2a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v2a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2z" />
          <path d="M19 6h1a2 2 0 0 1 2 2a5 5 0 0 1 -5 5l-5 0v2" />
          <path d="M10 15m0 1a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z" />
        </motion.g>
      </motion.svg>
    );
  },
);

PaintIcon.displayName = "PaintIcon";
export default PaintIcon;
