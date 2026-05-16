"use client";
import { forwardRef, useImperativeHandle } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "motion/react";

const BrandGoogleIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
  ({ size = 24, color = "currentColor", className = "" }, ref) => {
    const [scope, animate] = useAnimate();

    const start = async () => {
      await animate(
        ".google-g",
        {
          rotate: [0, -10, 10, -5, 0],
          scale: [1, 1.05, 1],
        },
        {
          duration: 0.6,
          ease: "easeInOut",
        },
      );
    };

    const stop = async () => {
      animate(
        ".google-g",
        {
          rotate: 0,
          scale: 1,
        },
        {
          duration: 0.3,
          ease: "easeInOut",
        },
      );
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
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={color}
        className={`cursor-pointer ${className}`}
        onHoverStart={handleHoverStart}
        onHoverEnd={handleHoverEnd}
      >
        <path stroke="none" d="M0 0h24v24H0z" fill="none" />

        <motion.path
          d="M12 2a9.96 9.96 0 0 1 6.29 2.226a1 1 0 0 1 .04 1.52l-1.51 1.362a1 1 0 0 1 -1.265 .06a6 6 0 1 0 2.103 6.836l.001 -.004h-3.66a1 1 0 0 1 -.992 -.883l-.007 -.117v-2a1 1 0 0 1 1 -1h6.945a1 1 0 0 1 .994 .89c.04 .367 .061 .737 .061 1.11c0 5.523 -4.477 10 -10 10s-10 -4.477 -10 -10s4.477 -10 10 -10z"
          className="google-g"
          style={{ transformOrigin: "50% 50%" }}
        />
      </motion.svg>
    );
  },
);

BrandGoogleIcon.displayName = "BrandGoogleIcon";

export default BrandGoogleIcon;
