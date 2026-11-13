// The Afrinov logo: the official picture, the flame over the wordmark, as the
// company's letterhead and quotation template carry it (assets/afrinov-logo.png,
// made from the template's picture with its white background made transparent).
// Sized via the `size` prop, its width in pixels.
//
// `variant`:
//   - "default"   : the logo's own crimson and green (for light surfaces)
//   - "monochrome": with `tone="white"`, a white logo for dark surfaces
import logoUrl from '../assets/afrinov-logo.png';

/** Height over width of the picture. */
const RATIO = 421 / 468;

interface LogoProps {
  size?: number;
  variant?: 'default' | 'monochrome';
  tone?: 'brand' | 'white' | 'surface';
  className?: string;
  title?: string;
  decorative?: boolean;
}

export function Logo({ size = 32, variant = 'default', tone, className = '', title = 'Afrinov', decorative = false }: LogoProps) {
  const white = variant === 'monochrome' && tone === 'white';
  return (
    <img
      src={logoUrl}
      width={size}
      height={Math.round(size * RATIO)}
      alt={decorative ? '' : title}
      {...(decorative ? { 'aria-hidden': true as const } : {})}
      className={className}
      style={white ? { filter: 'brightness(0) invert(1)' } : undefined}
      draggable={false}
    />
  );
}
