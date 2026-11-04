/**
 * Tiny hash router.
 *
 * Three tools, one page each: `#/merge`, `#/images` and `#/split`. A hash
 * router keeps back/forward and deep links working without pulling in a routing
 * library for what is genuinely a three-screen app.
 */

import { useSyncExternalStore } from 'react';

export type ToolRoute = 'merge' | 'images' | 'split';

const DEFAULT_ROUTE: ToolRoute = 'merge';

const ROUTES: readonly ToolRoute[] = ['merge', 'images', 'split'];

export function parseRoute(hash: string): ToolRoute {
  const value = hash.replace(/^#\/?/, '').split(/[?#]/)[0];
  return ROUTES.find((route) => route === value) ?? DEFAULT_ROUTE;
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
