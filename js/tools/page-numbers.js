/**
 * Page Numbers — stamp page numbers in a chosen position and format, with
 * automatic blank-page detection (digital and scanned PDFs) and a choice of
 * how blank pages are numbered.
 */
import { h } from '../core/dom.js';
import { createPageTool } from '../core/page-tool.js';
import { button, field, numberInput, select, textInput, checkbox } from '../core/ui.js';
import { loadPdfLibDoc } from '../core/pdf-loader.js';
import { addPageNumbers, addCentredNotice, saveToBlob } from '../core/pdf-tools.js';
import { detectBlankPages, BLANK_SENSITIVITY } from '../core/blank-detect.js';
import { parsePageList, formatPageList, outputName, plural, uid } from '../core/utils.js';
import { AppError, friendlyMessage } from '../core/errors.js';

const POSITIONS = [
  ['top-left', 'Top left'], ['top-center', 'Top centre'], ['top-right', 'Top right'],
  ['bottom-left', 'Bottom left'], ['bottom-center', 'Bottom centre'], ['bottom-right', 'Bottom right'],
];

const BLANK_MODES = [
  { value: 'number', label: 'Number them like other pages' },
  { value: 'notice', label: 'Number them + "This page is intentionally left blank"' },
  { value: 'hide', label: 'Count them, but print no number' },
  { value: 'skip', label: 'Skip them (not numbered, not counted)' },
];
const BLANK_NOTICE = 'This page is intentionally left blank';
const AUTO_DETECT_MAX_PAGES = 500;

export default function mount(ctx) {
  return createPageTool(ctx, {
    actionLabel: 'Add page numbers',
    actionIcon: 'hash',
    progressLabel: 'Adding page numbers...',
    features: { select: true, selectBadge: 'Blank', selectNoun: 'blank' },
    initialSelection: 'none',

    options({ viewer, numPages }) {
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

      /* ---------------- Blank pages ---------------- */
      const sensitivity = select(Object.entries(BLANK_SENSITIVITY).map(([value, p]) => ({ value, label: p.label })), 'normal');
      const blankMode = select(BLANK_MODES, 'number');
      const blankList = textInput({ placeholder: 'None', 'aria-label': 'Blank pages' });
      const blankStatus = h('p', { class: 'summary', 'aria-live': 'polite' });
      let detecting = false;
      let detectedOnce = false;
      const detectBtn = button('Detect blank pages', { variant: 'secondary', size: 'sm', iconName: 'search', onClick: () => detect() });

      function syncListFromViewer() {
        const blank = viewer.selectedSources();
        blankList.value = formatPageList(blank);
        if (detecting) return;
        if (!detectedOnce && !blank.length) {
          blankStatus.textContent = numPages > AUTO_DETECT_MAX_PAGES ? 'Click "Detect blank pages" to find empty pages (large file).' : '';
        } else {
          blankStatus.textContent = blank.length
            ? `${plural(blank.length, 'blank page')}: ${formatPageList(blank)}. Click a page to correct.`
            : 'No blank pages. Click a page to mark it as blank.';
        }
        blankStatus.classList.toggle('is-error', false);
      }

      blankList.addEventListener('change', () => {
        try {
          const list = blankList.value.trim() ? parsePageList(blankList.value, numPages) : [];
          viewer.selectSources(list);
        } catch (err) {
          blankStatus.textContent = friendlyMessage(err);
          blankStatus.classList.add('is-error');
        }
      });

      async function detect() {
        if (detecting) return;
        detecting = true;
        detectBtn.disabled = true;
        blankStatus.classList.remove('is-error');
        try {
          const { blank } = await detectBlankPages(viewer.doc, {
            sensitivity: sensitivity.value,
            isCancelled: () => viewer.destroyed,
            onProgress: (f, n) => { blankStatus.textContent = n ? `Checking page ${n} of ${numPages} for blank pages…` : 'Finishing…'; },
          });
          if (viewer.destroyed) return;
          detectedOnce = true;
          detecting = false;
          viewer.selectSources(blank);
        } catch (err) {
          if (viewer.destroyed) return;
          blankStatus.textContent = `Blank page detection failed: ${friendlyMessage(err)}`;
          blankStatus.classList.add('is-error');
        } finally {
          detecting = false;
          detectBtn.disabled = false;
        }
      }
      sensitivity.addEventListener('change', () => { if (detectedOnce) detect(); });
      queueMicrotask(() => { syncListFromViewer(); if (numPages <= AUTO_DETECT_MAX_PAGES) detect(); });

      const blankSection = h('fieldset', { class: 'options-group' },
        h('legend', { class: 'field-label' }, 'Blank pages'),
        h('p', { class: 'field-hint' }, 'Works for normal and scanned PDFs. Edges, specks and faint show-through are ignored.'),
        h('div', { class: 'options' },
          field('Sensitivity', sensitivity),
          detectBtn,
          blankStatus,
          field('Blank pages', blankList, 'Edit the list or click pages on the left, e.g. 4, 9, 12-13.'),
          field('On blank pages', blankMode)));

      return {
        el: h('div', { class: 'options' },
          posGrid,
          field('Format', format),
          h('div', { class: 'field-row' }, field('Start at', start), field('Text size', size)),
          h('div', { class: 'field-row' }, field('Margin', margin), field('Colour', color)),
          skipFirst.el,
          field('Pages to number', pages, 'Leave empty to number every page.'),
          blankSection),
        read() {
          if (detecting) throw new AppError('Please wait — still checking for blank pages.', 'input');
          let targets = pages.value.trim() ? parsePageList(pages.value, numPages) : Array.from({ length: numPages }, (_, i) => i);
          if (skipFirst.input.checked) targets = targets.filter((i) => i !== 0);
          const startAt = Number(start.value);
          const fontSize = Number(size.value);
          if (!Number.isInteger(startAt) || startAt < 0) throw new AppError('"Start at" must be a whole number of 0 or more.', 'input');
          if (!(fontSize >= 6 && fontSize <= 48)) throw new AppError('Text size must be between 6 and 48.', 'input');

          const blank = new Set(viewer.selectedSources());
          const mode = blankMode.value;
          const o = { position, format: format.value, startAt, fontSize, margin: Number(margin.value), color: color.value, font: 'Helvetica' };
          if (mode === 'skip') {
            targets = targets.filter((i) => !blank.has(i));
          } else if (mode === 'hide') {
            o.numbers = targets.map((i, n) => (blank.has(i) ? null : n + startAt));
          }
          if (!targets.length || (o.numbers && o.numbers.every((n) => n == null))) throw new AppError('There are no pages to number with these settings.', 'input');
          const numbered = o.numbers ? o.numbers.filter((n) => n != null).length : targets.length;
          return {
            targets, o, mode, numbered,
            blank: [...blank].sort((a, b) => a - b),
            notice: mode === 'notice' ? [...blank].sort((a, b) => a - b) : [],
          };
        },
        onViewerChange: syncListFromViewer,
      };
    },

    async run({ file, password, options, progress, signal }) {
      progress.indeterminate('Reading PDF…');
      const doc = await loadPdfLibDoc(file, password, file.name);
      await addPageNumbers(doc, options.o, options.targets, { signal, onProgress: (f) => progress.set(f * 0.85, 'Numbering pages…') });
      if (options.notice.length) {
        progress.set(0.88, 'Marking blank pages…');
        await addCentredNotice(doc, BLANK_NOTICE, options.notice, { color: options.o.color });
      }
      progress.set(0.93, 'Saving…');
      const blob = await saveToBlob(doc);
      progress.set(1, 'Done');
      const { blank, mode } = options;
      const blankText = {
        number: 'numbered like other pages',
        notice: 'numbered and marked "intentionally left blank"',
        hide: 'counted without a printed number',
        skip: 'skipped',
      }[mode];
      return {
        files: [{ blob, name: outputName(file.name, 'numbered') }],
        message: `Page numbers added to ${plural(options.numbered, 'page')}.`,
        note: blank.length ? `${plural(blank.length, 'blank page')} (${formatPageList(blank)}) ${blankText}.` : 'No blank pages were marked.',
      };
    },
  });
}
