import * as React from 'react';

import { cn } from '../../lib/cn';

export function ScrollArea({
  className,
  children,
  maxHeight = '400px',
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { maxHeight?: string }) {
  return (
    <div
      className={cn(
        'overflow-y-auto overflow-x-hidden',
        '[&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-surface-300',
        'dark:[&::-webkit-scrollbar-thumb]:bg-surface-500',
        '[&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-track]:bg-transparent',
        className,
      )}
      style={{ maxHeight }}
      {...props}
    >
      {children}
    </div>
  );
}
