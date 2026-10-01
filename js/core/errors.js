/**
 * Error handling: everything shown to the user goes through `friendlyMessage`
 * so raw stack traces and library internals are never exposed.
 */

export class AppError extends Error {
  /**
   * @param {string} message  Friendly, user-facing message.
   * @param {string} [code]   Machine-readable category.
   */
  constructor(message, code = 'app') {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}

export const isAbortError = (err) => err?.name === 'AbortError';

/** Map any thrown value to a short, friendly sentence. */
export function friendlyMessage(err, fallback = "Something went wrong while processing your file. Please try again.") {
  if (!err) return fallback;
  if (err instanceof AppError) return err.message;

  const name = err.name || '';
  const msg = String(err.message || '');

  // PDF.js errors
  if (name === 'PasswordException') return 'This PDF is password protected. Please enter the correct password.';
  if (name === 'InvalidPDFException') return "We couldn't read this PDF. It may be corrupted or not a real PDF file.";
  if (name === 'MissingPDFException') return "We couldn't open this file. It may be empty or unreadable.";
  if (name === 'UnexpectedResponseException') return "We couldn't read this file. Please try selecting it again.";

  // pdf-lib errors
  if (/is encrypted/i.test(msg)) return 'This PDF is password protected. Unlock it first, then try again.';
  if (/Password incorrect/i.test(msg)) return 'The password you entered is incorrect.';
  if (/No PDF header|Failed to parse|Expected instance of|Invalid object ref|trailer/i.test(msg)) {
    return "We couldn't process this PDF. It may be corrupted or use an unsupported structure.";
  }
  if (/WinAnsi cannot encode/i.test(msg)) {
    return 'The text contains characters the built-in PDF font cannot display (for example emoji or non-Latin scripts). Please use basic Latin characters.';
  }

  // Browser / memory errors
  if (name === 'RangeError' || /allocation|out of memory|Array buffer/i.test(msg)) {
    return 'Your browser ran out of memory while processing this file. Try a smaller file, fewer pages or a lower quality setting.';
  }
  if (name === 'NotReadableError') return "Your browser couldn't read this file. It may have been moved or deleted — please select it again.";
  if (name === 'EncodingError') return "This image couldn't be decoded. It may be corrupted or in an unsupported format.";
  if (name === 'QuotaExceededError') return 'Your device is low on storage space.';

  return fallback;
}

/** Log technical detail for developers without showing it to the user. */
export function logError(context, err) {
  if (isAbortError(err)) return;
  // eslint-disable-next-line no-console
  console.warn(`[Bannu’s PDF Tool] ${context}:`, err);
}
