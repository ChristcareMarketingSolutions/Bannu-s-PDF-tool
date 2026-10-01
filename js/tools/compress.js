/**
 * Compress PDF — UI around js/core/compress-engine.js.
 */
import { h } from '../core/dom.js';
import { createPageTool } from '../core/page-tool.js';
import { uid } from '../core/utils.js';
import { compressPdf, COMPRESSION_LEVELS } from '../core/compress-engine.js';
import { formatBytes, outputName } from '../core/utils.js';

export default function mount(ctx) {
  return createPageTool(ctx, {
    actionLabel: 'Compress PDF',
    actionIcon: 'compress',
    progressLabel: 'Compressing PDF...',
    noViewer: true,

    options({ file }) {
      const name = uid('level');
      let level = 'recommended';
      const cards = Object.entries(COMPRESSION_LEVELS).map(([key, l]) => {
        const input = h('input', { type: 'radio', name, value: key, checked: key === level, class: 'sr-only' });
        input.addEventListener('change', () => { if (input.checked) level = key; });
        return h('label', { class: 'level-card' }, input,
          h('span', { class: 'level-head' }, h('span', { class: 'level-name' }, l.label), h('span', { class: 'level-title' }, l.title)),
          h('span', { class: 'level-desc' }, l.description));
      });
      return {
        el: h('div', { class: 'options' },
          h('p', { class: 'summary' }, `Current size: ${formatBytes(file.size)}`),
          h('fieldset', { class: 'level-group' }, h('legend', { class: 'field-label' }, 'Compression level'), cards),
          h('p', { class: 'muted small' }, 'Results depend on the content. PDFs with many photos or scans shrink the most; text-only PDFs are often already compact.')),
        read: () => ({ level }),
      };
    },

    async run({ file, password, options, progress, signal }) {
      const { blob, originalSize, reduced, details } = await compressPdf({ file, password, level: options.level, progress, signal });
      progress.set(1, 'Done');
      const saving = Math.round((1 - blob.size / originalSize) * 100);
      return {
        files: [{ blob, name: outputName(file.name, 'compressed') }],
        message: reduced
          ? `Your PDF is now ${saving}% smaller.`
          : 'This PDF is already well optimised — we could not make it smaller with this level, so your original file is provided unchanged.',
        stats: [`${formatBytes(originalSize)} → ${formatBytes(blob.size)}`, reduced ? `−${saving}%` : 'no change'],
        note: details || undefined,
      };
    },
  });
}
