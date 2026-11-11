// A photo of a signed paper slip, made ready to send (ADR-034): redrawn as a
// JPEG no wider or taller than 2000 px, which keeps it well under the 5 MB the
// server takes and drops the camera's location and other details from it.

export interface ReceiptPhoto {
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  /** base64, without the data: prefix. */
  data: string;
  /** A data: URL to show it before it is sent. */
  preview: string;
}

export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const MAX_SIDE = 2000;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

const readAsDataUrl = (file: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(new Error('read'));
  r.readAsDataURL(file);
});

const loadImage = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('decode'));
  img.src = url;
});

/** Throws an Error with a message to show when the file isn't a photo or is too large. */
/** An iPhone photo in its own format, which most desktop browsers can't open (limit L5). */
const isHeic = (file: File) => /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
const HEIC_TIP = 'iPhone photos (HEIC) can’t be read here. On the iPhone, set Settings › Camera › Formats to Most Compatible, or photograph the slip with this computer’s camera.';

export async function readReceiptPhoto(file: File): Promise<ReceiptPhoto> {
  if (isHeic(file)) throw new Error(HEIC_TIP);
  if (!file.type.startsWith('image/')) throw new Error(`${file.name} is not a photo. Choose a JPEG or PNG picture of the signed slip.`);
  const original = await readAsDataUrl(file);
  try {
    const img = await loadImage(original);
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const g = canvas.getContext('2d');
    if (!g) throw new Error('canvas');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    const preview = canvas.toDataURL('image/jpeg', 0.85);
    return { contentType: 'image/jpeg', data: preview.split(',')[1] ?? '', preview };
  } catch {
    // No canvas here (an old browser): send the file as it is, if it is a type and size the server takes.
    const type = TYPES.find((t) => t === file.type);
    if (!type) throw new Error(`${file.name} can't be read here. Choose a JPEG or PNG picture of the signed slip.`);
    if (file.size > PHOTO_MAX_BYTES) throw new Error('That photo is over 5 MB. Choose a smaller one.');
    return { contentType: type, data: original.split(',')[1] ?? '', preview: original };
  }
}
