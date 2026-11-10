// A photo of a signed slip (ADR-034): an iPhone photo gets a tip on how to send one that opens (limit L5).
import { describe, it, expect } from 'vitest';
import { readReceiptPhoto } from './receiptPhoto';

describe('readReceiptPhoto', () => {
  it('explains how to send an iPhone photo instead of failing on it', async () => {
    const heic = new File([new Uint8Array([0, 1, 2])], 'IMG_0042.HEIC', { type: 'image/heic' });
    await expect(readReceiptPhoto(heic)).rejects.toThrow(/Most Compatible/);
    const untyped = new File([new Uint8Array([0, 1, 2])], 'IMG_0043.heic', { type: '' });
    await expect(readReceiptPhoto(untyped)).rejects.toThrow(/iPhone photos \(HEIC\)/);
  });

  it('refuses a file that is not a picture', async () => {
    await expect(readReceiptPhoto(new File(['x'], 'notes.txt', { type: 'text/plain' }))).rejects.toThrow(/is not a photo/);
  });
});
