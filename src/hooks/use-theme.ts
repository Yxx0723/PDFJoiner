import { useCallback, useEffect, useRef, useState } from 'react';

import { THEME_STORAGE_KEY } from '@/lib/constants';

export type Theme = 'light' | 'dark';

function readInitialTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  if (document.documentElement.classList.contains('dark')) return 'dark';
  return 'light';
}

/**
 * Theme is stored on <html> so Tailwind's `dark:` variants and the pre-paint
 * script in index.html agree on a single source of truth.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.style.colorScheme = theme;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Storage can be blocked (private mode); the theme still applies.
    }
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  }, []);

  return { theme, setTheme, toggle };
}
