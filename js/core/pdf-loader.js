/**
 * Loading PDFs safely — with friendly errors and password support.
 *
 * Two engines are used:
 *   • PDF.js  → rendering previews / thumbnails / images (lazy, fast to open)
 *   • pdf-lib → structural editing and saving
 *
 * We keep the original `File` object and re-read bytes from it on demand
 * instead of holding several ArrayBuffer copies in memory. (PDF.js transfers
 * its buffer to a worker, so it always gets its own copy anyway.)
 */
import { loadPdfjs, loadPdfLib, pdfjsDocumentOptions } from './libs.js';
import { AppError, friendlyMessage } from './errors.js';
import { validateFile, throwIfAborted } from './utils.js';
import { askPassword } from './ui.js';
import { collectGarbage } from './pdf-tools.js';

/** PDF.js PasswordResponses */
const NEED_PASSWORD = 1;
const INCORRECT_PASSWORD = 2;

export async function readBytes(file) {
  try {
    return new Uint8Array(await file.arrayBuffer());
  } catch (err) {
    throw new AppError(friendlyMessage(err, `We couldn't read "${file.name}".`), 'read');
  }
}

/**
 * Open a PDF with PDF.js. Prompts for a password if the file needs one.
 * @returns {Promise<{doc: any, password: string|undefined, numPages: number}>}
 *   Caller owns `doc` and must call `doc.destroy()` when finished.
 */
export async function openWithPdfjs(file, { password, signal, prompt = true } = {}) {
  validateFile(file, 'pdf');
  const pdfjs = await loadPdfjs();
  let currentPassword = password;
  let wasWrong = false;

  for (;;) {
    throwIfAborted(signal);
    const data = await readBytes(file);
    const task = pdfjs.getDocument({ ...pdfjsDocumentOptions(), data, password: currentPassword });
    try {
      const doc = await task.promise;
      if (doc.numPages < 1) {
        await doc.destroy();
        throw new AppError(`"${file.name}" doesn't contain any pages.`, 'empty');
      }
      return { doc, password: currentPassword, numPages: doc.numPages };
    } catch (err) {
      try { await task.destroy(); } catch { /* ignore */ }
      if (err?.name === 'PasswordException') {
        wasWrong = err.code === INCORRECT_PASSWORD || (currentPassword !== undefined && err.code === NEED_PASSWORD);
        if (!prompt) throw new AppError(`"${file.name}" is password protected.`, 'password');
        const entered = await askPassword(file.name, wasWrong);
        if (entered === null) {
          throw new AppError(`"${file.name}" is password protected. Enter its password to work with it.`, 'password');
        }
        currentPassword = entered;
        continue;
      }
      if (err instanceof AppError) throw err;
      throw new AppError(
        err?.name === 'InvalidPDFException' || err?.name === 'MissingPDFException'
          ? `We couldn't process "${file.name}". It may be corrupted or not a valid PDF.`
          : friendlyMessage(err, `We couldn't open "${file.name}". It may be corrupted or password protected.`),
        'corrupt',
      );
    }
  }
}

/**
 * Load a PDF into pdf-lib for editing.
 * Encrypted files are decrypted with the password collected earlier (or an
 * empty password for "owner-password-only" files that open without one).
 * @param {File|Uint8Array|ArrayBuffer} source
 */
export async function loadPdfLibDoc(source, password, name = 'this PDF') {
  const { PDFDocument } = await loadPdfLib();
  const bytes = source instanceof Blob ? await readBytes(source) : source;
  const opts = { updateMetadata: false, throwOnInvalidObject: false };
  const PDFLib = await loadPdfLib();
  // After decryption, drop the old encryption dictionary and cross-reference
  // streams so the saved copy is a clean, unencrypted PDF.
  const clean = (doc) => { collectGarbage(doc, PDFLib); return doc; };
  try {
    if (password !== undefined) return clean(await PDFDocument.load(bytes, { ...opts, password }));
    return await PDFDocument.load(bytes, opts);
  } catch (err) {
    const msg = String(err?.message || '');
    if (/is encrypted/i.test(msg) && password === undefined) {
      try {
        return clean(await PDFDocument.load(bytes, { ...opts, password: '' }));
      } catch {
        throw new AppError(`"${name}" is password protected. Please reopen it and enter the password.`, 'password');
      }
    }
    if (/Password incorrect/i.test(msg)) throw new AppError(`The password for "${name}" is incorrect.`, 'password');
    throw new AppError(friendlyMessage(err, `We couldn't process "${name}". It may be corrupted or use an unsupported PDF structure.`), 'corrupt');
  }
}

/** Read basic info (page count) of a PDF quickly and release resources. */
export async function inspectPdf(file, opts = {}) {
  const { doc, password, numPages } = await openWithPdfjs(file, opts);
  await doc.destroy();
  return { password, numPages };
}
