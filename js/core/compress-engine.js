/**
 * Compression engine — isolated so it can be swapped for a stronger engine
 * later (e.g. a WebAssembly build of qpdf or Ghostscript) without touching the UI.
 *
 * Strategies (all run 100% in the browser):
 *
 *  1. "low" — Lossless clean-up
 *       • removes unreachable objects (old revisions, orphaned resources)
 *       • re-saves with compressed object streams
 *     Text, vectors, forms and bookmarks are untouched.
 *
 *  2. "recommended" — Optimise images
 *       • everything from (1), plus
 *       • re-encodes embedded JPEG photos at a lower quality and caps their
 *         resolution, keeping text and vector graphics sharp and selectable.
 *
 *  3. "strong" — Maximum compression
 *       • renders every page to a JPEG image and rebuilds the PDF.
 *       • smallest files, but text is no longer selectable/searchable.
 *
 * If a strategy does not make the file smaller, the original is returned.
 *
 * To add a strategy: implement `async (ctx) => Uint8Array` and register it
 * in STRATEGIES below.
 */
import { loadPdfLib } from './libs.js';
import { loadPdfLibDoc, openWithPdfjs, readBytes } from './pdf-loader.js';
import { renderPageToCanvas } from './render.js';
import { readJpegOrientation, reencodeImage } from './image-utils.js';
import { collectGarbage } from './pdf-tools.js';
import { canvasToBlob, releaseCanvas, throwIfAborted, yieldToUI } from './utils.js';

export const COMPRESSION_LEVELS = {
  low: {
    label: 'Light',
    title: 'Lossless clean-up',
    description: 'Removes unused data and restructures the file. No quality loss at all.',
    strategy: 'cleanup',
  },
  recommended: {
    label: 'Recommended',
    title: 'Optimise images',
    description: 'Recompresses photos inside the PDF. Text stays sharp and selectable.',
    strategy: 'images',
    maxDimension: 1700,
    quality: 0.62,
  },
  strong: {
    label: 'Strong',
    title: 'Maximum compression',
    description: 'Converts each page to an image. Smallest size, but text is no longer selectable.',
    strategy: 'rasterize',
    dpi: 110,
    quality: 0.6,
  },
};

const STRATEGIES = {
  cleanup: cleanupStrategy,
  images: imagesStrategy,
  rasterize: rasterizeStrategy,
};

/**
 * @returns {Promise<{blob: Blob, originalSize: number, reduced: boolean, details: string}>}
 */
export async function compressPdf({ file, password, level = 'recommended', progress, signal }) {
  const settings = COMPRESSION_LEVELS[level] || COMPRESSION_LEVELS.recommended;
  const run = STRATEGIES[settings.strategy];
  const ctx = { file, password, settings, progress, signal, details: [] };
  const bytes = await run(ctx);
  const reduced = bytes.byteLength < file.size;
  const blob = reduced
    ? new Blob([bytes], { type: 'application/pdf' })
    : new Blob([await readBytes(file)], { type: 'application/pdf' });
  return { blob, originalSize: file.size, reduced, details: ctx.details.join(' ') };
}

/* ------------------------------------------------------------------ */

async function cleanupStrategy(ctx) {
  ctx.progress?.indeterminate('Cleaning up the PDF structure…');
  const PDFLib = await loadPdfLib();
  const doc = await loadPdfLibDoc(ctx.file, ctx.password, ctx.file.name);
  throwIfAborted(ctx.signal);
  const removed = collectGarbage(doc, PDFLib);
  if (removed) ctx.details.push(`Removed ${removed} unused objects.`);
  ctx.progress?.indeterminate('Saving…');
  await yieldToUI();
  return doc.save({ useObjectStreams: true, updateFieldAppearances: false });
}

async function imagesStrategy(ctx) {
  const PDFLib = await loadPdfLib();
  const { PDFName, PDFNumber, PDFRawStream, PDFArray, PDFDict } = PDFLib;
  ctx.progress?.indeterminate('Analysing images…');
  const doc = await loadPdfLibDoc(ctx.file, ctx.password, ctx.file.name);
  collectGarbage(doc, PDFLib);
  const context = doc.context;

  // Find JPEG (DCTDecode) images we can safely re-encode.
  const candidates = [];
  for (const [ref, obj] of context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const dict = obj.dict;
    if (dict.get(PDFName.of('Subtype')) !== PDFName.of('Image')) continue;
    if (!isSingleFilter(dict.get(PDFName.of('Filter')), 'DCTDecode', PDFName, PDFArray)) continue;
    if (dict.get(PDFName.of('ImageMask'))) continue;
    if (dict.get(PDFName.of('Decode'))) continue;
    const bpc = dict.get(PDFName.of('BitsPerComponent'));
    if (bpc && bpc.asNumber?.() !== 8) continue;
    if (!isSupportedColorSpace(context.lookup(dict.get(PDFName.of('ColorSpace'))), context, PDFName, PDFArray, PDFDict)) continue;
    if (obj.contents.byteLength < 20 * 1024) continue; // tiny images: not worth it
    if (readJpegOrientation(obj.contents) !== 1) continue; // EXIF-rotated JPEGs would be mis-drawn
    candidates.push({ ref, obj });
  }

  let saved = 0;
  let changed = 0;
  for (let i = 0; i < candidates.length; i++) {
    throwIfAborted(ctx.signal);
    ctx.progress?.set(i / Math.max(1, candidates.length), `Optimising images (${i + 1} of ${candidates.length})…`);
    const { ref, obj } = candidates[i];
    try {
      const { blob, width, height } = await reencodeImage(new Blob([obj.contents], { type: 'image/jpeg' }), {
        type: 'image/jpeg', quality: ctx.settings.quality, maxDimension: ctx.settings.maxDimension,
      });
      const newBytes = new Uint8Array(await blob.arrayBuffer());
      // Only replace when it is a meaningful saving.
      if (newBytes.byteLength < obj.contents.byteLength * 0.9) {
        const dict = obj.dict;
        dict.set(PDFName.of('Width'), PDFNumber.of(width));
        dict.set(PDFName.of('Height'), PDFNumber.of(height));
        dict.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8));
        dict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
        dict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
        dict.delete(PDFName.of('DecodeParms'));
        dict.set(PDFName.of('Length'), PDFNumber.of(newBytes.byteLength));
        context.assign(ref, PDFRawStream.of(dict, newBytes));
        saved += obj.contents.byteLength - newBytes.byteLength;
        changed++;
      }
    } catch {
      // Leave this image untouched if the browser cannot decode it.
    }
    if (i % 4 === 0) await yieldToUI();
  }
  ctx.details.push(candidates.length
    ? `Optimised ${changed} of ${candidates.length} images.`
    : 'No compressible photos were found, so only a lossless clean-up was applied.');
  ctx.progress?.indeterminate('Saving…');
  await yieldToUI();
  return doc.save({ useObjectStreams: true, updateFieldAppearances: false });
}

async function rasterizeStrategy(ctx) {
  const { PDFDocument } = await loadPdfLib();
  const { doc: pdfjsDoc, numPages } = await openWithPdfjs(ctx.file, { password: ctx.password, signal: ctx.signal });
  const out = await PDFDocument.create();
  try {
    for (let n = 1; n <= numPages; n++) {
      throwIfAborted(ctx.signal);
      ctx.progress?.set((n - 1) / numPages, `Compressing page ${n} of ${numPages}…`);
      const { canvas, width, height } = await renderPageToCanvas(pdfjsDoc, n, { scale: ctx.settings.dpi / 72 });
      try {
        const blob = await canvasToBlob(canvas, 'image/jpeg', ctx.settings.quality);
        const jpg = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
        const page = out.addPage([width, height]);
        page.drawImage(jpg, { x: 0, y: 0, width, height });
      } finally {
        releaseCanvas(canvas);
      }
      await yieldToUI();
    }
  } finally {
    pdfjsDoc.destroy();
  }
  ctx.details.push(`Converted ${numPages} pages to optimised images at ${ctx.settings.dpi} DPI.`);
  ctx.progress?.indeterminate('Saving…');
  return out.save({ useObjectStreams: true });
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function isSingleFilter(filter, name, PDFName, PDFArray) {
  if (!filter) return false;
  if (filter === PDFName.of(name)) return true;
  return filter instanceof PDFArray && filter.size() === 1 && filter.get(0) === PDFName.of(name);
}

function isSupportedColorSpace(cs, context, PDFName, PDFArray, PDFDict) {
  if (cs === PDFName.of('DeviceRGB') || cs === PDFName.of('DeviceGray')) return true;
  // [/ICCBased <stream>] with 1 or 3 components
  if (cs instanceof PDFArray && cs.size() === 2 && cs.get(0) === PDFName.of('ICCBased')) {
    const stream = context.lookup(cs.get(1));
    const dict = stream?.dict instanceof PDFDict ? stream.dict : null;
    const n = dict?.get(PDFName.of('N'))?.asNumber?.();
    return n === 1 || n === 3;
  }
  return false;
}
