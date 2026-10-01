/**
 * PDF to Images — render pages to PNG or JPG with PDF.js.
 */
import { h } from '../core/dom.js';
import { createPageTool, selectionToolbar } from '../core/page-tool.js';
import { field, segmented, select } from '../core/ui.js';
import { renderPageToCanvas } from '../core/render.js';
import { canvasToBlob, releaseCanvas, outputName, plural, yieldToUI, throwIfAborted, formatBytes } from '../core/utils.js';
import { AppError } from '../core/errors.js';

const DPI_OPTIONS = [
  { value: '72', label: 'Screen — 72 DPI' },
  { value: '150', label: 'Standard — 150 DPI' },
  { value: '220', label: 'High — 220 DPI' },
  { value: '300', label: 'Print — 300 DPI' },
];

export default function mount(ctx) {
  return createPageTool(ctx, {
    actionLabel: 'Convert to images',
    actionIcon: 'image',
    progressLabel: 'Converting pages...',
    features: { select: true },
    initialSelection: 'all',
    toolbar: selectionToolbar,
    zipSuffix: 'images',

    options({ viewer }) {
      const format = segmented('Image format', [
        { value: 'png', label: 'PNG', title: 'Lossless, best for text' },
        { value: 'jpg', label: 'JPG', title: 'Smaller, best for photos' },
      ], 'png', () => refresh());
      const quality = h('input', { type: 'range', min: '0.5', max: '1', step: '0.05', value: '0.9', class: 'range' });
      const qualityOut = h('output', { class: 'range-value' }, '90%');
      quality.addEventListener('input', () => { qualityOut.textContent = `${Math.round(quality.value * 100)}%`; });
      const qualityField = field('JPG quality', quality);
      qualityField.querySelector('label').append(' ', qualityOut);
      const dpi = select(DPI_OPTIONS, '150');
      const scope = segmented('Pages', [
        { value: 'selected', label: 'Selected pages' },
        { value: 'all', label: 'All pages' },
      ], 'selected', () => refresh());
      const summary = h('p', { class: 'summary', 'aria-live': 'polite' });

      function pagesToConvert() {
        const pages = viewer.getPages();
        return (scope.value === 'all' ? pages : pages.filter((p) => p.selected)).map((p) => p.src);
      }
      function refresh() {
        qualityField.hidden = format.value !== 'jpg';
        const n = pagesToConvert().length;
        summary.classList.toggle('is-error', n === 0);
        summary.textContent = n ? `${plural(n, 'image')} will be created${n > 1 ? ' (downloaded as a ZIP)' : ''}.` : 'Select at least one page.';
      }
      queueMicrotask(refresh);

      return {
        el: h('div', { class: 'options' }, format.el, qualityField, field('Resolution', dpi, 'Higher DPI = sharper but larger images.'), scope.el, summary),
        read() {
          const list = pagesToConvert();
          if (!list.length) throw new AppError('Select at least one page to convert.', 'input');
          return { list, format: format.value, quality: Number(quality.value), dpi: Number(dpi.value) };
        },
        onViewerChange: refresh,
      };
    },

    async run({ file, viewer, options, progress, signal }) {
      const { list, format, quality, dpi } = options;
      const mime = format === 'png' ? 'image/png' : 'image/jpeg';
      const files = [];
      let downscaled = false;
      for (let i = 0; i < list.length; i++) {
        throwIfAborted(signal);
        progress.set(i / list.length, `Converting page ${list[i] + 1} (${i + 1} of ${list.length})…`);
        // Reuse the already-open PDF.js document from the viewer.
        const { canvas, width } = await renderPageToCanvas(viewer.doc, list[i] + 1, { scale: dpi / 72 });
        if (canvas.width < Math.floor(width * (dpi / 72)) - 2) downscaled = true;
        try {
          const blob = await canvasToBlob(canvas, mime, format === 'jpg' ? quality : undefined);
          files.push({ blob, name: outputName(file.name, `page-${list[i] + 1}`, format), meta: `${canvas.width}×${canvas.height} · ${formatBytes(blob.size)}` });
        } finally {
          releaseCanvas(canvas);
        }
        await yieldToUI();
      }
      progress.set(1, 'Done');
      return {
        files,
        message: files.length > 1 ? `${plural(files.length, 'page')} converted to ${format.toUpperCase()} images.` : `Your ${format.toUpperCase()} image is ready.`,
        stats: files.length === 1 ? [files[0].name, files[0].meta] : [`${plural(files.length, 'image')}`, formatBytes(files.reduce((s, f) => s + f.blob.size, 0))],
        note: downscaled ? 'Some very large pages were scaled down to stay within your browser’s image size limit.' : undefined,
      };
    },
  });
}
