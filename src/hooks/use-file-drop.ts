import { useCallback, useRef, useState, type DragEvent } from 'react';

export interface FileDropHandlers {
  onDragEnter: (event: DragEvent) => void;
  onDragOver: (event: DragEvent) => void;
  onDragLeave: (event: DragEvent) => void;
  onDrop: (event: DragEvent) => void;
}

/**
 * Drag-and-drop target with a counter so moving the cursor across child
 * elements does not flicker the highlight on and off.
 */
export function useFileDrop(onFiles: (files: File[]) => void) {
  const [isDragging, setIsDragging] = useState(false);
  const depth = useRef(0);

  const reset = useCallback(() => {
    depth.current = 0;
    setIsDragging(false);
  }, []);

  const handlers: FileDropHandlers = {
    onDragEnter: (event) => {
      event.preventDefault();
      if (!event.dataTransfer?.types?.includes('Files')) return;
      depth.current += 1;
      setIsDragging(true);
    },
    onDragOver: (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: (event) => {
      event.preventDefault();
      depth.current -= 1;
      if (depth.current <= 0) reset();
    },
    onDrop: (event) => {
      event.preventDefault();
      reset();
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length > 0) onFiles(files);
    },
  };

  return { isDragging, handlers };
}
