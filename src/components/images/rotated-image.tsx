import type { CSSProperties } from 'react';

import { cn } from '@/lib/utils';
import type { Rotation } from '@/features/image-pdf/types';

export interface RotatedImageProps {
  src: string;
  alt: string;
  rotation: Rotation;
  naturalWidth: number;
  naturalHeight: number;
  /**
   * `fill` expects a parent whose aspect ratio already equals the rotated one
   * (the page preview, where the geometry is exact).
   * `contain` fits inside an arbitrary box — used by the cards and the dialog.
   */
  mode?: 'fill' | 'contain';
  className?: string;
}

/**
 * Displays an image rotated by a quarter turn (or more) inside a box.
 *
 * A CSS rotation does not change layout size, so the element has to be sized for
 * its *unrotated* box and then turned: every side must end up exactly where the
 * PDF puts the rotated pixels. In `contain` mode the box constrains the swapped
 * axes with container query units, which is the only pure-CSS way to say "as
 * wide as my parent is tall".
 */
export function RotatedImage({
  src,
  alt,
  rotation,
  naturalWidth,
  naturalHeight,
  mode = 'contain',
  className,
}: RotatedImageProps) {
  const quarter = rotation === 90 || rotation === 270;

  let style: CSSProperties | undefined;
  if (mode === 'fill') {
    style = quarter
      ? {
          width: `${(naturalWidth / naturalHeight) * 100}%`,
          height: `${(naturalHeight / naturalWidth) * 100}%`,
        }
      : { width: '100%', height: '100%' };
  } else if (quarter) {
    // Older browsers keep the max-w/max-h utility classes; browsers with
    // container queries get the axis swap that makes the turn fit exactly.
    style = { maxWidth: '100cqh', maxHeight: '100cqw' };
  }

  return (
    <img
      src={src}
      alt={alt}
      draggable={false}
      decoding="async"
      loading="lazy"
      className={cn(
        'select-none object-contain',
        mode === 'contain' && 'max-h-full max-w-full',
        className,
      )}
      style={{
        ...style,
        transform: rotation ? `rotate(${rotation}deg)` : undefined,
      }}
    />
  );
}
