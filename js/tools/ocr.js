/**
 * OCR PDF — recognise text on scanned pages (Tesseract.js) and either add an
 * invisible, searchable text layer to the original PDF or export plain text.
 */
import { h } from '../core/dom.js';
import { createPageTool, selectionToolbar } from '../core/page-tool.js';
import { checkbox, field, segmented, select } from '../core/ui.js';
import { renderPageToCanvas } from '../core/render.js';
import { loadPdfLibDoc } from '../core/pdf-loader.js';
import { saveToBlob } from '../core/pdf-tools.js';
import { createOcrEngine, addInvisibleText, existingPageText, OCR_LANGUAGES } from '../core/ocr.js';
import { loadPdfLib } from '../core/libs.js';
import { releaseCanvas, outputName, plural, yieldToUI, throwIfAborted } from '../core/utils.js';
import { AppError } from '../core/errors.js';

export default function mount(ctx) {
  return createPageTool(ctx, {
    actionLabel: 'Run OCR',
    actionIcon: 'scan',
    progressLabel: 'Recognising text...',
    features: { select: true },
    initialSelection: 'all',
    toolbar: selectionToolbar,
    zipSuffix: 'ocr',

    options({ viewer }) {
      const output = segmented('Output', [
        { value: 'pdf', label: 'Searchable PDF', title: 'Original pages + invisible text you can search and copy' },
        { value: 'txt', label: 'Text (.txt)', title: 'Plain text only' },
        { value: 'both', label: 'Both' },
      ], 'pdf');
      const lang = select(OCR_LANGUAGES, OCR_LANGUAGES[0].value);
      const quality = segmented('Accuracy', [
        { value: '200', label: 'Fast', title: '200 DPI' },
        { value: '300', label: 'Accurate', title: '300 DPI (recommended)' },
        { value: '400', label: 'Small print', title: '400 DPI — for tiny text, slower' },
      ], '300');
      const skip = checkbox('Skip pages that already have text', true);
      const summary = h('p', { class: 'summary', 'aria-live': 'polite' });

      const selected = () => viewer.getPages().filter((p) => p.selected).map((p) => p.src);
      function refresh() {
        const n = selected().length;
        summary.classList.toggle('is-error', n === 0);
        summary.textContent = n ? `${plural(n, 'page')} will be scanned for text. OCR takes a few seconds per page.` : 'Select at least one page.';
      }
      queueMicrotask(refresh);

      return {
        el: h('div', { class: 'options' },
          output.el,
          field('Document language', lang),
          quality.el,
          skip.el,
          h('p', { class: 'field-hint' }, 'Best for scanned letters, contracts and drawings. The first run downloads the OCR engine (~7 MB) once; your file is never uploaded.'),
          summary),
        read() {
          const list = selected();
          if (!list.length) throw new AppError('Select at least one page to OCR.', 'input');
          return { list, output: output.value, lang: lang.value, dpi: Number(quality.value), skipText: skip.input.checked };
        },
        onViewerChange: refresh,
      };
    },

    async run({ file, password, viewer, options, progress, signal }) {
      const { list, output, lang, dpi, skipText } = options;
      const wantPdf = output !== 'txt';
      const wantTxt = output !== 'pdf';

      progress.indeterminate('Starting the OCR engine…');
      const [engine, doc, PDFLib] = await Promise.all([
        createOcrEngine({ lang, signal }),
        wantPdf ? loadPdfLibDoc(file, password, file.name) : null,
        loadPdfLib(),
      ]);
      const font = doc ? await doc.embedFont(PDFLib.StandardFonts.Helvetica) : null;
      const pdfPages = doc?.getPages();

      const texts = [];
      let scanned = 0;
      let skipped = 0;
      let empty = 0;
      let confidence = 0;
      try {
        for (let i = 0; i < list.length; i++) {
          throwIfAborted(signal);
          const n = list[i] + 1;
          const base = i / list.length;
          const step = 1 / list.length;

          const existing = skipText ? await existingPageText(viewer.doc, n) : null;
          if (existing) {
            skipped++;
            texts.push(`--- Page ${n} ---\n${existing}`);
            continue;
          }

          progress.set(base, `Reading page ${n} (${i + 1} of ${list.length})…`);
          const { canvas } = await renderPageToCanvas(viewer.doc, n, { scale: dpi / 72 });
          let result;
          try {
            result = await engine.recognize(canvas, (f) => progress.set(base + step * (0.1 + 0.85 * f), `Recognising page ${n} (${i + 1} of ${list.length})…`));
            if (font) await addInvisibleText(pdfPages[list[i]], font, result, { width: canvas.width, height: canvas.height });
          } finally {
            releaseCanvas(canvas);
          }
          scanned++;
          confidence += result.confidence;
          if (!result.text) empty++;
          texts.push(`--- Page ${n} ---\n${result.text}`);
          await yieldToUI();
        }
      } finally {
        await engine.terminate();
      }
      throwIfAborted(signal);

      progress.set(0.97, 'Saving…');
      const files = [];
      if (wantPdf) {
        if (!scanned) throw new AppError('All selected pages already contain text, so there was nothing to OCR. Untick "Skip pages that already have text" to OCR them anyway.', 'input');
        files.push({ blob: await saveToBlob(doc), name: outputName(file.name, 'ocr') });
      }
      if (wantTxt) {
        files.push({ blob: new Blob([`${texts.join('\n\n')}\n`], { type: 'text/plain;charset=utf-8' }), name: outputName(file.name, 'ocr', 'txt') });
      }
      progress.set(1, 'Done');

      const avg = scanned ? Math.round(confidence / scanned) : 0;
      const notes = [];
      if (skipped) notes.push(`${plural(skipped, 'page')} already had text and ${skipped === 1 ? 'was' : 'were'} left as is.`);
      if (empty) notes.push(`No text was found on ${plural(empty, 'page')}.`);
      if (scanned && avg < 70) notes.push('Recognition confidence is low — try "Small print" accuracy, or check that the scan is sharp and straight.');
      return {
        files,
        message: scanned ? `Text recognised on ${plural(scanned, 'page')}${avg ? ` (average confidence ${avg}%)` : ''}.` : 'Text extracted.',
        note: notes.join(' ') || undefined,
      };
    },
  });
}
