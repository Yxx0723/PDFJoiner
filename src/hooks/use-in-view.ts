import { useEffect, useRef, useState, type RefObject } from 'react';

export interface UseInViewResult<T extends HTMLElement> {
  ref: RefObject<T>;
  /** True once the element has been near the viewport at least once. */
  inView: boolean;
}

/**
 * Small IntersectionObserver wrapper used to defer PDF page rendering.
 *
 * It is deliberately sticky: once an element has been seen we keep rendering
 * it, because the bitmap is already cached and toggling would cause flicker.
 * Ancestor scroll containers are respected automatically, so this also works
 * inside the horizontal page strip.
 */
export function useInView<T extends HTMLElement>(rootMargin = '240px'): UseInViewResult<T> {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            observer.disconnect();
            return;
          }
        }
      },
      { rootMargin },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [rootMargin]);

  return { ref, inView };
}
