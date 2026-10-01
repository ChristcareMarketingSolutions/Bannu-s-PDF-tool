/**
 * Image helpers used by Images → PDF and the compression engine.
 */
import { AppError } from './errors.js';
import { canvasToBlob, fitCanvasSize, releaseCanvas } from './utils.js';

/**
 * Read the EXIF orientation (1–8) from JPEG bytes. Returns 1 when absent.
 * Phone photos are often stored sideways with an orientation flag; PDF
 * ignores that flag, so such images must be re-drawn upright first.
 */
export function readJpegOrientation(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return 1;
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset);
    if ((marker & 0xff00) !== 0xff00) return 1;
    const size = view.getUint16(offset + 2);
    if (marker === 0xffe1 && offset + 10 <= view.byteLength && view.getUint32(offset + 4) === 0x45786966 /* "Exif" */) {
      const tiff = offset + 10;
      if (tiff + 8 > view.byteLength) return 1;
      const little = view.getUint16(tiff) === 0x4949;
      const ifd = tiff + view.getUint32(tiff + 4, little);
      if (ifd + 2 > view.byteLength) return 1;
      const entries = view.getUint16(ifd, little);
      for (let i = 0; i < entries; i++) {
        const entry = ifd + 2 + i * 12;
        if (entry + 12 > view.byteLength) return 1;
        if (view.getUint16(entry, little) === 0x0112) {
          const value = view.getUint16(entry + 8, little);
          return value >= 1 && value <= 8 ? value : 1;
        }
      }
      return 1;
    }
    if (marker === 0xffda) return 1; // start of scan — no EXIF before image data
    offset += 2 + size;
  }
  return 1;
}

/** Decode an image Blob/File into a ready-to-draw <img> element. */
export async function loadImage(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new AppError(`We couldn't read ${blob.name ? `"${blob.name}"` : 'this image'}. It may be corrupted or in an unsupported format.`, 'image');
  } finally {
    // The decoded image stays usable after the URL is revoked.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/**
 * Draw an image to a canvas (upright, size-limited) and encode it.
 * Browsers apply EXIF orientation automatically when drawing an <img>.
 */
export async function reencodeImage(blob, { type = 'image/jpeg', quality = 0.92, maxDimension = 0, background = '#ffffff' } = {}) {
  const img = await loadImage(blob);
  let w = img.naturalWidth;
  let h = img.naturalHeight;
  if (maxDimension && Math.max(w, h) > maxDimension) {
    const s = maxDimension / Math.max(w, h);
    w = Math.round(w * s);
    h = Math.round(h * s);
  }
  const fit = fitCanvasSize(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = fit.width;
  canvas.height = fit.height;
  const ctx = canvas.getContext('2d');
  if (type === 'image/jpeg') {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  try {
    const out = await canvasToBlob(canvas, type, quality);
    return { blob: out, width: canvas.width, height: canvas.height };
  } finally {
    releaseCanvas(canvas);
  }
}
