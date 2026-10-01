/**
 * Watermark PDF — draw text over pages with pdf-lib.
 */
import { h } from '../core/dom.js';
import { createPageTool } from '../core/page-tool.js';
import { field, segmented, select, textInput } from '../core/ui.js';
import { loadPdfLibDoc } from '../core/pdf-loader.js';
import { addTextWatermark, saveToBlob } from '../core/pdf-tools.js';
import { parsePageList, outputName, plural } from '../core/utils.js';
import { AppError } from '../core/errors.js';

export default function mount(ctx) {
  return createPageTool(ctx, {
    actionLabel: 'Add watermark',
    actionIcon: 'watermark',
    progressLabel: 'Adding watermark...',
    features: {},

    options({ numPages }) {
      const text = textInput({ value: 'CONFIDENTIAL', maxlength: 80 });
      const size = h('input', { type: 'range', class: 'range', min: '16', max: '120', step: '2', value: '60' });
      const sizeOut = h('output', { class: 'range-value' }, '60');
      size.addEventListener('input', () => { sizeOut.textContent = size.value; });
      const opacity = h('input', { type: 'range', class: 'range', min: '0.05', max: '1', step: '0.05', value: '0.25' });
      const opacityOut = h('output', { class: 'range-value' }, '25%');
      opacity.addEventListener('input', () => { opacityOut.textContent = `${Math.round(opacity.value * 100)}%`; });
      const color = h('input', { type: 'color', class: 'color-input', value: '#7c5cc4', 'aria-label': 'Watermark colour' });
      const angle = segmented('Angle', [
        { value: '45', label: 'Diagonal ↗' },
        { value: '0', label: 'Horizontal' },
        { value: '-45', label: 'Diagonal ↘' },
      ], '45');
      const layout = segmented('Layout', [
        { value: 'center', label: 'Centered' },
        { value: 'tile', label: 'Tiled' },
      ], 'center');
      const font = select([
        { value: 'HelveticaBold', label: 'Sans Bold' },
        { value: 'Helvetica', label: 'Sans Regular' },
        { value: 'TimesRomanBold', label: 'Serif Bold' },
        { value: 'CourierBold', label: 'Mono Bold' },
      ], 'HelveticaBold');
      const pages = textInput({ placeholder: `All pages (or e.g. 1-3, 5)` });

      const sizeField = field('Text size', size);
      sizeField.querySelector('label').append(' ', sizeOut);
      const opacityField = field('Opacity', opacity);
      opacityField.querySelector('label').append(' ', opacityOut);

      return {
        el: h('div', { class: 'options' },
          field('Watermark text', text),
          h('div', { class: 'field-row' }, field('Font', font), field('Colour', color)),
          sizeField, opacityField, angle.el, layout.el,
          field('Pages', pages, 'Leave empty to watermark every page.')),
        read() {
          const value = text.value.trim();
          if (!value) throw new AppError('Please enter the watermark text.', 'input');
          const targets = pages.value.trim() ? parsePageList(pages.value, numPages) : Array.from({ length: numPages }, (_, i) => i);
          return {
            targets,
            wm: { text: value, fontSize: Number(size.value), autoSize: true, opacity: Number(opacity.value), color: color.value, angle: Number(angle.value), layout: layout.value, font: font.value },
          };
        },
      };
    },

    async run({ file, password, options, progress, signal }) {
      progress.indeterminate('Reading PDF…');
      const doc = await loadPdfLibDoc(file, password, file.name);
      await addTextWatermark(doc, options.wm, options.targets, { signal, onProgress: (f) => progress.set(f * 0.9, 'Adding watermark…') });
      progress.set(0.93, 'Saving…');
      const blob = await saveToBlob(doc);
      progress.set(1, 'Done');
      return { files: [{ blob, name: outputName(file.name, 'watermarked') }], message: `Watermark added to ${plural(options.targets.length, 'page')}.` };
    },
  });
}
