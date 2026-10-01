/**
 * FileQueue — an ordered, drag-reorderable list of files (used by Merge PDF
 * and Images to PDF). Each item shows a thumbnail, name, size and details,
 * and can be moved with drag-and-drop, the arrow buttons or the keyboard.
 */
import { h, clear, announce } from './dom.js';
import { icon } from './icons.js';
import { button } from './ui.js';
import { makeSortable, keyboardMove } from './sortable.js';
import { formatBytes, fileFingerprint, validateFile, uid, LIMITS } from './utils.js';
import { friendlyMessage, logError } from './errors.js';

export class FileQueue {
  /**
   * @param {object} o
   * @param {'pdf'|'image'} o.kind
   * @param {(item: object) => Promise<{meta: string, thumb?: Blob|string}>} o.describe
   *        Inspect a file (page count, dimensions…). Runs one file at a time.
   * @param {(queue: FileQueue) => void} [o.onChange]
   * @param {(msg: string, type?: string) => void} o.toast
   * @param {ReturnType<import('./ui.js').urlRegistry>} o.registry
   */
  constructor({ kind, describe, onChange, toast, registry }) {
    this.kind = kind;
    this.describe = describe;
    this.onChange = onChange;
    this.toast = toast;
    this.registry = registry;
    this.items = [];
    this.chain = Promise.resolve();
    this.list = h('ol', { class: 'file-list', 'aria-label': kind === 'pdf' ? 'Selected PDF files' : 'Selected images' });
    this.el = this.list;
    this.sortable = makeSortable(this.list, {
      itemSelector: '.file-item',
      handleSelector: '.file-handle',
      scrollContainer: null,
      onEnd: (ids) => {
        const byId = new Map(this.items.map((i) => [i.id, i]));
        this.items = ids.map((id) => byId.get(id));
        this.render();
        announce('File order updated');
        this.changed();
      },
    });
  }

  /** Add files, skipping invalid ones and duplicates. */
  add(files) {
    let added = 0;
    const totalSize = () => this.items.reduce((s, i) => s + i.file.size, 0);
    for (const file of files) {
      if (this.items.length >= LIMITS.MAX_FILES) {
        this.toast(`You can add up to ${LIMITS.MAX_FILES} files at a time.`, 'warning');
        break;
      }
      try {
        validateFile(file, this.kind);
      } catch (err) {
        this.toast(friendlyMessage(err), 'error');
        continue;
      }
      const fp = fileFingerprint(file);
      if (this.items.some((i) => i.fingerprint === fp)) {
        this.toast(`"${file.name}" is already in the list.`, 'info');
        continue;
      }
      if (totalSize() + file.size > LIMITS.MAX_TOTAL_BYTES) {
        this.toast(`Adding "${file.name}" would exceed the ${formatBytes(LIMITS.MAX_TOTAL_BYTES)} total limit for one job.`, 'warning');
        continue;
      }
      const item = { id: uid('f'), file, fingerprint: fp, status: 'loading', meta: 'Reading…', thumbUrl: null };
      this.items.push(item);
      added++;
      this.chain = this.chain.then(() => this.inspect(item));
    }
    if (added) {
      this.render();
      announce(`${added} file${added === 1 ? '' : 's'} added. ${this.items.length} in total.`);
      this.changed();
    }
    return added;
  }

  async inspect(item) {
    if (!this.items.includes(item)) return;
    try {
      const { meta, thumb, ...extra } = await this.describe(item);
      Object.assign(item, extra, { status: 'ready', meta });
      if (thumb) item.thumbUrl = typeof thumb === 'string' ? thumb : this.registry.create(thumb);
    } catch (err) {
      logError('inspect', err);
      item.status = 'error';
      item.meta = friendlyMessage(err, `We couldn't read "${item.file.name}".`);
    }
    this.updateItem(item);
    this.changed();
  }

  remove(id) {
    const item = this.items.find((i) => i.id === id);
    if (!item) return;
    this.items = this.items.filter((i) => i !== item);
    if (item.thumbUrl) this.registry.revoke(item.thumbUrl);
    this.render();
    announce(`${item.file.name} removed`);
    this.changed();
  }

  move(from, to) {
    if (to < 0 || to >= this.items.length) return;
    const [item] = this.items.splice(from, 1);
    this.items.splice(to, 0, item);
    this.render();
    this.list.querySelector(`[data-id="${item.id}"] .file-handle`)?.focus();
    announce(`${item.file.name} moved to position ${to + 1} of ${this.items.length}`);
    this.changed();
  }

  sortByName() {
    this.items.sort((a, b) => a.file.name.localeCompare(b.file.name, undefined, { numeric: true, sensitivity: 'base' }));
    this.render();
    this.changed();
  }

  clear() {
    this.items.forEach((i) => i.thumbUrl && this.registry.revoke(i.thumbUrl));
    this.items = [];
    this.render();
    this.changed();
  }

  get ready() { return this.items.filter((i) => i.status === 'ready'); }
  get pending() { return this.items.some((i) => i.status === 'loading'); }
  get hasErrors() { return this.items.some((i) => i.status === 'error'); }

  /** Wait until every file has been inspected. */
  whenIdle() { return this.chain; }

  changed() { this.onChange?.(this); }

  render() {
    clear(this.list);
    this.items.forEach((item, index) => this.list.append(this.renderItem(item, index)));
  }

  updateItem(item) {
    const old = this.list.querySelector(`[data-id="${item.id}"]`);
    if (old) old.replaceWith(this.renderItem(item, this.items.indexOf(item)));
  }

  renderItem(item, index) {
    const name = item.file.name;
    const handle = h('button', { type: 'button', class: 'btn btn-ghost btn-icon file-handle', 'aria-label': `Reorder ${name}. Use arrow keys to move.`, title: 'Drag to reorder' }, icon('grip', { size: 18 }));
    handle.addEventListener('keydown', (e) => {
      const next = keyboardMove(e, this.items.indexOf(item), this.items.length);
      if (next >= 0) this.move(this.items.indexOf(item), next);
    });
    const thumb = item.thumbUrl
      ? h('img', { src: item.thumbUrl, alt: '', draggable: 'false' })
      : icon(this.kind === 'pdf' ? 'file' : 'image', { size: 22 });
    const status = item.status === 'error' ? h('span', { class: 'file-error' }, icon('alert', { size: 14 }), h('span', {}, item.meta))
      : h('span', {}, item.status === 'loading' ? 'Reading…' : item.meta);
    const isNew = !item.rendered;
    item.rendered = true;
    return h('li', { class: `file-item is-${item.status}${isNew ? ' is-new' : ''}`, dataset: { id: item.id } },
      handle,
      h('span', { class: 'file-index', 'aria-hidden': 'true' }, String(index + 1)),
      h('span', { class: 'file-thumb' }, thumb),
      h('div', { class: 'file-info' },
        h('p', { class: 'file-name', title: name }, name),
        h('p', { class: 'file-meta' }, `${formatBytes(item.file.size)} · `, status)),
      h('div', { class: 'file-actions', 'data-no-drag': '' },
        button(`Move ${name} up`, { variant: 'ghost', size: 'sm', iconOnly: true, iconName: 'chevronUp', disabled: index === 0, onClick: () => this.move(this.items.indexOf(item), this.items.indexOf(item) - 1) }),
        button(`Move ${name} down`, { variant: 'ghost', size: 'sm', iconOnly: true, iconName: 'chevronDown', disabled: index === this.items.length - 1, onClick: () => this.move(this.items.indexOf(item), this.items.indexOf(item) + 1) }),
        button(`Remove ${name}`, { variant: 'ghost', size: 'sm', iconOnly: true, iconName: 'x', className: 'btn-danger-ghost', onClick: () => this.remove(item.id) })));
  }

  destroy() {
    this.sortable.destroy();
    this.items = [];
  }
}
