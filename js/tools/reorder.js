/**
 * Reorder Pages — drag thumbnails into a new order and export.
 */
import { h } from '../core/dom.js';
import { createPageTool } from '../core/page-tool.js';
import { button } from '../core/ui.js';
import { loadPdfLibDoc } from '../core/pdf-loader.js';
import { buildFromPages, saveToBlob } from '../core/pdf-tools.js';
import { outputName, plural } from '../core/utils.js';

export default function mount(ctx) {
  return createPageTool(ctx, {
    actionLabel: 'Export new order',
    actionIcon: 'reorder',
    progressLabel: 'Reordering pages...',
    features: { reorder: true },
    toolbar: (viewer) => [
      button('Reverse', { variant: 'ghost', size: 'sm', iconName: 'swap', onClick: () => viewer.reverse() }),
      button('Reset', { variant: 'ghost', size: 'sm', iconName: 'refresh', onClick: () => viewer.reset() }),
    ],

    options({ viewer }) {
      const summary = h('p', { class: 'summary', 'aria-live': 'polite' });
      const refresh = () => {
        const moved = viewer.getPages().filter((p, i) => p.src !== i).length;
        summary.textContent = moved ? `${plural(moved, 'page')} in a new position.` : 'Pages are in their original order.';
      };
      queueMicrotask(refresh);
      return {
        el: h('div', { class: 'options' },
          h('ul', { class: 'tips' },
            h('li', {}, 'Drag a page to move it. On touch screens, drag the ⋮⋮ handle.'),
            h('li', {}, 'Keyboard: focus a handle and press the arrow keys.'),
            h('li', {}, 'Double-click a page to preview it larger.')),
          summary),
        read: () => ({}),
        onViewerChange: refresh,
      };
    },

    async run({ file, password, pages, progress }) {
      progress.indeterminate('Reading PDF…');
      const src = await loadPdfLibDoc(file, password, file.name);
      progress.indeterminate('Building the reordered PDF…');
      const doc = await buildFromPages(src, pages.map((p) => ({ src: p.src })));
      const blob = await saveToBlob(doc);
      return { files: [{ blob, name: outputName(file.name, 'reordered') }], message: 'Your reordered PDF is ready.' };
    },
  });
}
