/**
 * Page Numbers — stamp page numbers in a chosen position and format.
 */
import { h } from '../core/dom.js';
import { createPageTool } from '../core/page-tool.js';
import { field, numberInput, select, textInput, checkbox } from '../core/ui.js';
import { loadPdfLibDoc } from '../core/pdf-loader.js';
import { addPageNumbers, saveToBlob } from '../core/pdf-tools.js';
import { parsePageList, outputName, plural, uid } from '../core/utils.js';
import { AppError } from '../core/errors.js';

const POSITIONS = [
  ['top-left', 'Top left'], ['top-center', 'Top centre'], ['top-right', 'Top right'],
  ['bottom-left', 'Bottom left'], ['bottom-center', 'Bottom centre'], ['bottom-right', 'Bottom right'],
];

export default function mount(ctx) {
  return createPageTool(ctx, {
    actionLabel: 'Add page numbers',
    actionIcon: 'hash',
    progressLabel: 'Adding page numbers...',
    features: {},

    options({ numPages }) {
      const group = uid('pos');
      let position = 'bottom-center';
      const posGrid = h('fieldset', { class: 'position-picker' },
        h('legend', { class: 'field-label' }, 'Position'),
        h('div', { class: 'position-grid' }, POSITIONS.map(([value, label]) => {
          const input = h('input', { type: 'radio', name: group, value, checked: value === position, class: 'sr-only' });
          input.addEventListener('change', () => { if (input.checked) position = value; });
          return h('label', { class: `position-cell pos-${value}`, title: label }, input, h('span', { class: 'sr-only' }, label), h('span', { class: 'position-dot', 'aria-hidden': 'true' }));
        })),
        h('div', { class: 'position-page', 'aria-hidden': 'true' }));
      const format = select([
        { value: 'plain', label: '1, 2, 3' },
        { value: 'page', label: 'Page 1' },
        { value: 'pageOf', label: 'Page 1 of 10' },
        { value: 'slash', label: '1 / 10' },
        { value: 'dash', label: '- 1 -' },
      ], 'plain');
      const start = numberInput({ value: 1, min: 0, max: 99999 });
      const size = numberInput({ value: 11, min: 6, max: 48 });
      const margin = select([
        { value: '18', label: 'Narrow' },
        { value: '28', label: 'Normal' },
        { value: '42', label: 'Wide' },
      ], '28');
      const color = h('input', { type: 'color', class: 'color-input', value: '#3b3355', 'aria-label': 'Number colour' });
      const skipFirst = checkbox('Skip the first page (cover)', false);
      const pages = textInput({ placeholder: 'All pages (or e.g. 3-20)' });

      return {
        el: h('div', { class: 'options' },
          posGrid,
          field('Format', format),
          h('div', { class: 'field-row' }, field('Start at', start), field('Text size', size)),
          h('div', { class: 'field-row' }, field('Margin', margin), field('Colour', color)),
          skipFirst.el,
          field('Pages to number', pages, 'Leave empty to number every page.')),
        read() {
          let targets = pages.value.trim() ? parsePageList(pages.value, numPages) : Array.from({ length: numPages }, (_, i) => i);
          if (skipFirst.input.checked) targets = targets.filter((i) => i !== 0);
          if (!targets.length) throw new AppError('There are no pages to number with these settings.', 'input');
          const startAt = Number(start.value);
          const fontSize = Number(size.value);
          if (!Number.isInteger(startAt) || startAt < 0) throw new AppError('"Start at" must be a whole number of 0 or more.', 'input');
          if (!(fontSize >= 6 && fontSize <= 48)) throw new AppError('Text size must be between 6 and 48.', 'input');
          return {
            targets,
            o: { position, format: format.value, startAt, fontSize, margin: Number(margin.value), color: color.value, font: 'Helvetica' },
          };
        },
      };
    },

    async run({ file, password, options, progress, signal }) {
      progress.indeterminate('Reading PDF…');
      const doc = await loadPdfLibDoc(file, password, file.name);
      await addPageNumbers(doc, options.o, options.targets, { signal, onProgress: (f) => progress.set(f * 0.9, 'Numbering pages…') });
      progress.set(0.93, 'Saving…');
      const blob = await saveToBlob(doc);
      progress.set(1, 'Done');
      return { files: [{ blob, name: outputName(file.name, 'numbered') }], message: `Page numbers added to ${plural(options.targets.length, 'page')}.` };
    },
  });
}
