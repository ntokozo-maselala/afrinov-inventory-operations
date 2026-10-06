import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';

import { cn } from '../../lib/cn';

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({
  content,
  side = 'top',
  children,
  ...props
}: {
  content: React.ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  children: React.ReactNode;
} & React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipPrimitive.Root {...props}>
      <TooltipPrimitive.Trigger asChild>
        {children}
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          className={cn(
            'z-50 overflow-hidden rounded-md bg-surface-800 px-2.5 py-1.5 text-xs text-surface-50 dark:bg-surface-50',
            'data-[side=top]:slide-in-from-bottom-2',
            'data-[side=bottom]:slide-in-from-top-2',
            'data-[side=left]:slide-in-from-right-2',
            'data-[side=right]:slide-in-from-left-2',
          )}
          sideOffset={4}
          side={side}
        >
          {content}
          <TooltipPrimitive.Arrow
            className="fill-surface-800 dark:fill-surface-50"
            width={8}
            height={8}
          />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
