/**
 * Protect PDF — AES-256 password encryption with permission flags.
 */
import { h } from '../core/dom.js';
import { createPageTool } from '../core/page-tool.js';
import { button, checkbox, field } from '../core/ui.js';
import { loadPdfLibDoc } from '../core/pdf-loader.js';
import { encryptDocument, saveToBlob } from '../core/pdf-tools.js';
import { outputName, randomPassword } from '../core/utils.js';
import { AppError } from '../core/errors.js';

function strength(pw) {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return pw ? Math.min(4, Math.max(1, score)) : 0;
}
const STRENGTH_LABELS = ['', 'Weak', 'Fair', 'Good', 'Strong'];

export default function mount(ctx) {
  return createPageTool(ctx, {
    actionLabel: 'Protect PDF',
    actionIcon: 'lock',
    progressLabel: 'Encrypting PDF...',
    noViewer: true,

    options() {
      const pw = h('input', { type: 'password', class: 'input', autocomplete: 'new-password', maxlength: 127 });
      const confirm = h('input', { type: 'password', class: 'input', autocomplete: 'new-password', maxlength: 127 });
      const owner = h('input', { type: 'password', class: 'input', autocomplete: 'new-password', maxlength: 127, placeholder: 'Optional' });
      const meter = h('div', { class: 'strength', 'aria-hidden': 'true' }, h('span'), h('span'), h('span'), h('span'));
      const meterLabel = h('span', { class: 'strength-label', 'aria-live': 'polite' });
      pw.addEventListener('input', () => {
        const s = strength(pw.value);
        meter.dataset.level = String(s);
        meterLabel.textContent = s ? `Strength: ${STRENGTH_LABELS[s]}` : '';
      });
      const show = button('Show passwords', {
        variant: 'ghost', size: 'sm', iconName: 'eye',
        onClick: () => {
          const visible = pw.type === 'text';
          [pw, confirm, owner].forEach((i) => { i.type = visible ? 'password' : 'text'; });
          show.lastChild.textContent = visible ? 'Show passwords' : 'Hide passwords';
        },
      });
      const print = checkbox('Allow printing', true);
      const copy = checkbox('Allow copying text and images', false);
      const modify = checkbox('Allow editing the document', false);
      const annotate = checkbox('Allow comments and form filling', true);

      return {
        el: h('div', { class: 'options' },
          field('Password', pw, 'Needed to open the PDF.'),
          h('div', { class: 'strength-row' }, meter, meterLabel),
          field('Confirm password', confirm),
          show,
          h('details', { class: 'advanced' },
            h('summary', {}, 'Permissions & owner password'),
            h('div', { class: 'advanced-body' },
              print.el, copy.el, modify.el, annotate.el,
              field('Owner password', owner, 'Lets you change permissions later in a full PDF editor. If empty, a random one is generated.'))),
          h('p', { class: 'muted small' }, 'Encryption: AES-256. Keep your password safe — it cannot be recovered.')),
        read() {
          if (!pw.value) throw new AppError('Please enter a password.', 'input');
          if (pw.value.length < 4) throw new AppError('Please use a password with at least 4 characters.', 'input');
          if (pw.value !== confirm.value) throw new AppError('The passwords do not match.', 'input');
          if (owner.value && owner.value === pw.value) throw new AppError('The owner password should be different from the open password.', 'input');
          return {
            userPassword: pw.value,
            ownerPassword: owner.value || randomPassword(),
            permissions: {
              printing: print.input.checked ? 'highResolution' : false,
              copying: copy.input.checked,
              contentAccessibility: true,
              modifying: modify.input.checked,
              documentAssembly: modify.input.checked,
              annotating: annotate.input.checked,
              fillingForms: annotate.input.checked,
            },
          };
        },
      };
    },

    async run({ file, password, options, progress }) {
      progress.indeterminate('Reading PDF…');
      const doc = await loadPdfLibDoc(file, password, file.name);
      progress.indeterminate('Encrypting with AES-256…');
      encryptDocument(doc, options);
      const blob = await saveToBlob(doc);
      progress.set(1, 'Done');
      return {
        files: [{ blob, name: outputName(file.name, 'protected') }],
        message: 'Your PDF is now password protected.',
        note: 'Readers will need the password to open it. Permission settings are respected by most, but not all, PDF apps.',
        noPreview: true,
      };
    },
  });
}
