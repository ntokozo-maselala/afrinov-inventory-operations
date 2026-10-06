// Minimal inline SVG icon set. Strokes share width=1.6 and currentColor so
// the library has one consistent visual weight. 16x16 viewbox.
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 16, ...rest }: IconProps) {
  return { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, ...rest };
}

export const Icon = {
  Home: (p: IconProps) => (<svg {...base(p)}><path d="M2.5 7.2 8 3l5.5 4.2V13a.5.5 0 0 1-.5.5h-3v-3.5h-4V13.5h-3a.5.5 0 0 1-.5-.5V7.2Z" /></svg>),
  Box: (p: IconProps) => (<svg {...base(p)}><path d="M2 4.5 8 2.5l6 2v7L8 13.5l-6-2v-7Z" /><path d="M2 4.5 8 6.5l6-2M8 6.5v7" /></svg>),
  Arrows: (p: IconProps) => (<svg {...base(p)}><path d="M3 5h7M10 5 7 2M10 5 7 8M13 11H6M6 11l3 3M6 11l3-3" /></svg>),
  Cart: (p: IconProps) => (<svg {...base(p)}><path d="M1.5 2h1.6l1 9.5a1 1 0 0 0 1 .9h6.4a1 1 0 0 0 1-.82L13.7 5H4" /><circle cx="6" cy="13.5" r="0.8" /><circle cx="11" cy="13.5" r="0.8" /></svg>),
  Truck: (p: IconProps) => (<svg {...base(p)}><path d="M1 4h8v6H1zM9 6h3l2 2v2H9zM4 12.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2ZM11.5 12.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" /></svg>),
  Users: (p: IconProps) => (<svg {...base(p)}><circle cx="6" cy="5.5" r="2.2" /><path d="M2 13c.5-2.4 2-3.5 4-3.5s3.5 1.1 4 3.5" /><path d="M11 7a2 2 0 1 0 0-4M14 13c-.2-1.6-1-2.7-2.2-3.2" /></svg>),
  Chart: (p: IconProps) => (<svg {...base(p)}><path d="M2 13h12M4 11V7M7 11V4M10 11V8M13 11V6" /></svg>),
  Search: (p: IconProps) => (<svg {...base(p)}><circle cx="7" cy="7" r="4" /><path d="M10 10l3 3" /></svg>),
  Plus: (p: IconProps) => (<svg {...base(p)}><path d="M8 3v10M3 8h10" /></svg>),
  Minus: (p: IconProps) => (<svg {...base(p)}><path d="M3 8h10" /></svg>),
  Edit: (p: IconProps) => (<svg {...base(p)}><path d="M2 14h2L12.5 5.5l-2-2L2 12v2Z" /><path d="M10.5 3.5l2 2" /></svg>),
  Trash: (p: IconProps) => (<svg {...base(p)}><path d="M3 4h10M5 4V2.5h6V4M5 4l.5 9a1 1 0 0 0 1 .9h3a1 1 0 0 0 1-.9L11 4" /></svg>),
  Check: (p: IconProps) => (<svg {...base(p)}><path d="M3 8.5 6.5 12 13 4.5" /></svg>),
  X: (p: IconProps) => (<svg {...base(p)}><path d="M3 3l10 10M13 3 3 13" /></svg>),
  Alert: (p: IconProps) => (<svg {...base(p)}><path d="M8 2 1.5 13.5h13L8 2Z" /><path d="M8 6v4M8 11.5v.01" /></svg>),
  Info: (p: IconProps) => (<svg {...base(p)}><circle cx="8" cy="8" r="6" /><path d="M8 7v4M8 5v.01" /></svg>),
  ArrowUp: (p: IconProps) => (<svg {...base(p)}><path d="M8 13V3M4 7l4-4 4 4" /></svg>),
  ArrowDown: (p: IconProps) => (<svg {...base(p)}><path d="M8 3v10M4 9l4 4 4-4" /></svg>),
  ArrowRight: (p: IconProps) => (<svg {...base(p)}><path d="M3 8h10M9 4l4 4-4 4" /></svg>),
  Filter: (p: IconProps) => (<svg {...base(p)}><path d="M2 3h12L9.5 8.5V13L6.5 11V8.5L2 3Z" /></svg>),
  Download: (p: IconProps) => (<svg {...base(p)}><path d="M8 2v8M5 7l3 3 3-3M2 13h12" /></svg>),
  Bell: (p: IconProps) => (<svg {...base(p)}><path d="M3 11V8a5 5 0 0 1 10 0v3l1 1H2l1-1ZM6.5 13.5a1.5 1.5 0 0 0 3 0" /></svg>),
  Settings: (p: IconProps) => (<svg {...base(p)}><circle cx="8" cy="8" r="1.8" /><path d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.6 3.4 11.2 4.8M4.8 11.2 3.4 12.6M12.6 12.6 11.2 11.2M4.8 4.8 3.4 3.4" /></svg>),
  Logout: (p: IconProps) => (<svg {...base(p)}><path d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3M10 11l3-3-3-3M13 8H6" /></svg>),
  Menu: (p: IconProps) => (<svg {...base(p)}><path d="M2 4h12M2 8h12M2 12h12" /></svg>),
  Eye: (p: IconProps) => (<svg {...base(p)}><path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8Z" /><circle cx="8" cy="8" r="2" /></svg>),
  Layers: (p: IconProps) => (<svg {...base(p)}><path d="M8 1.5 1.5 5 8 8.5 14.5 5 8 1.5Z" /><path d="M1.5 8 8 11.5 14.5 8" /><path d="M1.5 11 8 14.5 14.5 11" /></svg>),
  Warning: (p: IconProps) => (<svg {...base(p)}><circle cx="8" cy="8" r="6" /><path d="M8 5v3.5M8 11v.01" /></svg>),
  Doc: (p: IconProps) => (<svg {...base(p)}><path d="M3.5 1.5h6L13 5v9.5H3.5z" /><path d="M9.5 1.5V5H13" /></svg>),
  Cash: (p: IconProps) => (<svg {...base(p)}><rect x="2" y="4" width="12" height="8" rx="1" /><circle cx="8" cy="8" r="2" /></svg>),
  Map: (p: IconProps) => (<svg {...base(p)}><path d="M1.5 3 6 4.5l4-1.5L14.5 4v9L10 14.5 6 13l-4.5 1.5V3Z" /><path d="M6 4.5V13M10 3v9" /></svg>),
  Activity: (p: IconProps) => (<svg {...base(p)}><path d="M1 8h3l2-5 4 10 2-5h3" /></svg>),
  File: (p: IconProps) => (<svg {...base(p)}><path d="M4 1.5h5L13 5.5V14H4z" /><path d="M9 1.5V5.5H13" /></svg>),
  Print: (p: IconProps) => (<svg {...base(p)}><path d="M4 6V2h8v4M4 11H2V7h12v4h-2M4 11h8v3H4z" /></svg>),
  Tag: (p: IconProps) => (<svg {...base(p)}><path d="M1.5 7.5V2h5.5l7 7-5.5 5.5-7-7Z" /><circle cx="4.5" cy="4.5" r="0.8" /></svg>),
  ChevronRight: (p: IconProps) => (<svg {...base(p)}><path d="M5 12 10 8 5 4" /></svg>),
};