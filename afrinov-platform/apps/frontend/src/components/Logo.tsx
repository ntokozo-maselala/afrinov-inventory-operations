// Afrinov wordmark logo (SVG). Renders the brand "A" mark provided by the
// design team. Sized via the `size` prop; the SVG itself is responsive and
// scales without losing detail.
//
// `variant`:
//   - "default"  : original red+green on transparent (for light surfaces)
//   - "monochrome": single-color (use `tone="white"` on dark surfaces)
import { LOGO_FILLS, LOGO_HIGHLIGHTS, LOGO_HIGHLIGHT_OPACITY, LOGO_PATHS } from '../lib/logoArt';

interface LogoProps {
  size?: number;
  variant?: 'default' | 'monochrome';
  tone?: 'brand' | 'white' | 'surface';
  className?: string;
  title?: string;
  decorative?: boolean;
}

export function Logo({ size = 32, variant = 'default', tone, className = '', title = 'Afrinov', decorative = false }: LogoProps) {
  const monoColor =
    tone === 'white' ? '#ffffff' :
    tone === 'surface' ? '#21262e' :
    tone === 'brand' ? '#E3001B' : null;

  const ariaProps = decorative
    ? { 'aria-hidden': true as const, role: 'presentation' as const }
    : { role: 'img' as const, 'aria-label': title };

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1060 1024"
      width={size}
      height={Math.round(size * (1024 / 1060))}
      className={className}
      preserveAspectRatio="xMidYMid meet"
      {...ariaProps}
    >
      {LOGO_PATHS.map((d, i) => (
        <path
          key={i}
          d={d}
          fill={variant === 'monochrome' && monoColor ? monoColor : LOGO_FILLS[i] ?? '#E3001B'}
          fillOpacity={LOGO_HIGHLIGHTS.has(i) ? LOGO_HIGHLIGHT_OPACITY : 1}
        />
      ))}
    </svg>
  );
}