import {createContext, useContext, useEffect, useRef, useState, type ReactNode, type RefObject} from 'react';
import {Button} from '@chakra-ui/react';
import {motion, useScroll, useSpring, useTransform, type MotionStyle} from 'motion/react';
import styles from './styles.module.css';

const MotionPreference = createContext({reducedMotion: false, systemReduced: false, toggle: () => {}});

export function useHomeMotion() {
  return useContext(MotionPreference);
}

export function HomeMotionRoot({children, className}: {children: ReactNode; className: string}): ReactNode {
  const root = useRef<HTMLElement>(null);
  const [systemReduced, setSystemReduced] = useState(false);
  const [paused, setPaused] = useState(false);
  const reducedMotion = systemReduced || paused;
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setSystemReduced(preference.matches);
    sync();
    preference.addEventListener('change', sync);
    return () => preference.removeEventListener('change', sync);
  }, []);
  useHomeReveal(root, reducedMotion);
  useArtworkVisibility(root);
  return (
    <MotionPreference.Provider value={{reducedMotion, systemReduced, toggle: () => setPaused((value) => !value)}}>
      <main ref={root} className={className} data-motion-still={reducedMotion ? '' : undefined}>
        <ReadingProgress />
        {children}
      </main>
    </MotionPreference.Provider>
  );
}

export function MotionToggle(): ReactNode {
  const {reducedMotion, systemReduced, toggle} = useContext(MotionPreference);
  return (
    <Button
      variant="plain"
      size="xs"
      className={styles.toggle}
      onClick={toggle}
      disabled={systemReduced}
      aria-pressed={reducedMotion}
      title={systemReduced ? '遵循系统的减少动态效果设置' : undefined}
    >
      <span aria-hidden="true" className={styles.toggleDot} />
      {systemReduced ? '静态浏览' : reducedMotion ? '开启动效' : '暂停动效'}
    </Button>
  );
}

function ReadingProgress(): ReactNode {
  const {reducedMotion} = useContext(MotionPreference);
  const {scrollYProgress} = useScroll({trackContentSize: true});
  const spring = useSpring(scrollYProgress, {stiffness: 180, damping: 30, restDelta: 0.001});
  const progress = useTransform(reducedMotion ? scrollYProgress : spring, (value) => Math.max(0, Math.min(1, value)));
  return <motion.div aria-hidden="true" className={styles.progress} style={{scaleX: progress}} />;
}

export function ScrollChapter({children, className}: {children: ReactNode; className: string}): ReactNode {
  const target = useRef<HTMLElement>(null);
  const {reducedMotion} = useContext(MotionPreference);
  const {scrollYProgress} = useScroll({target, offset: ['start end', 'end start']});
  const progress = useSpring(scrollYProgress, {stiffness: 100, damping: 30});
  const shift = useTransform(progress, [0, 0.5, 1], [36, 0, -36]);
  const rotation = useTransform(progress, [0, 0.5, 1], [-4, 0, 4]);
  const inset = useTransform(progress, [0, 0.35, 0.75, 1], [9, 0, 0, 3]);
  return (
    <motion.article
      ref={target}
      className={className}
      data-home-art
      style={
        {
          '--art-shift': reducedMotion ? 0 : shift,
          '--art-rotation': reducedMotion ? 0 : rotation,
          '--art-inset': reducedMotion ? 0 : inset,
        } as MotionStyle
      }
    >
      {children}
    </motion.article>
  );
}

function useArtworkVisibility(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!root.current || typeof IntersectionObserver === 'undefined') return;
    const elements = [...root.current.querySelectorAll<HTMLElement>('[data-home-art]')];
    const visible = new Set<Element>();
    const sync = () =>
      elements.forEach((element) =>
        element.toggleAttribute('data-motion-paused', document.hidden || !visible.has(element)),
      );
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) visible.add(entry.target);
        else visible.delete(entry.target);
      });
      sync();
    });
    elements.forEach((element) => observer.observe(element));
    document.addEventListener('visibilitychange', sync);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', sync);
    };
  }, [root]);
}

function useHomeReveal(root: RefObject<HTMLElement | null>, reducedMotion: boolean) {
  const revealed = useRef(new WeakSet<HTMLElement>());
  useEffect(() => {
    if (reducedMotion || !root.current || typeof IntersectionObserver === 'undefined') return;
    const animations = new Set<Animation>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const element = entry.target as HTMLElement;
          observer.unobserve(element);
          revealed.current.add(element);
          if (element.contains(document.activeElement) || typeof element.animate !== 'function') continue;
          const animation = element.animate(
            [
              {opacity: 0, transform: 'translateY(24px)'},
              {opacity: 1, transform: 'translateY(0)'},
            ],
            {
              duration: 700,
              delay: Number(element.dataset.revealDelay ?? 0),
              easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
              fill: 'backwards',
            },
          );
          animations.add(animation);
          animation.finished.then(
            () => animations.delete(animation),
            () => animations.delete(animation),
          );
        }
      },
      {threshold: 0.08, rootMargin: '0px 0px -20px 0px'},
    );
    root.current.querySelectorAll<HTMLElement>('[data-home-reveal]').forEach((element) => {
      if (!revealed.current.has(element)) observer.observe(element);
    });
    const finishFocused = (event: FocusEvent) => {
      for (const animation of animations) {
        const element = (animation.effect as KeyframeEffect | null)?.target;
        if (element instanceof Element && event.target instanceof Node && element.contains(event.target))
          animation.finish();
      }
    };
    const element = root.current;
    element.addEventListener('focusin', finishFocused);
    return () => {
      observer.disconnect();
      animations.forEach((animation) => animation.cancel());
      element.removeEventListener('focusin', finishFocused);
    };
  }, [root, reducedMotion]);
}
