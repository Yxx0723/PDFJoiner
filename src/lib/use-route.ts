/**
 * Tiny hash router.
 *
 * Two tools, one page each: `#/merge` and `#/images`. A hash router keeps
 * back/forward and deep links working without pulling in a routing library for
 * what is genuinely a two-screen app.
 */

import { useSyncExternalStore } from 'react';

export type ToolRoute = 'merge' | 'images';

const DEFAULT_ROUTE: ToolRoute = 'merge';

export function parseRoute(hash: string): ToolRoute {
  const value = hash.replace(/^#\/?/, '').split(/[?#]/)[0];
  return value === 'images' ? 'images' : DEFAULT_ROUTE;
}

export function routeHref(route: ToolRoute): string {
  return `#/${route}`;
}

export function navigate(route: ToolRoute): void {
  if (typeof window === 'undefined') return;
  const href = routeHref(route);
  if (window.location.hash !== href) window.location.hash = href;
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener('hashchange', onChange);
  window.addEventListener('popstate', onChange);
  return () => {
    window.removeEventListener('hashchange', onChange);
    window.removeEventListener('popstate', onChange);
  };
}

export function useToolRoute(): ToolRoute {
  return useSyncExternalStore(
    subscribe,
    () => (typeof window === 'undefined' ? DEFAULT_ROUTE : parseRoute(window.location.hash)),
    () => DEFAULT_ROUTE,
  );
}
