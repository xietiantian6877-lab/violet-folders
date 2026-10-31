'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FolderCatalog, normalizePath } = require('../../electron/folder-catalog.cjs');

test('absolute Windows identities preserve Unicode, spaces, percent and UNC roots', () => {
  assert.equal(normalizePath('f:/9.21/培训集合/店铺授权/'), 'F:\\9.21\\培训集合\\店铺授权');
  assert.equal(normalizePath('\\\\server\\share\\资料\\'), '\\\\server\\share\\资料');
  assert.equal(normalizePath('C:\\'), 'C:\\');
  assert.equal(normalizePath('C:\\My folder\\100%'), 'C:\\My folder\\100%');
  assert.equal(normalizePath('C:\\Work\\Old\\..\\Current'), 'C:\\Work\\Current');
});

test('rejects relative paths, URLs, device namespaces and command-like/control characters', () => {
  for (const value of [null, {}, '', 'C:relative', '\\rooted', 'relative\\child', 'file:///C:/Windows', 'shell:Downloads', 'https://example.test', 'C:\\line\nsecond', 'C:\\nul\0value', 'C:\\"quoted"', '\\\\?\\C:\\Windows', '\\\\.\\pipe\\name', 'C:\\folder:stream', 'C:\\wild*card', '\\\\server']) {
    assert.equal(normalizePath(value), null, String(value));
  }
});

test('creates folder rows, final names and full parent prefixes', () => {
  const catalog = new FolderCatalog();
  assert.equal(catalog.reconcile([{ path: 'F:\\9.21\\培训集合\\店铺授权', windowHandle: 42 }]), true);
  assert.deepEqual(catalog.entries[0], { path: 'F:\\9.21\\培训集合\\店铺授权', name: '店铺授权', parentPath: 'F:\\9.21\\培训集合\\', isPinned: false, isOpen: true, windowHandle: 42 });
  catalog.reconcile([{ path: 'C:\\', windowHandle: '123456789012345678' }]);
  assert.equal(catalog.entries[0].name, 'C:\\');
  assert.equal(catalog.entries[0].parentPath, '');
  assert.equal(catalog.entries[0].windowHandle, '123456789012345678');
});

test('case-insensitive duplicates merge and a remaining Explorer window keeps the row', () => {
  const catalog = new FolderCatalog();
  catalog.reconcile([{ path: 'C:\\Example\\A\\', windowHandle: 1 }, { path: 'c:\\example\\a', windowHandle: 2 }]);
  assert.equal(catalog.entries.length, 1);
  assert.equal(catalog.reconcile([{ path: 'c:\\example\\a', windowHandle: 2 }]), true);
  assert.equal(catalog.entries[0].path, 'C:\\Example\\A');
  assert.equal(catalog.entries[0].windowHandle, 2);
  assert.equal(catalog.has('c:\\EXAMPLE\\a\\'), true);
});

test('closing unpinned folders removes every corresponding row', () => {
  const catalog = new FolderCatalog();
  catalog.reconcile([{ path: 'C:\\A' }, { path: 'C:\\B' }]);
  assert.equal(catalog.reconcile([]), true);
  assert.deepEqual(catalog.entries, []);
  assert.equal(catalog.reconcile([]), false);
});

test('pin survives closing and restore, then unpinning a closed folder removes it', () => {
  const catalog = new FolderCatalog();
  catalog.reconcile([{ path: 'C:\\Pinned', windowHandle: 3 }]);
  assert.equal(catalog.togglePin('c:\\PINNED'), true);
  catalog.reconcile([]);
  assert.equal(catalog.entries[0].isPinned, true);
  assert.equal(catalog.entries[0].isOpen, false);
  assert.equal(catalog.entries[0].windowHandle, 0);
  const restored = new FolderCatalog(catalog.pinnedPaths);
  assert.deepEqual(restored.entries, catalog.entries);
  assert.equal(restored.togglePin('C:\\Pinned'), true);
  assert.equal(restored.entries.length, 0);
});

test('unpinning an open row keeps it until its Explorer window closes', () => {
  const catalog = new FolderCatalog(['C:\\Pinned']);
  catalog.reconcile([{ path: 'C:\\Pinned' }]);
  catalog.togglePin('C:\\Pinned');
  assert.equal(catalog.entries.length, 1);
  assert.equal(catalog.entries[0].isPinned, false);
  catalog.reconcile([]);
  assert.equal(catalog.entries.length, 0);
});

test('navigation drops old unpinned paths and retains closed pins in stable order', () => {
  const catalog = new FolderCatalog(['C:\\Pinned']);
  catalog.reconcile([{ path: 'C:\\Old' }, { path: 'C:\\Pinned' }, { path: 'C:\\Unchanged' }]);
  catalog.reconcile([{ path: 'C:\\New' }, { path: 'C:\\Unchanged' }]);
  assert.deepEqual(catalog.entries.map(entry => entry.path), ['C:\\Pinned', 'C:\\Unchanged', 'C:\\New']);
  assert.equal(catalog.entries[0].isOpen, false);
});

test('malformed snapshots do not clear live rows and unchanged snapshots report no change', () => {
  const catalog = new FolderCatalog();
  const snapshot = [{ path: 'C:\\A', windowHandle: 5 }];
  catalog.reconcile(snapshot);
  assert.equal(catalog.reconcile(null), false);
  assert.equal(catalog.reconcile({}), false);
  assert.equal(catalog.reconcile(snapshot), false);
  assert.equal(catalog.entries.length, 1);
  assert.equal(catalog.togglePin('C:\\Unknown'), false);
});

test('restored pins sanitize duplicates and exposed state cannot mutate internal entries', () => {
  const catalog = new FolderCatalog(['C:\\A', 'c:\\a\\', 'relative', null]);
  assert.equal(catalog.entries.length, 1);
  assert.throws(() => catalog.entries.push({ path: 'C:\\Injected' }), TypeError);
  assert.throws(() => { catalog.find('C:\\A').isPinned = false; }, TypeError);
  assert.throws(() => catalog.pinnedPaths.push('C:\\Injected'), TypeError);
  assert.equal(catalog.find('C:\\A').isPinned, true);
});
