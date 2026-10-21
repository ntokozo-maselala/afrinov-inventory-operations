import type { ReactNode } from 'react';

interface PageContainerProps {
  children: ReactNode;
  className?: string;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
}

const maxWidthClasses = {
  sm: 'max-w-3xl',
  md: 'max-w-5xl',
  lg: 'max-w-6xl',
  xl: 'max-w-7xl',
  full: 'max-w-full',
};

/**
 * Wraps page content in the focusable main-content landmark targeted by the shell's skip link.
 * `maxWidth` selects a width cap (lg by default); full uses the available width.
 * The landmark is excluded from sequential keyboard navigation.
 */
export function PageContainer({ children, className = '', maxWidth = 'lg' }: PageContainerProps) {

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className={`flex-1 min-w-0 py-6 px-4 sm:px-6 lg:px-8 ${maxWidthClasses[maxWidth]} w-full mx-auto ${className}`}
    >
      {children}
    </main>
  );
}

export function PageContent({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`space-y-6 ${className}`}>{children}</div>;
}
