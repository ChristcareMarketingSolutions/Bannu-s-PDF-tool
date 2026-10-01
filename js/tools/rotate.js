/**
 * Rotate PDF — rotate single pages, selected pages or the whole document.
 * Rotation is applied in place (the /Rotate attribute), which is lossless and
 * keeps links, bookmarks and form fields intact.
 */
import { h } from '../core/dom.js';
import { createPageTool, selectionToolbar } from '../core/page-tool.js';
import { button } from '../core/ui.js';
import { loadPdfLibDoc } from '../core/pdf-loader.js';
import { saveToBlob } from '../core/pdf-tools.js';
import { loadPdfLib } from '../core/libs.js';
import { outputName, plural } from '../core/utils.js';
import { AppError } from '../core/errors.js';

export default function mount(ctx) {
  return createPageTool(ctx, {
    actionLabel: 'Apply rotation',
    actionIcon: 'rotate',
    progressLabel: 'Rotating pages...',
    features: { select: true, rotate: true },
    toolbar: selectionToolbar,

    options({ viewer }) {
      const summary = h('p', { class: 'summary', 'aria-live': 'polite' });
      const refresh = () => {
        const n = viewer.getPages().filter((p) => p.rotation).length;
        summary.classList.remove('is-error');
        summary.textContent = n ? `${plural(n, 'page')} will be rotated.` : 'Use the buttons below or the ↺ ↻ icons on each page.';
      };
      const selectedCount = () => viewer.selectedSources().length;
      const rotateSelected = (deg) => {
        if (!selectedCount()) { summary.classList.add('is-error'); summary.textContent = 'Select pages first (click their thumbnails).'; return; }
        viewer.rotateAll(deg, true);
      };
      queueMicrotask(refresh);
      return {
        el: h('div', { class: 'options' },
          h('div', { class: 'option-block' },
            h('p', { class: 'field-label' }, 'All pages'),
            h('div', { class: 'button-row' },
              button('Left 90°', { variant: 'secondary', size: 'sm', iconName: 'rotateLeft', onClick: () => viewer.rotateAll(-90) }),
              button('Right 90°', { variant: 'secondary', size: 'sm', iconName: 'rotate', onClick: () => viewer.rotateAll(90) }),
              button('180°', { variant: 'secondary', size: 'sm', iconName: 'refresh', onClick: () => viewer.rotateAll(180) }))),
          h('div', { class: 'option-block' },
            h('p', { class: 'field-label' }, 'Selected pages'),
            h('div', { class: 'button-row' },
              button('Left 90°', { variant: 'secondary', size: 'sm', iconName: 'rotateLeft', onClick: () => rotateSelected(-90) }),
              button('Right 90°', { variant: 'secondary', size: 'sm', iconName: 'rotate', onClick: () => rotateSelected(90) }))),
          button('Reset all rotations', { variant: 'ghost', size: 'sm', onClick: () => { viewer.pages.forEach((p) => { p.rotation = 0; }); viewer.refreshAll(); } }),
          summary),
        read() {
          if (!viewer.getPages().some((p) => p.rotation)) throw new AppError('Rotate at least one page first.', 'input');
          return {};
        },
        onViewerChange: refresh,
      };
    },

    async run({ file, password, pages, progress }) {
      const { degrees } = await loadPdfLib();
      progress.indeterminate('Reading PDF…');
      const doc = await loadPdfLibDoc(file, password, file.name);
      const docPages = doc.getPages();
      pages.forEach((p) => {
        if (!p.rotation) return;
        const page = docPages[p.src];
        page.setRotation(degrees((((page.getRotation().angle + p.rotation) % 360) + 360) % 360));
      });
      progress.indeterminate('Saving…');
      const blob = await saveToBlob(doc);
      const n = pages.filter((p) => p.rotation).length;
      return { files: [{ blob, name: outputName(file.name, 'rotated') }], message: `${plural(n, 'page')} rotated.` };
    },
  });
}
