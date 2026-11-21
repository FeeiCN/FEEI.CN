import {createContext, useContext, useEffect, useRef, useState, type ReactNode, type RefObject} from 'react';

const MotionPreference = createContext({reducedMotion: false});

export function useHomeMotion() {
  return useContext(MotionPreference);
}

export function HomeMotionRoot({children, className}: {children: ReactNode; className: string}): ReactNode {
  const root = useRef<HTMLElement>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReducedMotion(preference.matches);
    sync();
    preference.addEventListener('change', sync);
    return () => preference.removeEventListener('change', sync);
  }, []);
  useHomeReveal(root, reducedMotion);
  return (
    <MotionPreference.Provider value={{reducedMotion}}>
      <main ref={root} className={className} data-motion-still={reducedMotion ? '' : undefined}>
        {children}
      </main>
    </MotionPreference.Provider>
  );
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
