import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-5 transition-colors [&_svg]:size-3',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'border-border bg-card text-muted-foreground',
        muted: 'border-transparent bg-muted text-muted-foreground',
        soft: 'border-primary/15 bg-primary-soft text-accent-foreground',
        success: 'border-success/20 bg-success-soft text-success',
        warning: 'border-warning/25 bg-warning-soft text-warning',
        destructive: 'border-destructive/20 bg-destructive-soft text-destructive',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
