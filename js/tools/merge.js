/**
 * Merge PDF — combine several PDFs (in a user-defined order) into one.
 */
import { h } from '../core/dom.js';
import { createQueueTool } from '../core/queue-tool.js';
import { field, textInput } from '../core/ui.js';
import { openWithPdfjs, loadPdfLibDoc } from '../core/pdf-loader.js';
import { renderThumbnailBlob } from '../core/render.js';
import { mergeDocuments, saveToBlob } from '../core/pdf-tools.js';
import { plural, sanitizeFilename, stripExtension, formatBytes } from '../core/utils.js';

export default function mount(ctx) {
  return createQueueTool(ctx, {
    kind: 'pdf',
    accept: 'application/pdf,.pdf',
    dropTitle: 'Drop your PDF files here',
    minFiles: 2,
    actionLabel: 'Merge PDFs',
    actionIcon: 'merge',
    progressLabel: 'Merging PDFs...',

    // Read page count + first-page thumbnail for each file.
    async describe(item) {
      const { doc, password, numPages } = await openWithPdfjs(item.file, { signal: ctx.signal });
      let thumb = null;
      try {
        thumb = (await renderThumbnailBlob(doc, 1, 96)).blob;
      } catch { /* thumbnail is optional */ }
      doc.destroy();
      return { meta: `${plural(numPages, 'page')}${password !== undefined ? ' · unlocked' : ''}`, thumb, pageCount: numPages, password };
    },

    options({ queue }) {
      const name = textInput({ value: 'merged', maxlength: 100, placeholder: 'merged' });
      const summary = h('p', { class: 'summary' });
      const update = () => {
        const pages = queue.ready.reduce((s, i) => s + (i.pageCount || 0), 0);
        const size = queue.ready.reduce((s, i) => s + i.file.size, 0);
        summary.textContent = queue.ready.length
          ? `${plural(queue.ready.length, 'file')} · ${plural(pages, 'page')} · ${formatBytes(size)}`
          : '';
      };
      const prevOnChange = queue.onChange;
      queue.onChange = (q) => { prevOnChange?.(q); update(); };
      update();
      return {
        el: h('div', { class: 'options' }, summary, field('Output file name', name, 'The .pdf extension is added automatically.')),
        read: () => ({ name: `${sanitizeFilename(stripExtension(name.value.trim() || 'merged'), 'merged')}.pdf` }),
      };
    },

    async run({ items, options, progress, signal }) {
      const doc = await mergeDocuments(
        (i) => loadPdfLibDoc(items[i].file, items[i].password, items[i].file.name),
        items.length,
        { signal, onProgress: (f, i) => progress.set(f * 0.9, `Merging ${items[i].file.name} (${i + 1} of ${items.length})…`) },
      );
      progress.set(0.92, 'Saving merged PDF…');
      const blob = await saveToBlob(doc);
      progress.set(1, 'Done');
      const pages = doc.getPageCount();
      return {
        files: [{ blob, name: options.name }],
        message: `${plural(items.length, 'file')} merged into one PDF.`,
        stats: [options.name, plural(pages, 'page'), formatBytes(blob.size)],
      };
    },
  });
}
