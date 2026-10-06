import type { ReactNode } from 'react';

interface ToolbarProps {
  left?: ReactNode;
  right?: ReactNode;
  className?: string;
}

export function Toolbar({ left, right, className = '' }: ToolbarProps) {
  return (
    <div className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3 ${className}`}>
      <div className="flex items-center gap-2 flex-wrap">{left}</div>
      <div className="flex items-center gap-2 flex-wrap">{right}</div>
    </div>
  );
}