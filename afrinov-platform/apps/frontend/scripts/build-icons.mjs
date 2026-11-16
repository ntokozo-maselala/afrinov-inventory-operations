// Builds the app's raster icons from the two vector sources:
//
//   public/favicon.svg                 the tab icon (white tile, cut for 16 and 32 px)
//   src/assets/icon/afrinov-mark.svg   the full mark, with its veins, for 48 px and up
//
// and writes into public/:
//
//   favicon.ico            16 and 32 px from the tab icon, 48 px from the full mark
//   apple-touch-icon.png   180 px, square and opaque (iOS rounds the corners itself)
//   icon-192.png           192 px rounded tile, for the web manifest
//   icon-512.png           512 px rounded tile, for the web manifest
//   icon-maskable-512.png  512 px full-bleed, the mark inside Android's safe circle
//
// The outputs are committed, so a build never runs this. Run it after changing
// either source:
//
//   npm run icons --workspace=@afrinov/frontend
//
// It draws with Playwright's Chromium; if that is not installed yet, run
// `npx playwright install chromium` first.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('..', import.meta.url));
const at = (path) => `${root}${path}`;

const TILE = '#FFFFFF';
const TILE_EDGE = '#DDE1E8'; // surface-200: keeps the white tile visible on a white background

const tabIcon = await readFile(at('public/favicon.svg'), 'utf8');
const markSource = await readFile(at('src/assets/icon/afrinov-mark.svg'), 'utf8');
const mark = markSource
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^[\s\S]*?<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
  .trim();

/**
 * The full mark on a white tile. `scale` sizes the mark (its box is 34 x 55 of the
 * 64-unit grid, centred on 32, 30.5); `rounded` gives the tile corners and a hairline
 * edge, otherwise it fills the square edge to edge.
 */
function onTile({ scale, rounded }) {
  const tile = rounded
    ? `<rect x="0.25" y="0.25" width="63.5" height="63.5" rx="14" fill="${TILE}" stroke="${TILE_EDGE}" stroke-width="0.5"/>`
    : `<rect width="64" height="64" fill="${TILE}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${tile}<g transform="translate(32 32) scale(${scale}) translate(-32 -30.5)">${mark}</g></svg>`;
}

const rounded = onTile({ scale: 0.8, rounded: true });

const outputs = [
  { file: 'apple-touch-icon.png', size: 180, svg: onTile({ scale: 0.72, rounded: false }) },
  { file: 'icon-192.png', size: 192, svg: rounded },
  { file: 'icon-512.png', size: 512, svg: rounded },
  // Android masks to as little as the middle 80% circle; 0.66 keeps the mark
  // (27.5 units from its centre at most) well inside it.
  { file: 'icon-maskable-512.png', size: 512, svg: onTile({ scale: 0.66, rounded: false }) },
];
const icoSizes = [
  { size: 16, svg: tabIcon },
  { size: 32, svg: tabIcon },
  { size: 48, svg: rounded },
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });

  async function render(svg, size) {
    await page.setViewportSize({ width: size, height: size });
    const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:transparent">` +
        `<img id="icon" src="${src}" width="${size}" height="${size}" style="display:block"></body></html>`,
    );
    await page.locator('#icon').evaluate((img) => img.decode());
    return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  }

  for (const { file, size, svg } of outputs) {
    const png = await render(svg, size);
    await writeFile(at(`public/${file}`), png);
    console.log(`public/${file}  ${size}x${size}  ${png.length} bytes`);
  }

  const images = [];
  for (const { size, svg } of icoSizes) images.push({ size, png: await render(svg, size) });
  const ico = packIco(images);
  await writeFile(at('public/favicon.ico'), ico);
  console.log(`public/favicon.ico  ${icoSizes.map((s) => s.size).join(', ')} px  ${ico.length} bytes`);
} finally {
  await browser.close();
}

/** An ICO file holding each image as PNG (supported since Windows Vista and by every browser). */
function packIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // no palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}
