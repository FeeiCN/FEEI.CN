import { forwardRef, useImperativeHandle } from "react";
import type { AnimatedIconHandle, AnimatedIconProps } from "./types";
import { motion, useAnimate } from "motion/react";

const CameraOffIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(
  (
    { size = 24, color = "currentColor", strokeWidth = 2, className = "" },
    ref,
  ) => {
    const [scope, animate] = useAnimate();

    const start = async () => {
      animate(
        ".slash",
        { scale: 1.1, rotate: 5 },
        { duration: 0.3, ease: "easeOut" },
      );
      animate(".camera", { opacity: 0.4 }, { duration: 0.3, ease: "easeOut" });
    };

    const stop = () => {
      animate(
        ".slash",
        { scale: 1, rotate: 0 },
        { duration: 0.2, ease: "easeInOut" },
      );
      animate(".camera", { opacity: 1 }, { duration: 0.2, ease: "easeInOut" });
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
        <motion.g className="camera">
          <path d="M14.564 14.558a3 3 0 1 1-4.122-4.121" />
          <path d="M20 20H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 .819-.175" />
          <path d="M9.695 4.024A2 2 0 0 1 10.004 4h3.993a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v7.344" />
        </motion.g>
        <motion.path
          className="slash"
          style={{ transformOrigin: "12px 12px" }}
          d="m2 2 20 20"
        />
      </motion.svg>
    );
  },
);

CameraOffIcon.displayName = "CameraOffIcon";

export default CameraOffIcon;
