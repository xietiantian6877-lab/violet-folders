'use strict';

const path = require('node:path');

/** Absolute file-system folder identities only; never shell namespaces or URLs. */
function normalizePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 32767) return null;
  if (/[\x00-\x1f\x7f"<>|?*]/u.test(value)) return null;
  const input = value.replaceAll('/', '\\');
  if (/^\\\\[.?]\\/u.test(input)) return null;
  const drive = /^[a-z]:\\/iu.test(input);
  const unc = /^\\\\[^\\]+\\[^\\]+(?:\\|$)/u.test(input);
  if ((!drive && !unc) || (drive ? input.slice(2).includes(':') : input.includes(':'))) return null;
  const normalized = path.win32.normalize(input);
  const root = path.win32.parse(normalized).root;
  if (!root || !path.win32.isAbsolute(normalized)) return null;
  const result = normalized.length > root.length ? normalized.replace(/\\+$/u, '') : normalized;
  return drive ? result[0].toUpperCase() + result.slice(1) : result;
}

function keyOf(value) {
  return normalizePath(value)?.toLowerCase();
}

function normalizedHandle(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && /^\d{1,20}$/u.test(value)) return value;
  return 0;
}

function makeEntry(folderPath, isPinned, isOpen, windowHandle = 0) {
  const root = path.win32.parse(folderPath).root;
  const parent = folderPath.length === root.length ? '' : path.win32.dirname(folderPath);
  return Object.freeze({
    path: folderPath,
    name: folderPath.length === root.length ? folderPath : path.win32.basename(folderPath),
    parentPath: parent && !parent.endsWith('\\') ? parent + '\\' : parent,
    isPinned,
    isOpen,
    windowHandle: isOpen ? normalizedHandle(windowHandle) : 0,
  });
}

/** Retained pins + currently open Explorer folders, in a stable display order. */
class FolderCatalog {
  #entries = [];

  constructor(pinnedPaths = []) {
    const seen = new Set();
    for (const candidate of Array.isArray(pinnedPaths) ? pinnedPaths : []) {
      const folderPath = normalizePath(candidate);
      if (!folderPath || seen.has(folderPath.toLowerCase())) continue;
      seen.add(folderPath.toLowerCase());
      this.#entries.push(makeEntry(folderPath, true, false));
    }
  }

  get entries() { return Object.freeze(this.#entries.slice()); }
  get pinnedPaths() { return Object.freeze(this.#entries.filter(entry => entry.isPinned).map(entry => entry.path)); }
  has(folderPath) { return this.find(folderPath) !== undefined; }
  find(folderPath) {
    const key = keyOf(folderPath);
    return key ? this.#entries.find(entry => entry.path.toLowerCase() === key) : undefined;
  }

  reconcile(snapshot) {
    // An invalid message is not an empty Explorer snapshot and must not clear the shelf.
    if (!Array.isArray(snapshot)) return false;
    const open = new Map();
    for (const item of snapshot) {
      const folderPath = normalizePath(item?.path);
      if (!folderPath) continue;
      const key = folderPath.toLowerCase();
      if (!open.has(key)) open.set(key, { path: folderPath, windowHandle: normalizedHandle(item.windowHandle) });
    }

    const next = [];
    for (const entry of this.#entries) {
      const key = entry.path.toLowerCase();
      const current = open.get(key);
      if (current) {
        next.push(entry.isOpen && entry.windowHandle === current.windowHandle
          ? entry : makeEntry(entry.path, entry.isPinned, true, current.windowHandle));
        open.delete(key);
      } else if (entry.isPinned) {
        next.push(entry.isOpen ? makeEntry(entry.path, true, false) : entry);
      }
    }
    for (const current of open.values()) next.push(makeEntry(current.path, false, true, current.windowHandle));
    const changed = next.length !== this.#entries.length || next.some((entry, index) => entry !== this.#entries[index]);
    if (changed) this.#entries = next;
    return changed;
  }

  togglePin(folderPath) {
    const key = keyOf(folderPath);
    const index = key ? this.#entries.findIndex(entry => entry.path.toLowerCase() === key) : -1;
    if (index < 0) return false;
    const entry = this.#entries[index];
    const next = this.#entries.slice();
    if (entry.isPinned && !entry.isOpen) next.splice(index, 1);
    else next[index] = makeEntry(entry.path, !entry.isPinned, entry.isOpen, entry.windowHandle);
    this.#entries = next;
    return true;
  }
}

module.exports = { FolderCatalog, normalizePath };
