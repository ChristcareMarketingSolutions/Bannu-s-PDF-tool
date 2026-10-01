/**
 * General-purpose helpers shared by every tool.
 */
import { AppError } from './errors.js';

/** Hard limits that protect the browser tab from running out of memory. */
export const LIMITS = Object.freeze({
  MAX_PDF_BYTES: 300 * 1024 * 1024,   // 300 MB per PDF
  MAX_IMAGE_BYTES: 60 * 1024 * 1024,  // 60 MB per image
  MAX_TOTAL_BYTES: 600 * 1024 * 1024, // 600 MB across one job
  MAX_FILES: 100,
  /** Largest canvas area that every mainstream browser (incl. iOS Safari) accepts. */
  MAX_CANVAS_PIXELS: 16_000_000,
  MAX_CANVAS_SIDE: 8192,
});

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[i]}`;
}

export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

let uidCounter = 0;
export const uid = (prefix = 'id') => `${prefix}-${Date.now().toString(36)}-${(uidCounter++).toString(36)}`;

/** Remove the extension from a file name. */
export function stripExtension(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

/**
 * Make a string safe to use as a download file name on every OS.
 * Removes path separators, control characters and reserved characters.
 */
export function sanitizeFilename(name, fallback = 'document') {
  let clean = String(name ?? '')
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .trim();
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(clean)) clean = `${clean}-file`;
  if (!clean) clean = fallback;
  return clean.slice(0, 120);
}

/** Build an output filename: "<base>-<suffix>.<ext>" */
export function outputName(originalName, suffix, ext = 'pdf') {
  const base = sanitizeFilename(stripExtension(originalName || 'document'));
  return `${base}${suffix ? `-${suffix}` : ''}.${ext}`;
}

export function isPdfFile(file) {
  return file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name));
}

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp'];
export function isImageFile(file) {
  return file && (IMAGE_TYPES.includes(file.type) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(file.name));
}

/** A cheap fingerprint used to detect the same file being added twice. */
export function fileFingerprint(file) {
  return `${file.name}::${file.size}::${file.lastModified}`;
}

/** Validate size/emptiness/type before we spend any effort on a file. */
export function validateFile(file, kind = 'pdf') {
  if (!file) throw new AppError('No file was selected.');
  if (file.size === 0) throw new AppError(`"${file.name}" is empty (0 bytes).`, 'empty');
  if (kind === 'pdf') {
    if (!isPdfFile(file)) throw new AppError(`"${file.name}" is not a PDF file.`, 'type');
    if (file.size > LIMITS.MAX_PDF_BYTES) {
      throw new AppError(`"${file.name}" is too large (${formatBytes(file.size)}). The limit is ${formatBytes(LIMITS.MAX_PDF_BYTES)} per PDF.`, 'too-large');
    }
  } else if (kind === 'image') {
    if (!isImageFile(file)) throw new AppError(`"${file.name}" is not a supported image (JPG, PNG, WebP, GIF or BMP).`, 'type');
    if (file.size > LIMITS.MAX_IMAGE_BYTES) {
      throw new AppError(`"${file.name}" is too large (${formatBytes(file.size)}). The limit is ${formatBytes(LIMITS.MAX_IMAGE_BYTES)} per image.`, 'too-large');
    }
  }
}

/**
 * Parse a page-range expression such as "1-3, 5, 8-" into groups.
 * Every comma or new-line separated token becomes one group.
 *
 * @param {string} input
 * @param {number} pageCount
 * @returns {number[][]} array of groups, each an array of 0-based page indexes
 */
export function parseRangeGroups(input, pageCount) {
  const tokens = String(input || '')
    .split(/[,;\n]+/)
    .map((t) => t.replace(/\s+/g, '').replace(/[–—]/g, '-'))
    .filter(Boolean);
  if (!tokens.length) throw new AppError('Please enter at least one page or page range.', 'range');

  return tokens.map((token) => {
    let m;
    if ((m = token.match(/^(\d+)$/))) {
      const n = Number(m[1]);
      assertPage(n, pageCount, token);
      return [n - 1];
    }
    if ((m = token.match(/^(\d+)-(\d+)?$/))) {
      const start = Number(m[1]);
      const end = m[2] === undefined ? pageCount : Number(m[2]);
      assertPage(start, pageCount, token);
      assertPage(end, pageCount, token);
      if (start > end) throw new AppError(`"${token}" is not a valid range — the first page must not be after the last page.`, 'range');
      return Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i);
    }
    throw new AppError(`"${token}" is not a valid page or range. Use formats like 3, 1-5 or 8-.`, 'range');
  });
}

/** Flatten range groups into a sorted, de-duplicated list of 0-based indexes. */
export function parsePageList(input, pageCount) {
  const set = new Set(parseRangeGroups(input, pageCount).flat());
  return [...set].sort((a, b) => a - b);
}

function assertPage(n, pageCount, token) {
  if (!Number.isInteger(n) || n < 1 || n > pageCount) {
    throw new AppError(`"${token}" is outside this document — it has ${plural(pageCount, 'page')}.`, 'range');
  }
}

/** Turn a list of 0-based indexes into a compact human string: "1-3, 5". */
export function formatPageList(indexes) {
  const sorted = [...new Set(indexes)].sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    let end = start;
    while (i + 1 < sorted.length && sorted[i + 1] === end + 1) { end = sorted[++i]; }
    parts.push(start === end ? `${start + 1}` : `${start + 1}-${end + 1}`);
  }
  return parts.join(', ');
}

/** Wait for the next animation frame so the UI can repaint. */
export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

/** Yield to the event loop (keeps progress bars smooth during long loops). */
export const yieldToUI = () => new Promise((r) => setTimeout(r, 0));

export function throwIfAborted(signal) {
  if (signal?.aborted) {
    const err = new Error('Aborted');
    err.name = 'AbortError';
    throw err;
  }
}

/** Promise wrapper for canvas.toBlob. */
export function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new AppError('Your browser could not encode the image. The page may be too large.', 'memory'))), type, quality);
  });
}

/** Shrink canvas dimensions so they stay within browser limits. */
export function fitCanvasSize(width, height) {
  let scale = 1;
  const area = width * height;
  if (area > LIMITS.MAX_CANVAS_PIXELS) scale = Math.sqrt(LIMITS.MAX_CANVAS_PIXELS / area);
  const maxSide = Math.max(width, height) * scale;
  if (maxSide > LIMITS.MAX_CANVAS_SIDE) scale *= LIMITS.MAX_CANVAS_SIDE / maxSide;
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)), scale };
}

/** Release a canvas' backing memory immediately (important on iOS). */
export function releaseCanvas(canvas) {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

/** Cryptographically random password for owner passwords. */
export function randomPassword(length = 24) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/** Parse "#RRGGBB" into {r,g,b} in the 0..1 range used by pdf-lib. */
export function hexToRgb01(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const n = m ? parseInt(m[1], 16) : 0x7c5cc4;
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}
