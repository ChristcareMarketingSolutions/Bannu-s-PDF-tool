/**
 * Images to PDF — JPG/PNG/WebP/GIF/BMP → one PDF.
 *
 * JPGs and PNGs are embedded as-is (no quality loss) unless they carry an
 * EXIF rotation flag, in which case they are redrawn upright first.
 * Other formats are converted in the browser before embedding.
 */
import { h } from '../core/dom.js';
import { createQueueTool } from '../core/queue-tool.js';
import { field, segmented, select, textInput } from '../core/ui.js';
import { loadPdfLib } from '../core/libs.js';
import { loadImage, readJpegOrientation, reencodeImage } from '../core/image-utils.js';
import { readBytes } from '../core/pdf-loader.js';
import { saveToBlob } from '../core/pdf-tools.js';
import { sanitizeFilename, stripExtension, plural, formatBytes, throwIfAborted, yieldToUI } from '../core/utils.js';

const PAGE_SIZES = {
  fit: null,
  a4: [595.28, 841.89],
  letter: [612, 792],
  legal: [612, 1008],
  a3: [841.89, 1190.55],
};
const MARGINS = { none: 0, small: 18, medium: 36, large: 54 };
const MAX_PAGE_PT = 14400; // PDF page size limit (200 inches)

export default function mount(ctx) {
  return createQueueTool(ctx, {
    kind: 'image',
    accept: 'image/jpeg,image/png,image/webp,image/gif,image/bmp,.jpg,.jpeg,.png,.webp,.gif,.bmp',
    dropTitle: 'Drop your images here',
    minFiles: 1,
    actionLabel: 'Create PDF',
    actionIcon: 'images',
    progressLabel: 'Creating PDF...',

    async describe(item) {
      const img = await loadImage(item.file);
      const thumb = ctx.registry.create(item.file);
      return { meta: `${img.naturalWidth}×${img.naturalHeight}`, thumb, width: img.naturalWidth, height: img.naturalHeight };
    },

    options() {
      const size = select([
        { value: 'fit', label: 'Same as image' },
        { value: 'a4', label: 'A4 (210 × 297 mm)' },
        { value: 'letter', label: 'US Letter (8.5 × 11 in)' },
        { value: 'legal', label: 'US Legal (8.5 × 14 in)' },
        { value: 'a3', label: 'A3 (297 × 420 mm)' },
      ], 'a4');
      const orientation = segmented('Orientation', [
        { value: 'auto', label: 'Auto' },
        { value: 'portrait', label: 'Portrait' },
        { value: 'landscape', label: 'Landscape' },
      ], 'auto');
      const margin = select([
        { value: 'none', label: 'No margin' },
        { value: 'small', label: 'Small' },
        { value: 'medium', label: 'Medium' },
        { value: 'large', label: 'Large' },
      ], 'small');
      const name = textInput({ value: 'images', maxlength: 100 });
      const sync = () => { orientation.el.hidden = size.value === 'fit'; };
      size.addEventListener('change', sync);
      sync();
      return {
        el: h('div', { class: 'options' },
          field('Page size', size),
          orientation.el,
          field('Margin', margin),
          field('Output file name', name, 'The .pdf extension is added automatically.')),
        read: () => ({
          size: size.value,
          orientation: orientation.value,
          margin: MARGINS[margin.value] ?? 0,
          name: `${sanitizeFilename(stripExtension(name.value.trim() || 'images'), 'images')}.pdf`,
        }),
      };
    },

    async run({ items, options, progress, signal }) {
      const { PDFDocument } = await loadPdfLib();
      const doc = await PDFDocument.create();
      for (let i = 0; i < items.length; i++) {
        throwIfAborted(signal);
        progress.set(i / items.length, `Adding image ${i + 1} of ${items.length}…`);
        const image = await embedImage(doc, items[i].file);
        addImagePage(doc, image, options);
        await yieldToUI();
      }
      try { doc.setProducer('Bannu\'s PDF Tool'); doc.setCreator('Bannu\'s PDF Tool'); } catch { /* optional */ }
      progress.set(0.97, 'Saving PDF…');
      const blob = await saveToBlob(doc);
      progress.set(1, 'Done');
      return {
        files: [{ blob, name: options.name }],
        message: `${plural(items.length, 'image')} combined into one PDF.`,
        stats: [options.name, plural(items.length, 'page'), formatBytes(blob.size)],
      };
    },
  });
}

/** Embed an image file into the PDF using the most faithful method available. */
async function embedImage(doc, file) {
  const type = file.type || '';
  const isJpeg = /jpe?g$/i.test(type) || /\.jpe?g$/i.test(file.name);
  const isPng = /png$/i.test(type) || /\.png$/i.test(file.name);
  if (isJpeg) {
    const bytes = await readBytes(file);
    if (readJpegOrientation(bytes) === 1) {
      try { return await doc.embedJpg(bytes); } catch { /* fall through to re-encode */ }
    }
    const { blob } = await reencodeImage(file, { type: 'image/jpeg', quality: 0.92 });
    return doc.embedJpg(await readBytes(blob));
  }
  if (isPng) {
    try { return await doc.embedPng(await readBytes(file)); } catch { /* fall through */ }
  }
  // WebP / GIF / BMP (or a PNG pdf-lib could not parse): convert in the browser.
  const keepAlpha = /png|gif|webp/i.test(type);
  const { blob } = await reencodeImage(file, keepAlpha ? { type: 'image/png' } : { type: 'image/jpeg', quality: 0.92 });
  const bytes = await readBytes(blob);
  return keepAlpha ? doc.embedPng(bytes) : doc.embedJpg(bytes);
}

/** Add a page sized/positioned according to the options and draw the image. */
function addImagePage(doc, image, { size, orientation, margin }) {
  // Image pixels → points at 96 DPI (what browsers treat as "100%").
  let iw = image.width * 0.75;
  let ih = image.height * 0.75;
  let pageW;
  let pageH;
  if (size === 'fit') {
    const s = Math.min(1, (MAX_PAGE_PT - 2 * margin) / Math.max(iw, ih));
    iw *= s; ih *= s;
    pageW = iw + 2 * margin;
    pageH = ih + 2 * margin;
  } else {
    [pageW, pageH] = PAGE_SIZES[size];
    const landscape = orientation === 'landscape' || (orientation === 'auto' && image.width > image.height);
    if (landscape) [pageW, pageH] = [pageH, pageW];
  }
  const page = doc.addPage([pageW, pageH]);
  const availW = Math.max(1, pageW - 2 * margin);
  const availH = Math.max(1, pageH - 2 * margin);
  // Scale to fit inside the printable area, preserving the aspect ratio.
  const scale = size === 'fit' ? 1 : Math.min(availW / iw, availH / ih);
  const w = iw * scale;
  const hgt = ih * scale;
  page.drawImage(image, { x: (pageW - w) / 2, y: (pageH - hgt) / 2, width: w, height: hgt });
}
