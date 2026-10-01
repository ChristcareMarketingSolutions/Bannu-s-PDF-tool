/**
 * Split PDF — custom ranges, every N pages, or one file per selected page.
 */
import { h } from '../core/dom.js';
import { createPageTool, selectionToolbar } from '../core/page-tool.js';
import { field, numberInput, segmented } from '../core/ui.js';
import { loadPdfLibDoc } from '../core/pdf-loader.js';
import { buildFromPages, saveToBlob } from '../core/pdf-tools.js';
import { parseRangeGroups, formatPageList, outputName, plural, yieldToUI, throwIfAborted } from '../core/utils.js';
import { AppError, friendlyMessage } from '../core/errors.js';

export default function mount(ctx) {
  return createPageTool(ctx, {
    actionLabel: 'Split PDF',
    actionIcon: 'split',
    progressLabel: 'Splitting PDF...',
    features: { select: true },
    initialSelection: 'none',
    toolbar: selectionToolbar,
    zipSuffix: 'split',

    options({ viewer, numPages }) {
      const half = Math.ceil(numPages / 2);
      const defaultRanges = numPages > 1 ? `1-${half}\n${half + 1 === numPages ? numPages : `${half + 1}-${numPages}`}` : '1';
      const ranges = h('textarea', { class: 'input textarea', rows: 5, spellcheck: false, placeholder: '1-5\n6-10\n11-20', value: defaultRanges });
      const everyN = numberInput({ value: Math.min(2, numPages), min: 1, max: numPages });
      const summary = h('p', { class: 'summary', 'aria-live': 'polite' });
      const rangesField = field('Page ranges', ranges, 'One file per line or comma, e.g. 1-5, 6-10, 11-. Clicking pages fills this in.');
      const everyField = field('Pages per file', everyN, `Splits the ${plural(numPages, 'page')} into equal parts.`);
      const selectedHint = h('p', { class: 'muted small' }, 'Click the pages you want. Each selected page becomes its own PDF.');
      let syncing = false;

      const mode = segmented('Split mode', [
        { value: 'ranges', label: 'Ranges' },
        { value: 'every', label: 'Every N pages' },
        { value: 'selected', label: 'Selected pages' },
      ], 'ranges', () => refresh(true));

      /** @returns {number[][]} groups of 0-based indexes */
      function groups() {
        switch (mode.value) {
          case 'every': {
            const n = Number(everyN.value);
            if (!Number.isInteger(n) || n < 1) throw new AppError('Pages per file must be a whole number of 1 or more.', 'input');
            const out = [];
            for (let i = 0; i < numPages; i += n) out.push(Array.from({ length: Math.min(n, numPages - i) }, (_, k) => i + k));
            return out;
          }
          case 'selected': {
            const sel = viewer.selectedSources().sort((a, b) => a - b);
            if (!sel.length) throw new AppError('Select at least one page by clicking its thumbnail.', 'input');
            return sel.map((s) => [s]);
          }
          default:
            return parseRangeGroups(ranges.value, numPages);
        }
      }

      function refresh(syncSelection) {
        rangesField.hidden = mode.value !== 'ranges';
        everyField.hidden = mode.value !== 'every';
        selectedHint.hidden = mode.value !== 'selected';
        try {
          const g = groups();
          summary.classList.remove('is-error');
          summary.textContent = `Creates ${plural(g.length, 'PDF file')}${g.length > 1 ? ' (downloaded as a ZIP)' : ''}.`;
          if (syncSelection && mode.value !== 'selected') {
            syncing = true;
            viewer.selectSources(g.flat());
            syncing = false;
          }
        } catch (err) {
          summary.classList.add('is-error');
          summary.textContent = friendlyMessage(err);
        }
      }

      ranges.addEventListener('input', () => refresh(true));
      everyN.addEventListener('input', () => refresh(true));
      queueMicrotask(() => refresh(true));

      return {
        el: h('div', { class: 'options' }, mode.el, rangesField, everyField, selectedHint, summary),
        read: () => ({ groups: groups() }),
        onViewerChange() {
          if (syncing) return;
          // Clicking thumbnails in "Ranges" mode rewrites the ranges from the selection.
          if (mode.value === 'ranges') {
            const sel = viewer.selectedSources();
            ranges.value = sel.length ? formatPageList(sel).split(', ').join('\n') : '';
          }
          refresh(false);
        },
      };
    },

    async run({ file, password, options, progress, signal }) {
      const { groups } = options;
      progress.indeterminate('Reading PDF…');
      const src = await loadPdfLibDoc(file, password, file.name);
      const files = [];
      for (let i = 0; i < groups.length; i++) {
        throwIfAborted(signal);
        progress.set(i / groups.length, `Creating file ${i + 1} of ${groups.length}…`);
        const group = groups[i];
        const doc = await buildFromPages(src, group.map((s) => ({ src: s })));
        const blob = await saveToBlob(doc);
        const label = group.length === 1 ? `page-${group[0] + 1}` : `pages-${group[0] + 1}-${group[group.length - 1] + 1}`;
        files.push({ blob, name: outputName(file.name, label), meta: plural(group.length, 'page') });
        await yieldToUI();
      }
      progress.set(1, 'Done');
      return { files, message: files.length > 1 ? `Your PDF was split into ${files.length} files.` : 'Your PDF is ready.' };
    },
  });
}
