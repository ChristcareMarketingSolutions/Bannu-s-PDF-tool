/**
 * Delete Pages — mark pages for removal, then export the remaining pages.
 * Pages are removed in place, so bookmarks, links, form fields and metadata
 * of the remaining pages are preserved.
 */
import { h } from '../core/dom.js';
import { createPageTool } from '../core/page-tool.js';
import { button, field, textInput } from '../core/ui.js';
import { loadPdfLibDoc } from '../core/pdf-loader.js';
import { saveToBlob } from '../core/pdf-tools.js';
import { parsePageList, formatPageList, outputName, plural } from '../core/utils.js';
import { AppError, friendlyMessage } from '../core/errors.js';

export default function mount(ctx) {
  return createPageTool(ctx, {
    actionLabel: 'Delete pages & export',
    actionIcon: 'trash',
    progressLabel: 'Removing pages...',
    features: { remove: true },
    toolbar: (viewer) => [
      button('Keep all', { variant: 'ghost', size: 'sm', iconName: 'refresh', onClick: () => viewer.markRemovedSources([]) }),
    ],

    options({ viewer, numPages }) {
      const input = textInput({ placeholder: 'e.g. 2, 5-7' });
      const summary = h('p', { class: 'summary', 'aria-live': 'polite' });
      let syncing = false;

      const removed = () => viewer.getPages().filter((p) => p.removed).map((p) => p.src);
      function refresh() {
        const r = removed().length;
        summary.classList.remove('is-error');
        summary.textContent = r
          ? `Removing ${plural(r, 'page')} — ${plural(numPages - r, 'page')} will remain.`
          : 'Click the pages you want to delete, or type their numbers.';
      }

      input.addEventListener('input', () => {
        const value = input.value.trim();
        try {
          const list = value ? parsePageList(value, numPages) : [];
          if (list.length >= numPages) throw new AppError('You cannot delete every page — at least one must remain.', 'range');
          syncing = true;
          viewer.markRemovedSources(list);
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
        el: h('div', { class: 'options' }, field('Pages to delete', input, 'Click thumbnails to mark pages, or type page numbers.'), summary),
        read() {
          const list = removed();
          if (!list.length) throw new AppError('Mark at least one page to delete.', 'input');
          if (list.length >= numPages) throw new AppError('At least one page must remain.', 'input');
          return { removed: list };
        },
        onViewerChange() {
          if (syncing) return;
          const list = removed();
          input.value = list.length ? formatPageList(list) : '';
          input.removeAttribute('aria-invalid');
          refresh();
        },
      };
    },

    async run({ file, password, options, progress }) {
      progress.indeterminate('Reading PDF…');
      const doc = await loadPdfLibDoc(file, password, file.name);
      // Remove from the highest index down so earlier indexes stay valid.
      [...options.removed].sort((a, b) => b - a).forEach((i) => doc.removePage(i));
      progress.indeterminate('Saving…');
      const blob = await saveToBlob(doc);
      return {
        files: [{ blob, name: outputName(file.name, 'edited') }],
        message: `${plural(options.removed.length, 'page')} deleted. ${plural(doc.getPageCount(), 'page')} remain.`,
      };
    },
  });
}
