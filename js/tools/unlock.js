/**
 * Unlock PDF — save a decrypted copy of a PDF the user can open.
 * The password is requested when the file is opened (see pdf-loader.js).
 */
import { h } from '../core/dom.js';
import { createPageTool } from '../core/page-tool.js';
import { loadPdfLibDoc, readBytes } from '../core/pdf-loader.js';
import { loadPdfLib } from '../core/libs.js';
import { saveToBlob } from '../core/pdf-tools.js';
import { outputName } from '../core/utils.js';
import { AppError } from '../core/errors.js';

export default function mount(ctx) {
  return createPageTool(ctx, {
    actionLabel: 'Remove password',
    actionIcon: 'unlock',
    progressLabel: 'Unlocking PDF...',
    noViewer: true,
    dropHint: "You'll be asked for the password — it never leaves your device",

    options({ password }) {
      return {
        el: h('div', { class: 'options' },
          h('p', { class: 'summary' }, password !== undefined
            ? 'Password accepted. Click below to save a copy without a password.'
            : 'This file opened without a password. If it has editing or printing restrictions, they will be removed.'),
          h('p', { class: 'muted small' }, 'Only unlock documents you own or are authorised to modify.')),
        read: () => ({}),
      };
    },

    async run({ file, password, progress }) {
      progress.indeterminate('Checking encryption…');
      const { PDFDocument } = await loadPdfLib();
      if (password === undefined) {
        // Not user-password protected — is it encrypted at all (owner restrictions)?
        let encrypted = false;
        try { await PDFDocument.load(await readBytes(file), { updateMetadata: false }); } catch (err) {
          encrypted = /is encrypted/i.test(String(err?.message));
          if (!encrypted) throw err;
        }
        if (!encrypted) throw new AppError("This PDF isn't password protected or restricted — there is nothing to remove.", 'input');
      }
      progress.indeterminate('Decrypting…');
      const doc = await loadPdfLibDoc(file, password, file.name);
      const blob = await saveToBlob(doc);
      progress.set(1, 'Done');
      return { files: [{ blob, name: outputName(file.name, 'unlocked') }], message: 'Your PDF has been unlocked.' };
    },
  });
}
