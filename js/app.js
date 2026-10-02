/**
 * Bannu’s PDF Tool — application entry point.
 *
 * Responsibilities:
 *   • render the tool grid + search
 *   • theme (light / dark) toggle
 *   • open each tool in the workspace modal (<dialog>), lazy-loading its module
 *   • hash deep links (#merge, #split…) that survive refresh on GitHub Pages
 *   • page-wide drag-and-drop of files
 */
import { h, clear, announce } from './core/dom.js';
import { icon, hydrateIcons } from './core/icons.js';
import { toast, urlRegistry } from './core/ui.js';
import { preload } from './core/libs.js';
import { isPdfFile, isImageFile, plural } from './core/utils.js';
import { friendlyMessage, logError } from './core/errors.js';
import { TOOLS, CATEGORIES, getTool } from './tools/registry.js';

const $ = (sel) => document.querySelector(sel);

const state = {
  active: null,        // { tool, instance, controller, registry }
  pendingFiles: null,  // files dropped on the home page, waiting for a tool choice
  busy: false,
};

/* ------------------------------------------------------------------ */
/* Theme                                                               */
/* ------------------------------------------------------------------ */

function initTheme() {
  const btn = $('#theme-toggle');
  const apply = (theme) => {
    document.documentElement.dataset.theme = theme;
    clear(btn).append(icon(theme === 'dark' ? 'sun' : 'moon', { size: 18 }));
    btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    btn.title = btn.getAttribute('aria-label');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#1a1526' : '#f4effc');
  };
  apply(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  btn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    apply(next);
    try { localStorage.setItem('bannu-theme', next); } catch { /* storage unavailable */ }
  });
}

/* ------------------------------------------------------------------ */
/* Tool grid & search                                                  */
/* ------------------------------------------------------------------ */

const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));
let activeCategory = 'all';

function renderToolGrid() {
  const grid = $('#tool-grid');
  clear(grid);
  for (const tool of TOOLS) {
    const descId = `tool-${tool.id}-desc`;
    const card = h('li', { class: 'tool-card', dataset: { tool: tool.id, category: tool.category } },
      h('button', {
        type: 'button',
        class: 'tool-select',
        onClick: () => openTool(tool.id),
        onMouseenter: () => preload(tool.libs),
        onFocus: () => preload(tool.libs),
      },
      h('span', { class: 'tool-card-top' },
        h('span', { class: `tool-icon cat-${tool.category}`, 'aria-hidden': 'true' }, icon(tool.icon, { size: 22 })),
        h('span', { class: 'tool-tag', 'aria-hidden': 'true' }, CATEGORY_LABEL[tool.category] || '')),
      h('span', { class: 'tool-name' }, tool.name),
      h('span', { class: 'tool-desc', id: descId }, tool.description),
      h('span', { class: 'tool-open', 'aria-hidden': 'true' }, 'Open tool', icon('chevronRight', { size: 16 }))));
    grid.append(card);
  }
}

function renderCategoryFilter() {
  const host = $('#category-filter');
  clear(host);
  CATEGORIES.forEach((c) => {
    const count = c.id === 'all' ? TOOLS.length : TOOLS.filter((t) => t.category === c.id).length;
    host.append(h('button', {
      type: 'button',
      class: `chip${c.id === activeCategory ? ' is-active' : ''}`,
      'aria-pressed': String(c.id === activeCategory),
      onClick: () => {
        activeCategory = c.id;
        host.querySelectorAll('.chip').forEach((b) => {
          const on = b.dataset.cat === c.id;
          b.classList.toggle('is-active', on);
          b.setAttribute('aria-pressed', String(on));
        });
        applyFilters();
      },
      dataset: { cat: c.id },
    }, c.label, h('span', { class: 'chip-count' }, String(count))));
  });
}

function applyFilters() {
  const input = $('#tool-search');
  const q = input.value.trim().toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);
  let visible = 0;
  document.querySelectorAll('.tool-card').forEach((card) => {
    const tool = getTool(card.dataset.tool);
    const haystack = `${tool.name} ${tool.description} ${tool.keywords} ${CATEGORY_LABEL[tool.category]}`.toLowerCase();
    const match = terms.every((t) => haystack.includes(t)) && (activeCategory === 'all' || tool.category === activeCategory);
    card.hidden = !match;
    if (match) visible++;
  });
  $('#no-results').hidden = visible > 0;
  $('#search-count').textContent = q || activeCategory !== 'all'
    ? (visible ? `${plural(visible, 'tool')} shown` : 'No PDF tools found.')
    : '';
}

function initSearch() {
  const input = $('#tool-search');
  input.addEventListener('input', applyFilters);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = document.querySelector('.tool-card:not([hidden]) .tool-select');
      first?.click();
    }
    if (e.key === 'Escape') { input.value = ''; applyFilters(); }
  });
  // "/" focuses search (like many web apps)
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !state.active && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
      e.preventDefault();
      input.focus();
    }
  });
}

/* ------------------------------------------------------------------ */
/* Workspace modal                                                     */
/* ------------------------------------------------------------------ */

const dialog = () => $('#workspace');

async function openTool(id, files = null, { fromHistory = false } = {}) {
  const tool = getTool(id);
  if (!tool) return;
  if (state.active) destroyActive();
  if (!fromHistory) {
    const url = `${location.pathname}${location.search}#${tool.id}`;
    if (location.hash === `#${tool.id}`) history.replaceState({ tool: tool.id }, '', url);
    else history.pushState({ tool: tool.id }, '', url);
  }
  const files0 = files || state.pendingFiles;
  clearPending();

  const dlg = dialog();
  $('#ws-title').textContent = tool.name;
  clear($('#ws-icon')).append(icon(tool.icon, { size: 20 }));
  const body = $('#ws-body');
  clear(body).append(h('div', { class: 'tool-loading', role: 'status' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), h('p', {}, `Loading ${tool.name}…`)));
  document.title = `${tool.name} — Bannu’s PDF Tool`;

  if (!dlg.open) {
    dlg.classList.remove('is-closing');
    dlg.showModal();
    document.body.classList.add('has-modal');
  }
  body.scrollTop = 0;
  preload(tool.libs);

  const controller = new AbortController();
  const registry = urlRegistry();
  const active = { tool, controller, registry, instance: null };
  state.active = active;

  try {
    const mod = await tool.load();
    if (state.active !== active) return;
    active.instance = mod.default({
      root: body,
      tool,
      files: files0,
      signal: controller.signal,
      registry,
      toast,
      setBusy: (b) => { state.busy = b; dlg.classList.toggle('is-busy', b); },
    });
    $('#ws-back').focus();
  } catch (err) {
    logError('load tool', err);
    clear(body).append(h('div', { class: 'tool-empty' },
      h('div', { class: 'alert alert-error', role: 'alert' }, icon('alert', { size: 18 }),
        h('p', {}, friendlyMessage(err, 'This tool could not be loaded. Please check your connection and reload the page.')))));
  }
}

function destroyActive() {
  const a = state.active;
  if (!a) return;
  a.controller.abort();
  try { a.instance?.destroy?.(); } catch (err) { logError('destroy', err); }
  a.registry.revokeAll();
  state.active = null;
  state.busy = false;
}

/** Close requested by the user (Back button, Esc). Goes through history when possible. */
function requestClose() {
  if (state.busy && !window.confirm('Your file is still being processed. Close this tool anyway?')) return;
  if (history.state?.tool) history.back();
  else {
    closeWorkspace();
    history.replaceState(null, '', `${location.pathname}${location.search}`);
  }
}

function closeWorkspace() {
  const dlg = dialog();
  const id = state.active?.tool.id;
  destroyActive();
  document.title = 'Bannu’s PDF Tool';
  if (!dlg.open) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finish = () => {
    dlg.close();
    dlg.classList.remove('is-closing');
    document.body.classList.remove('has-modal');
    clear($('#ws-body'));
    document.querySelector(`.tool-card[data-tool="${id}"] .tool-select`)?.focus();
  };
  if (reduce) finish();
  else { dlg.classList.add('is-closing'); setTimeout(finish, 180); }
}

function initWorkspace() {
  const dlg = dialog();
  $('#ws-back').addEventListener('click', requestClose);
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); requestClose(); });

  window.addEventListener('popstate', () => {
    const id = location.hash.slice(1);
    if (getTool(id)) {
      if (state.active?.tool.id !== id) openTool(id, null, { fromHistory: true });
    } else if (state.active || dlg.open) {
      closeWorkspace();
    }
  });

  // Deep link on first load: https://…/bannu-pdf-tools/#merge
  const initial = location.hash.slice(1);
  if (getTool(initial)) {
    history.replaceState(null, '', `${location.pathname}${location.search}#${initial}`);
    openTool(initial, null, { fromHistory: true });
  }
}

/* ------------------------------------------------------------------ */
/* Page-wide drag & drop                                               */
/* ------------------------------------------------------------------ */

function clearPending() {
  state.pendingFiles = null;
  $('#pending-banner').hidden = true;
}

function handleHomeDrop(files) {
  const pdfs = files.filter(isPdfFile);
  const images = files.filter(isImageFile);
  if (!pdfs.length && !images.length) {
    toast('Those files aren’t supported. Please drop PDF or image files.', 'warning');
    return;
  }
  if (images.length && !pdfs.length) { openTool('images-to-pdf', images); return; }
  if (pdfs.length > 1) { openTool('merge', pdfs); return; }
  // One PDF: let the user pick what to do with it.
  state.pendingFiles = pdfs;
  const banner = $('#pending-banner');
  $('#pending-name').textContent = pdfs[0].name;
  banner.hidden = false;
  announce(`${pdfs[0].name} is ready. Choose a tool to use it with.`);
  $('#tool-grid').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function initGlobalDrop() {
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    document.body.classList.add('is-file-dragging');
  });
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); // stops the browser from opening the file
    e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) document.body.classList.remove('is-file-dragging');
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    document.body.classList.remove('is-file-dragging');
    const files = [...e.dataTransfer.files];
    if (!files.length) return;
    if (state.active?.instance) state.active.instance.acceptFiles(files);
    else handleHomeDrop(files);
  });
  $('#pending-cancel').addEventListener('click', clearPending);
}

/* ------------------------------------------------------------------ */

function init() {
  hydrateIcons();
  $('#year').textContent = String(new Date().getFullYear());
  initTheme();
  renderToolGrid();
  renderCategoryFilter();
  initSearch();
  initWorkspace();
  initGlobalDrop();
  document.body.classList.add('is-ready');
}

init();
