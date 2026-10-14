import assert from 'node:assert/strict';
import test from 'node:test';

import { buildIdeaBoardRows } from '../src/components/VirtualIdeaBoard.js';
import type { Folder, IdeaSummary } from '../src/types.js';

function idea(id: string, folder_id?: string): IdeaSummary {
  return {
    id,
    title: id,
    details: `${id} details`,
    timestamp: Number(id.replace(/\D/g, '')) || 1,
    keywords: [],
    status: 'draft',
    folder_id
  };
}

const folders: Folder[] = [
  { id: 'folder-a', name: 'Folder A', timestamp: 1 },
  { id: 'folder-b', name: 'Folder B', timestamp: 2 }
];

test('virtual board builds responsive card rows for a single folder', () => {
  const rows = buildIdeaBoardRows(
    [idea('idea-1', 'folder-a'), idea('idea-2', 'folder-a'), idea('idea-3', 'folder-a')],
    folders,
    'folder-a',
    new Set(folders.map((folder) => folder.id)),
    2,
    null
  );

  assert.deepEqual(rows.map((row) => row.key), ['cards:folder-a:0', 'cards:folder-a:2']);
  assert.deepEqual(rows.map((row) => row.kind), ['cards', 'cards']);
  assert.deepEqual(rows.flatMap((row) => row.kind === 'cards' ? row.ideas.map((item) => item.id) : []), ['idea-1', 'idea-2', 'idea-3']);
});

test('virtual board builds stable folder headers and uncategorized rows', () => {
  const rows = buildIdeaBoardRows(
    [idea('idea-a', 'folder-a'), idea('idea-orphan', 'deleted-folder'), idea('idea-none')],
    folders,
    'all',
    new Set(folders.map((folder) => folder.id)),
    2,
    null
  );

  assert.deepEqual(rows.map((row) => row.key), [
    'header:folder-a',
    'cards:folder-a:0',
    'header:uncategorized',
    'cards:uncategorized:0'
  ]);
  assert.equal(rows[0].kind, 'header');
  assert.equal(rows[2].kind, 'header');
  assert.equal(rows[2].kind === 'header' ? rows[2].isUncategorized : false, true);
});

test('virtual board row keys remain stable when ideas append or move folders', () => {
  const validFolderIds = new Set(folders.map((folder) => folder.id));
  const before = buildIdeaBoardRows([idea('idea-1', 'folder-a'), idea('idea-2', 'folder-a')], folders, 'all', validFolderIds, 2, null);
  const afterAppend = buildIdeaBoardRows([...Array.from({ length: 2 }, (_, index) => idea(`idea-${index + 1}`, 'folder-a')), idea('idea-3', 'folder-a')], folders, 'all', validFolderIds, 2, null);
  const afterMove = buildIdeaBoardRows([idea('idea-1', 'folder-b'), idea('idea-2', 'folder-a')], folders, 'all', validFolderIds, 2, null);

  assert.equal(before[0].key, afterAppend[0].key);
  assert.equal(afterAppend[1].key, 'cards:folder-a:0');
  assert.equal(afterMove[0].key, 'header:folder-a');
  assert.equal(afterMove[1].key, 'cards:folder-a:0');
  assert.equal(afterMove[2].key, 'header:folder-b');
});
