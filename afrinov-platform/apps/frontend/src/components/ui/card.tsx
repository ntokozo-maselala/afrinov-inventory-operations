import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn';

const Card = ({ className, ...props }: ComponentProps<'div'>) => (
  <div
    data-slot="card"
    className={cn(
      'rounded-md border bg-surface-0 text-surface-900 shadow-card',
      className,
    )}
    {...props}
  />
);
Card.displayName = 'Card';

const CardHeader = ({ className, ...props }: ComponentProps<'div'>) => (
  <div
    data-slot="card-header"
    className={cn('flex flex-col gap-2 p-4 pb-2', className)}
    {...props}
  />
);
CardHeader.displayName = 'CardHeader';

const CardTitle = ({ className, ...props }: ComponentProps<'h3'>) => (
  <h3
    data-slot="card-title"
    className={cn('text-h3 font-semibold text-surface-900', className)}
    {...props}
  />
);
CardTitle.displayName = 'CardTitle';

const CardDescription = ({ className, ...props }: ComponentProps<'p'>) => (
  <p
    data-slot="card-description"
    className={cn('text-sm text-surface-500', className)}
    {...props}
  />
);
CardDescription.displayName = 'CardDescription';

const CardAction = ({ className, ...props }: ComponentProps<'div'>) => (
  <div
    data-slot="card-action"
    className={cn('mt-2 flex items-center gap-2 justify-end', className)}
    {...props}
  />
);
CardAction.displayName = 'CardAction';

const CardContent = ({ className, ...props }: ComponentProps<'div'>) => (
  <div
    data-slot="card-content"
    className={cn('p-4 pt-0', className)}
    {...props}
  />
);
CardContent.displayName = 'CardContent';

const CardFooter = ({ className, ...props }: ComponentProps<'div'>) => (
  <div
    data-slot="card-footer"
    className={cn('flex items-center justify-between p-4 pt-2', className)}
    {...props}
  />
);
CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, CardFooter };
