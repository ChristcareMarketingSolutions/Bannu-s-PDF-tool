/**
 * Reusable UI building blocks: buttons, form fields, drop zones, progress,
 * alerts, toasts, the password prompt and the "Done!" result panel.
 */
import { h, clear, announce } from './dom.js';
import { icon } from './icons.js';
import { formatBytes, plural, uid } from './utils.js';

/* ------------------------------------------------------------------ */
/* Buttons & form controls                                            */
/* ------------------------------------------------------------------ */

export function button(label, { variant = 'secondary', iconName, onClick, size, ariaLabel, type = 'button', disabled, title, iconOnly = false, className = '' } = {}) {
  const cls = ['btn', `btn-${variant}`, size ? `btn-${size}` : '', iconOnly ? 'btn-icon' : '', className].filter(Boolean).join(' ');
  return h('button', {
    type, class: cls, onClick, disabled, title: title || (iconOnly ? label : undefined),
    'aria-label': ariaLabel || (iconOnly ? label : undefined),
  }, iconName ? icon(iconName, { size: size === 'sm' ? 16 : 18 }) : null, iconOnly ? null : h('span', {}, label));
}

/** Labelled field wrapper. */
export function field(labelText, control, hint) {
  const id = control.id || uid('f');
  control.id = id;
  const hintEl = hint ? h('p', { class: 'field-hint', id: `${id}-hint` }, hint) : null;
  if (hintEl) control.setAttribute('aria-describedby', hintEl.id);
  return h('div', { class: 'field' }, h('label', { class: 'field-label', for: id }, labelText), control, hintEl);
}

export function textInput(attrs = {}) {
  return h('input', { type: 'text', class: 'input', autocomplete: 'off', spellcheck: false, ...attrs });
}

export function numberInput({ value, min, max, step = 1, ...rest } = {}) {
  return h('input', { type: 'number', class: 'input', value: String(value), min, max, step, inputmode: 'numeric', ...rest });
}

export function select(options, value, attrs = {}) {
  const el = h('select', { class: 'input select', ...attrs },
    options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)));
  el.value = value;
  return el;
}

export function checkbox(labelText, checked = false, attrs = {}) {
  const input = h('input', { type: 'checkbox', checked, ...attrs });
  const el = h('label', { class: 'check' }, input, h('span', { class: 'check-box', 'aria-hidden': 'true' }, icon('check', { size: 14, strokeWidth: '3' })), h('span', {}, labelText));
  return { el, input };
}

/**
 * Accessible segmented control (radio group styled as pills).
 * @returns {{el: HTMLElement, get value(): string, set: (v:string)=>void}}
 */
export function segmented(legend, options, value, onChange) {
  const name = uid('seg');
  let current = value;
  const inputs = [];
  const group = h('fieldset', { class: 'segmented' },
    h('legend', { class: 'field-label' }, legend),
    h('div', { class: 'segmented-track' }, options.map((o) => {
      const input = h('input', { type: 'radio', name, value: o.value, checked: o.value === value, class: 'sr-only' });
      input.addEventListener('change', () => { if (input.checked) { current = o.value; onChange?.(o.value); } });
      inputs.push(input);
      return h('label', { class: 'segmented-option', title: o.title }, input, h('span', {}, o.label));
    })));
  return {
    el: group,
    get value() { return current; },
    set(v) { current = v; inputs.forEach((i) => { i.checked = i.value === v; }); },
  };
}

/* ------------------------------------------------------------------ */
/* Alerts & toasts                                                    */
/* ------------------------------------------------------------------ */

/** Inline message. type: 'error' | 'success' | 'info' | 'warning' */
export function alertBox(type, message, { title } = {}) {
  const iconName = type === 'error' || type === 'warning' ? 'alert' : type === 'success' ? 'checkCircle' : 'info';
  return h('div', { class: `alert alert-${type}`, role: type === 'error' ? 'alert' : 'status' },
    icon(iconName, { size: 18 }),
    h('div', {},
      title ? h('strong', { class: 'alert-title' }, title) : null,
      h('p', {}, message)));
}

/** A container that shows one message at a time. */
export function messageSlot() {
  const el = h('div', { class: 'message-slot' });
  return {
    el,
    error(msg, title) { clear(el).append(alertBox('error', msg, { title: title || 'Something went wrong' })); },
    info(msg) { clear(el).append(alertBox('info', msg)); },
    warn(msg) { clear(el).append(alertBox('warning', msg)); },
    success(msg) { clear(el).append(alertBox('success', msg)); },
    clear() { clear(el); },
  };
}

export function toast(message, type = 'info', duration = 4200) {
  let host = document.getElementById('toast-host');
  const dialog = document.querySelector('dialog[open].workspace');
  // Toasts must live inside an open modal dialog to be visible above it.
  const parent = dialog || document.body;
  if (!host || host.parentElement !== parent) {
    host?.remove();
    host = h('div', { id: 'toast-host', class: 'toast-host', role: 'status', 'aria-live': 'polite' });
    parent.appendChild(host);
  }
  const t = h('div', { class: `toast toast-${type}` },
    icon(type === 'error' || type === 'warning' ? 'alert' : type === 'success' ? 'checkCircle' : 'info', { size: 18 }),
    h('span', {}, message));
  host.appendChild(t);
  requestAnimationFrame(() => t.classList.add('is-visible'));
  setTimeout(() => {
    t.classList.remove('is-visible');
    setTimeout(() => t.remove(), 300);
  }, duration);
}

/* ------------------------------------------------------------------ */
/* Drop zone                                                          */
/* ------------------------------------------------------------------ */

/**
 * File picker + drag-and-drop target.
 * @param {{accept:string, multiple?:boolean, title:string, hint?:string, onFiles:(files:File[])=>void, compact?:boolean, buttonLabel?:string}} opts
 */
export function dropzone({ accept, multiple = false, title, hint, onFiles, compact = false, buttonLabel = 'Browse files' }) {
  const input = h('input', { type: 'file', accept, multiple, class: 'sr-only', tabindex: '-1', 'aria-hidden': 'true' });
  const browse = button(buttonLabel, { variant: 'primary', iconName: 'upload', onClick: () => input.click() });
  const zone = h('div', { class: `dropzone${compact ? ' dropzone-compact' : ''}` },
    h('div', { class: 'dropzone-icon', 'aria-hidden': 'true' }, icon(compact ? 'plus' : 'upload', { size: compact ? 22 : 34 })),
    h('p', { class: 'dropzone-title' }, title),
    hint ? h('p', { class: 'dropzone-hint' }, hint) : null,
    browse,
    input);

  input.addEventListener('change', () => {
    const files = [...input.files];
    input.value = '';
    if (files.length) onFiles(files);
  });
  zone.addEventListener('click', (e) => {
    if (e.target === zone || e.target.closest('.dropzone-icon, .dropzone-title, .dropzone-hint')) input.click();
  });

  let depth = 0;
  zone.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; zone.classList.add('is-dragover'); });
  zone.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  zone.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) zone.classList.remove('is-dragover'); });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    depth = 0;
    zone.classList.remove('is-dragover');
    document.body.classList.remove('is-file-dragging');
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) onFiles(multiple ? files : files.slice(0, 1));
  });
  return { el: zone, open: () => input.click() };
}

/* ------------------------------------------------------------------ */
/* Progress                                                           */
/* ------------------------------------------------------------------ */

export function progress(label = 'Processing PDF...') {
  const fill = h('div', { class: 'progress-fill' });
  const pct = h('span', { class: 'progress-pct' }, '');
  const labelEl = h('p', { class: 'progress-label' }, label);
  const bar = h('div', { class: 'progress-track', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': label }, fill);
  const el = h('div', { class: 'progress is-indeterminate' },
    h('div', { class: 'progress-head' }, labelEl, pct),
    bar,
    h('p', { class: 'progress-hint' }, 'Please wait… everything happens on your device.'));
  let lastAnnounced = -1;
  return {
    el,
    /** @param {number} fraction 0..1 */
    set(fraction, text) {
      el.classList.remove('is-indeterminate');
      const p = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
      fill.style.width = `${p}%`;
      pct.textContent = `${p}%`;
      bar.setAttribute('aria-valuenow', String(p));
      if (text) { labelEl.textContent = text; bar.setAttribute('aria-label', text); }
      if (p - lastAnnounced >= 25 || p === 100) { lastAnnounced = p; announce(`${text || labelEl.textContent} ${p}%`); }
    },
    indeterminate(text) {
      el.classList.add('is-indeterminate');
      fill.style.width = '';
      pct.textContent = '';
      bar.removeAttribute('aria-valuenow');
      if (text) { labelEl.textContent = text; bar.setAttribute('aria-label', text); }
    },
  };
}

/* ------------------------------------------------------------------ */
/* Object URL registry — guarantees Blob URLs are released            */
/* ------------------------------------------------------------------ */

export function urlRegistry() {
  const urls = new Set();
  return {
    create(blob) { const u = URL.createObjectURL(blob); urls.add(u); return u; },
    revoke(u) { if (urls.delete(u)) URL.revokeObjectURL(u); },
    revokeAll() { urls.forEach((u) => URL.revokeObjectURL(u)); urls.clear(); },
  };
}

/** Trigger a browser download for a Blob. */
export function downloadBlob(blob, filename, registry) {
  const url = registry ? registry.create(blob) : URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename, class: 'sr-only' });
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Safari needs the URL alive for a moment after click.
  if (!registry) setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/* ------------------------------------------------------------------ */
/* Result panel                                                       */
/* ------------------------------------------------------------------ */

/**
 * The "✓ Done!" screen.
 * @param {object} o
 * @param {{blob: Blob, name: string, meta?: string}[]} o.files
 * @param {() => Promise<{blob: Blob, name: string}>} [o.zip]  builds the ZIP lazily
 * @param {string} [o.message]
 * @param {string[]} [o.stats]
 * @param {HTMLElement} [o.preview]
 * @param {Array<{label:string, onClick:()=>void, iconName?:string}>} [o.actions]
 * @param {ReturnType<urlRegistry>} o.registry
 */
export function resultPanel({ files, zip, message, stats = [], preview, actions = [], registry, note }) {
  const multiple = files.length > 1;
  const isImage = files.every((f) => /^image\//.test(f.blob.type));
  const noun = isImage ? 'image' : 'PDF';
  const heading = h('h3', { class: 'result-title', tabindex: '-1' }, 'Done!');
  const mainLabel = multiple ? 'Download ZIP' : `Download ${isImage ? 'image' : 'PDF'}`;
  const status = h('p', { class: 'result-status', role: 'status' });

  const mainBtn = button(mainLabel, {
    variant: 'primary', size: 'lg', iconName: 'download',
    onClick: async () => {
      if (!multiple) { downloadBlob(files[0].blob, files[0].name, registry); return; }
      mainBtn.disabled = true;
      status.textContent = 'Creating ZIP…';
      try {
        const z = await zip();
        downloadBlob(z.blob, z.name, registry);
        status.textContent = `ZIP ready (${formatBytes(z.blob.size)}).`;
      } catch {
        status.textContent = "We couldn't create the ZIP. Please download the files individually below.";
      } finally {
        mainBtn.disabled = false;
      }
    },
  });

  const list = multiple ? h('ul', { class: 'result-files' }, files.map((f) => h('li', {},
    h('span', { class: 'result-file-icon', 'aria-hidden': 'true' }, icon(isImage ? 'image' : 'file', { size: 18 })),
    h('span', { class: 'result-file-name', title: f.name }, f.name),
    h('span', { class: 'result-file-size' }, f.meta || formatBytes(f.blob.size)),
    button(`Download ${f.name}`, { variant: 'ghost', size: 'sm', iconOnly: true, iconName: 'download', onClick: () => downloadBlob(f.blob, f.name, registry) }),
  ))) : null;

  const el = h('section', { class: 'result', 'aria-labelledby': 'result-title' },
    h('div', { class: 'result-badge', 'aria-hidden': 'true' }, icon('check', { size: 34, strokeWidth: '2.6' })),
    Object.assign(heading, { id: 'result-title' }),
    h('p', { class: 'result-message' }, message || (multiple ? `Your ${plural(files.length, noun)} are ready.` : `Your ${noun} is ready.`)),
    preview ? h('div', { class: 'result-preview' }, preview) : null,
    stats.length ? h('p', { class: 'result-stats' }, stats.join(' · ')) : null,
    note ? h('p', { class: 'result-note' }, note) : null,
    h('div', { class: 'result-actions' }, mainBtn,
      actions.map((a) => button(a.label, { variant: 'secondary', iconName: a.iconName, onClick: a.onClick }))),
    status,
    list ? h('details', { class: 'result-details', open: files.length <= 12 }, h('summary', {}, `Download files individually (${files.length})`), list) : null);
  requestAnimationFrame(() => heading.focus({ preventScroll: false }));
  announce(`Done! ${multiple ? `${files.length} files are` : `Your ${noun} is`} ready to download.`);
  return el;
}

/* ------------------------------------------------------------------ */
/* Password prompt                                                    */
/* ------------------------------------------------------------------ */

/**
 * Ask the user for a PDF password in an accessible modal.
 * @returns {Promise<string|null>} the password, or null if cancelled
 */
export function askPassword(fileName, wasWrong = false) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'password', class: 'input', autocomplete: 'off', 'aria-label': 'PDF password', required: true });
    const error = wasWrong ? alertBox('error', 'That password is incorrect. Please try again.') : null;
    const form = h('form', { class: 'password-form', method: 'dialog' },
      h('div', { class: 'password-icon', 'aria-hidden': 'true' }, icon('lock', { size: 26 })),
      h('h2', { id: 'pw-title' }, 'Password required'),
      h('p', { class: 'muted' }, `"${fileName}" is protected. Enter its password to open it. The password never leaves your device.`),
      error,
      field('Password', input),
      h('div', { class: 'dialog-actions' },
        button('Cancel', { variant: 'secondary', onClick: () => finish(null) }),
        button('Unlock', { variant: 'primary', type: 'submit', iconName: 'unlock' })));
    const dlg = h('dialog', { class: 'mini-dialog', 'aria-labelledby': 'pw-title' }, form);
    let done = false;
    function finish(value) {
      if (done) return;
      done = true;
      dlg.close();
      dlg.remove();
      resolve(value);
    }
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!input.value) { input.focus(); return; }
      finish(input.value);
    });
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
    (document.querySelector('dialog[open].workspace') || document.body).appendChild(dlg);
    dlg.showModal();
    input.focus();
  });
}
