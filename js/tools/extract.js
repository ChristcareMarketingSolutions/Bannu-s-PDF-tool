/**
 * Extract Pages — save the selected pages as one new PDF (or one PDF each).
 */
import { h } from '../core/dom.js';
import { createPageTool, selectionToolbar } from '../core/page-tool.js';
import { button, field, segmented, textInput } from '../core/ui.js';
import { loadPdfLibDoc } from '../core/pdf-loader.js';
import { buildFromPages, saveToBlob } from '../core/pdf-tools.js';
import { parsePageList, formatPageList, outputName, plural, yieldToUI, throwIfAborted } from '../core/utils.js';
import { AppError, friendlyMessage } from '../core/errors.js';

export default function mount(ctx) {
  return createPageTool(ctx, {
    actionLabel: 'Extract pages',
    actionIcon: 'extract',
    progressLabel: 'Extracting pages...',
    features: { select: true },
    initialSelection: 'none',
    toolbar: (viewer) => [
      ...selectionToolbar(viewer),
      button('Odd', { variant: 'ghost', size: 'sm', ariaLabel: 'Select odd pages', onClick: () => viewer.setSelection((p) => p.src % 2 === 0) }),
      button('Even', { variant: 'ghost', size: 'sm', ariaLabel: 'Select even pages', onClick: () => viewer.setSelection((p) => p.src % 2 === 1) }),
    ],
    zipSuffix: 'extracted',

    options({ viewer, numPages }) {
      const input = textInput({ placeholder: numPages > 1 ? `e.g. 1-${Math.min(3, numPages)}, ${numPages}` : 'e.g. 1' });
      const summary = h('p', { class: 'summary', 'aria-live': 'polite' });
      const output = segmented('Output', [
        { value: 'single', label: 'One PDF' },
        { value: 'separate', label: 'One PDF per page' },
      ], 'single', () => refresh());
      let syncing = false;

      function refresh() {
        const n = viewer.selectedSources().length;
        summary.classList.remove('is-error');
        summary.textContent = n
          ? `${plural(n, 'page')} selected → ${output.value === 'single' ? '1 PDF' : `${plural(n, 'PDF')} (ZIP)`}.`
          : 'No pages selected yet. Click thumbnails or type page numbers.';
      }

      input.addEventListener('input', () => {
        const value = input.value.trim();
        if (!value) { syncing = true; viewer.selectNone(); syncing = false; refresh(); return; }
        try {
          const list = parsePageList(value, numPages);
          syncing = true;
          viewer.selectSources(list);
          syncing = false;
          input.removeAttribute('aria-invalid');
          refresh();
        } catch (err) {
          input.setAttribute('aria-invalid', 'true');
          summary.classList.add('is-error');
          summary.textContent = friendlyMessage(err);
        }
      });
      queueMicrotask(refresh);

      return {
        el: h('div', { class: 'options' },
          field('Pages to extract', input, 'Type ranges or click the page thumbnails.'),
          output.el, summary),
        read() {
          const selected = viewer.getPages().filter((p) => p.selected).map((p) => p.src).sort((a, b) => a - b);
          if (!selected.length) throw new AppError('Select at least one page to extract.', 'input');
          return { selected, separate: output.value === 'separate' };
        },
        onViewerChange() {
          if (syncing) return;
          const sel = viewer.selectedSources();
          input.value = sel.length ? formatPageList(sel) : '';
          input.removeAttribute('aria-invalid');
          refresh();
        },
      };
    },

    async run({ file, password, options, progress, signal }) {
      progress.indeterminate('Reading PDF…');
      const src = await loadPdfLibDoc(file, password, file.name);
      const { selected, separate } = options;
      if (!separate) {
        progress.indeterminate('Extracting pages…');
        const doc = await buildFromPages(src, selected.map((s) => ({ src: s })));
        const blob = await saveToBlob(doc);
        return {
          files: [{ blob, name: outputName(file.name, 'extracted') }],
          message: `${plural(selected.length, 'page')} extracted into a new PDF.`,
        };
      }
      const files = [];
      for (let i = 0; i < selected.length; i++) {
        throwIfAborted(signal);
        progress.set(i / selected.length, `Extracting page ${selected[i] + 1}…`);
        const doc = await buildFromPages(src, [{ src: selected[i] }]);
        files.push({ blob: await saveToBlob(doc), name: outputName(file.name, `page-${selected[i] + 1}`) });
        await yieldToUI();
      }
      progress.set(1, 'Done');
      return { files, message: `${plural(files.length, 'page')} extracted as separate PDFs.` };
    },
  });
}
