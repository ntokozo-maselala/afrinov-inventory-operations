// The app's icons: every file index.html and the web manifest point at exists,
// each picture is the size it claims, and the SVG sources are well-formed XML (a
// browser shows no icon at all for an SVG that doesn't parse). The files are built
// by `npm run icons` (scripts/build-icons.mjs).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const frontend = join(import.meta.dirname, '..');
const at = (path: string) => join(frontend, path);
const read = (path: string) => readFileSync(at(path));
const publicFile = (href: string) => `public${href}`;

/** Width and height from a PNG's IHDR chunk. */
function pngSize(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function iconLinks(): Map<string, string> {
  const doc = new DOMParser().parseFromString(read('index.html').toString('utf8'), 'text/html');
  const links = new Map<string, string>();
  doc.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"], link[rel="manifest"]').forEach((link) => {
    const href = link.getAttribute('href') ?? '';
    links.set(href, link.getAttribute('rel') ?? '');
  });
  return links;
}

interface Manifest {
  name: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
}

describe('app icons', () => {
  it('links the SVG and ICO tab icons, the Apple touch icon and the manifest', () => {
    expect([...iconLinks().keys()].sort()).toEqual(
      ['/apple-touch-icon.png', '/favicon.ico', '/favicon.svg', '/site.webmanifest'].sort(),
    );
  });

  it('has every file index.html links to', () => {
    for (const href of iconLinks().keys()) {
      expect(existsSync(at(publicFile(href))), href).toBe(true);
    }
  });

  it('has a 180 px Apple touch icon', () => {
    expect(pngSize(read('public/apple-touch-icon.png'))).toEqual({ width: 180, height: 180 });
  });

  it('packs 16, 32 and 48 px images into favicon.ico', () => {
    const ico = read('public/favicon.ico');
    expect(ico.readUInt16LE(2)).toBe(1);
    const sizes: number[] = [];
    for (let i = 0; i < ico.readUInt16LE(4); i++) {
      const entry = 6 + 16 * i;
      const length = ico.readUInt32LE(entry + 8);
      const offset = ico.readUInt32LE(entry + 12);
      const image = pngSize(ico.subarray(offset, offset + length));
      expect(image.width).toBe(ico.readUInt8(entry));
      sizes.push(image.width);
    }
    expect(sizes).toEqual([16, 32, 48]);
  });

  it('names the app in the manifest and has each icon at the size it states', () => {
    const manifest = JSON.parse(read('public/site.webmanifest').toString('utf8')) as Manifest;
    expect(manifest.name).toBe('Afrinov OMS');
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
    for (const icon of manifest.icons) {
      const [width, height] = icon.sizes.split('x').map(Number);
      expect(pngSize(read(publicFile(icon.src))), icon.src).toEqual({ width, height });
    }
  });

  it.each(['public/favicon.svg', 'src/assets/icon/afrinov-mark.svg'])('%s is well-formed SVG', (path) => {
    const doc = new DOMParser().parseFromString(read(path).toString('utf8'), 'image/svg+xml');
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(doc.documentElement.getAttribute('viewBox')).toBe('0 0 64 64');
  });
});
