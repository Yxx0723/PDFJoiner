import * as React from 'react';

import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Adds a red border and `aria-invalid`; the message is rendered by the caller. */
  invalid?: boolean;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', invalid, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      aria-invalid={invalid || undefined}
      className={cn(
        'flex h-10 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm shadow-sm transition-colors',
        'placeholder:text-muted-foreground/70',
        'focus-visible:border-primary/50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/10',
        'disabled:cursor-not-allowed disabled:opacity-50',
        invalid &&
          'border-destructive/60 focus-visible:border-destructive focus-visible:ring-destructive/15',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export { Input };
