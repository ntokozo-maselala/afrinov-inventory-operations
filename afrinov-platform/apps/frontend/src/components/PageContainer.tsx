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

export function PageContainer({ children, className = '', maxWidth = 'lg' }: PageContainerProps) {

  return (
    <main
      className={`flex-1 min-w-0 py-6 ${maxWidthClasses[maxWidth]} w-full mx-auto ${className}`}
      style={{
        paddingLeft: 'calc(var(--content-padding-base) + var(--sidebar-offset, 0px))',
        paddingRight: 'var(--content-padding-base)',
      } as React.CSSProperties}
    >
      {children}
    </main>
  );
}

export function PageContent({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`space-y-6 ${className}`}>{children}</div>;
}