/**
 * Tiny, safe DOM builder.
 *
 * All text goes through `textContent` / `createTextNode`, never `innerHTML`,
 * so user-supplied strings (file names, typed text) can never inject markup.
 *
 *   h('button', { class: 'btn', onClick: fn, 'aria-label': 'Close' }, 'Close')
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  applyAttrs(el, attrs);
  appendChildren(el, children);
  return el;
}

export function applyAttrs(el, attrs) {
  if (!attrs) return el;
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class' || key === 'className') {
      el.className = value;
    } else if (key === 'dataset') {
      Object.assign(el.dataset, value);
    } else if (key === 'style' && typeof value === 'object') {
      for (const [prop, v] of Object.entries(value)) {
        if (prop.startsWith('--')) el.style.setProperty(prop, v);
        else el.style[prop] = v;
      }
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'text') {
      el.textContent = value;
    } else if (value === true) {
      el.setAttribute(key, '');
    } else if (key in el && !key.includes('-') && key !== 'list' && key !== 'form') {
      // Properties such as value, checked, disabled, hidden, type…
      try { el[key] = value; } catch { el.setAttribute(key, String(value)); }
    } else {
      el.setAttribute(key, String(value));
    }
  }
  return el;
}

export function appendChildren(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/** Remove every child node. */
export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** Shortcut for a visually-hidden label (screen readers only). */
export function srOnly(text) {
  return h('span', { class: 'sr-only' }, text);
}

/** Announce a message to assistive technology via the shared live region. */
export function announce(message) {
  const region = document.getElementById('live-region');
  if (!region) return;
  region.textContent = '';
  // Next frame so repeated identical messages are still announced.
  requestAnimationFrame(() => { region.textContent = message; });
}
