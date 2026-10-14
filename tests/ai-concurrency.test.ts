import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AppStore, createSqliteDatabase, initializeSchema } from '../server/store.js';
import { ConnectionService } from '../server/connections/ConnectionService.js';
import { MemoryCredentialStore, CredentialStoreError, type CredentialStore } from '../server/credentials/CredentialStore.js';

const input = { kind: 'api', provider: 'openai', name: 'Test', model: 'original' } as const;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture(t: test.TestContext, wrap?: (keys: MemoryCredentialStore) => CredentialStore) {
  const directory = mkdtempSync(path.join(tmpdir(), 'ai-concurrency-'));
  const databases = [createSqliteDatabase(path.join(directory, 'app.sqlite')), createSqliteDatabase(path.join(directory, 'app.sqlite'))];
  databases.forEach(initializeSchema);
  t.after(() => { databases.forEach(db => db.close()); rmSync(directory, { recursive: true, force: true }); });
  const stores = databases.map(db => new AppStore(db));
  const keys = new MemoryCredentialStore();
  const services = stores.map(store => new ConnectionService(store, wrap ? wrap(keys) : keys));
  services.forEach(service => service.setTester(async () => 'OK'));
  const profile = services[0].create(input);
  return { databases, stores, keys, services, id: profile.id };
}

test('cross-instance stale key preparation cannot overwrite a tested new model', async t => {
  const entered = deferred(), resume = deferred();
  let staleReference = '';
  const { services: [first, second], stores: [store], keys, id } = fixture(t, keys => ({
    set: async (ref, key) => { await keys.set(ref, key); if (key === 'stale') { staleReference = ref; entered.resolve(); await resume.promise; } },
    get: ref => keys.get(ref), delete: ref => keys.delete(ref)
  }));
  await first.setCredential(id, 'initial');
  const oldRef = store.getConnection(id)!.credentialRef!;
  const pending = first.setCredential(id, 'stale');
  await entered.promise;
  await second.update(id, { model: 'new-model' });
  await second.test(id); await second.activate(id);
  const tested = store.getConnection(id)!;
  resume.resolve();
  await assert.rejects(pending, { code: 'AI_CONNECTION_CHANGED' });
  assert.deepEqual(store.getConnection(id), tested);
  assert.equal((await second.resolve()).apiKey, 'initial');
  assert.equal(await keys.get(oldRef), 'initial');
  assert.equal(await keys.get(staleReference), null);
  assert.deepEqual(store.pendingCredentialCleanup(), []);
});

test('cross-instance stale provider test cannot mark the new revision tested', async t => {
  const { services: [first, second], stores: [store], id } = fixture(t);
  await first.setCredential(id, 'key');
  const entered = deferred(), resume = deferred();
  first.setTester(async () => { entered.resolve(); await resume.promise; return 'OK'; });
  const pending = first.test(id); await entered.promise;
  await second.update(id, { model: 'new-model' }); resume.resolve();
  await assert.rejects(pending, { code: 'AI_CONNECTION_CHANGED' });
  assert.equal(store.getConnection(id)!.testedRevision, null);
});

test('failed compensation retains a cleanup entry for retry without rewinding revision', async t => {
  const entered = deferred(), resume = deferred();
  let abandoned = '', denied = true;
  const { services: [first, second], stores: [store], keys, id } = fixture(t, keys => ({
    set: async (ref, key) => { abandoned = ref; await keys.set(ref, key); entered.resolve(); await resume.promise; },
    get: ref => keys.get(ref),
    delete: async ref => { if (denied) throw new CredentialStoreError(); await keys.delete(ref); }
  }));
  const pending = first.setCredential(id, 'abandoned'); await entered.promise;
  await second.update(id, { model: 'new-model' }); const newer = store.getConnection(id)!;
  resume.resolve(); await assert.rejects(pending, { code: 'AI_CONNECTION_CHANGED' });
  assert.deepEqual(store.getConnection(id), newer);
  assert.deepEqual(store.pendingCredentialCleanup(), [abandoned]);
  denied = false; await first.cleanupCredentials();
  assert.equal(await keys.get(abandoned), null);
  assert.deepEqual(store.pendingCredentialCleanup(), []);
});

test('store CAS rejects stale writes and stale test completion across SQLite handles', async t => {
  const { stores: [first, second], services: [service], id } = fixture(t);
  const original = first.getConnection(id)!;
  await service.update(id, { model: 'new-model' });
  assert.throws(() => second.updateConnection({ ...original, revision: original.revision + 1 }, original.revision), { code: 'AI_CONNECTION_CHANGED' });
  assert.throws(() => second.markConnectionTested(id, original.revision), { code: 'AI_CONNECTION_CHANGED' });
  assert.throws(() => second.markConnectionTested('missing', 1), { code: 'AI_CONNECTION_CHANGED' });
  assert.throws(() => second.updateConnection(original, original.revision), /increase by one/);
  assert.equal(first.getConnection(id)!.testedRevision, null);
});

test('renames advance revision and preserve only an already tested configuration', async t => {
  const { services: [service], stores: [store], id } = fixture(t);
  await service.setCredential(id, 'key'); await service.test(id);
  const before = store.getConnection(id)!;
  await service.update(id, { name: 'Renamed' });
  assert.equal(store.getConnection(id)!.revision, before.revision + 1);
  assert.equal(store.getConnection(id)!.testedRevision, before.revision + 1);
});

test('old key deletion failure keeps committed replacement and retries from durable journal', async t => {
  let denied: string | undefined;
  const { services: [service], stores: [store, other], keys, id } = fixture(t, keys => ({
    set: (ref, key) => keys.set(ref, key), get: ref => keys.get(ref),
    delete: async ref => { if (ref === denied) throw new CredentialStoreError(); await keys.delete(ref); }
  }));
  await service.setCredential(id, 'old');
  const before = store.getConnection(id)!; denied = before.credentialRef!;
  await service.setCredential(id, 'new');
  const after = store.getConnection(id)!;
  assert.equal(after.revision, before.revision + 1);
  assert.equal(await keys.get(after.credentialRef!), 'new');
  assert.deepEqual(other.pendingCredentialCleanup(), [denied]);
  denied = undefined;
  await new ConnectionService(other, keys).cleanupCredentials();
  assert.equal(await keys.get(before.credentialRef!), null);
  assert.deepEqual(store.pendingCredentialCleanup(), []);
  assert.deepEqual(store.getConnection(id), after);
});

test('SQL swap failure compensates new key and rolls back old cleanup journal', async t => {
  const created: string[] = [];
  const { services: [service], stores: [store], databases: [db], keys, id } = fixture(t, keys => ({
    set: async (ref, key) => { created.push(ref); await keys.set(ref, key); },
    get: ref => keys.get(ref), delete: ref => keys.delete(ref)
  }));
  await service.setCredential(id, 'old');
  const before = store.getConnection(id)!;
  db.exec("CREATE TRIGGER reject_swap BEFORE UPDATE ON ai_connections BEGIN SELECT RAISE(ABORT, 'swap rejected'); END");
  await assert.rejects(service.setCredential(id, 'new'), /swap rejected/);
  assert.deepEqual(store.getConnection(id), before);
  assert.equal(await keys.get(created[1]), null);
  assert.equal(await keys.get(before.credentialRef!), 'old');
  assert.deepEqual(store.pendingCredentialCleanup(), []);
});

test('verification failure removes prepared key without touching the profile', async t => {
  let fail = false, prepared = '';
  const { services: [service], stores: [store], keys, id } = fixture(t, keys => ({
    set: async (ref, key) => { prepared = ref; await keys.set(ref, key); },
    get: ref => fail ? Promise.resolve(null) : keys.get(ref), delete: ref => keys.delete(ref)
  }));
  await service.setCredential(id, 'old'); const before = store.getConnection(id)!;
  fail = true;
  await assert.rejects(service.setCredential(id, 'new'), CredentialStoreError);
  assert.deepEqual(store.getConnection(id), before);
  assert.equal(await keys.get(prepared), null);
});

for (const operation of ['deleteCredential', 'delete'] as const) {
  test(`${operation} retains profile and active settings when key deletion fails`, async t => {
    const { services: [service], stores: [store], id } = fixture(t, keys => ({
      set: (ref, key) => keys.set(ref, key), get: ref => keys.get(ref), delete: async () => { throw new CredentialStoreError(); }
    }));
    await service.setCredential(id, 'key'); await service.test(id); await service.activate(id);
    const before = store.getConnection(id)!;
    await assert.rejects(service[operation](id), CredentialStoreError);
    const restored = store.getConnection(id)!;
    assert.deepEqual(restored, { ...before, revision: before.revision + 2, testedRevision: before.revision + 2 });
    assert.equal((await store.getSettings()).activeConnectionId, id);
    assert.equal((await service.resolve()).apiKey, 'key');
    assert.deepEqual(store.pendingCredentialCleanup(), []);
  });

  test(`${operation} commits removal first and preserves a concurrent replacement's actual key`, async t => {
    const entered = deferred(), resume = deferred();
    let removedReference = '';
    const { services: [first, second], stores: [store], keys, id } = fixture(t, keys => ({
      set: (ref, key) => keys.set(ref, key), get: ref => keys.get(ref),
      delete: async ref => { if (ref === removedReference) { entered.resolve(); await resume.promise; } await keys.delete(ref); }
    }));
    await first.setCredential(id, 'key');
    await first.test(id); await first.activate(id);
    removedReference = store.getConnection(id)!.credentialRef!;
    const pending = first[operation](id); await entered.promise;
    if (operation === 'delete') {
      assert.equal(store.getConnection(id), undefined);
      await assert.rejects(second.resolve(id), /not found/);
      second.create({ ...input, model: 'new-model' }, id);
    } else {
      assert.equal(store.getConnection(id)!.credentialRef, null);
      await assert.rejects(second.resolve(id), { code: 'AI_CREDENTIAL_MISSING' });
      await second.update(id, { model: 'new-model' });
    }
    await second.setCredential(id, 'replacement'); await second.test(id); await second.activate(id);
    const newer = store.getConnection(id)!;
    resume.resolve();
    await pending;
    assert.deepEqual(store.getConnection(id), newer);
    assert.equal((await second.resolve()).apiKey, 'replacement');
    assert.equal(await keys.get(removedReference), null);
    assert.deepEqual(store.pendingCredentialCleanup(), []);
  });

  test(`${operation} failure compensation never overwrites a newer tested replacement`, async t => {
    const entered = deferred(), resume = deferred();
    let oldRef = '';
    const { services: [first, second], stores: [store], keys, id } = fixture(t, keys => ({
      set: (ref, key) => keys.set(ref, key), get: ref => keys.get(ref),
      delete: async ref => {
        if (ref === oldRef) { entered.resolve(); await resume.promise; throw new CredentialStoreError(); }
        await keys.delete(ref);
      }
    }));
    await first.setCredential(id, 'old'); await first.test(id); await first.activate(id);
    oldRef = store.getConnection(id)!.credentialRef!;
    const pending = first[operation](id); await entered.promise;
    if (operation === 'delete') second.create({ ...input, model: 'new-model' }, id);
    else await second.update(id, { model: 'new-model' });
    await second.setCredential(id, 'replacement'); await second.test(id); await second.activate(id);
    const newer = store.getConnection(id)!;
    resume.resolve(); await assert.rejects(pending, CredentialStoreError);
    assert.deepEqual(store.getConnection(id), newer);
    assert.equal((await second.resolve()).apiKey, 'replacement');
    assert.equal(await keys.get(oldRef), 'old');
    assert.deepEqual(store.pendingCredentialCleanup(), [oldRef]);
    await new ConnectionService(store, keys).cleanupCredentials();
    assert.equal(await keys.get(oldRef), null);
    assert.equal((await second.resolve()).apiKey, 'replacement');
  });

  test(`${operation} stale SQL snapshot rejects before any key deletion`, async t => {
    const { services: [first, second], stores: [store, other], keys, id } = fixture(t);
    await first.setCredential(id, 'key'); await first.test(id); await first.activate(id);
    const previous = store.getConnection(id)!;
    const newer = { ...previous, model: 'new-model', revision: previous.revision + 1, testedRevision: previous.revision + 1 };
    // Inject another handle's committed mutation after require(), before its CAS.
    if (operation === 'deleteCredential') {
      const original = store.updateConnection.bind(store);
      store.updateConnection = (connection, expected) => { other.updateConnection(newer, previous.revision); original(connection, expected); };
    } else {
      const original = store.deleteConnection.bind(store);
      store.deleteConnection = (connectionId, expected) => { other.updateConnection(newer, previous.revision); original(connectionId, expected); };
    }
    // The enclosing transaction rolls back the injected mutation too; its role is
    // to prove the failed CAS prevents the external key-deletion side effect.
    await assert.rejects(first[operation](id), { code: 'AI_CONNECTION_CHANGED' });
    assert.equal(await keys.get(previous.credentialRef!), 'key');
    assert.equal((await second.resolve()).apiKey, 'key');
    assert.deepEqual(store.pendingCredentialCleanup(), []);
  });
}

test('cleanup skips live references even if a stale journal entry exists', async t => {
  const { services: [service, cleaner], stores: [store], id } = fixture(t);
  await service.setCredential(id, 'key'); await service.test(id); await service.activate(id);
  const reference = store.getConnection(id)!.credentialRef!;
  store.journalCredentialCleanup(reference);
  await cleaner.cleanupCredentials();
  assert.equal((await service.resolve()).apiKey, 'key');
  assert.deepEqual(store.pendingCredentialCleanup(), [reference]);
});

test('concurrent cleanup cannot destroy a key restored after failed deletion', async t => {
  const entered = deferred(), resume = deferred();
  const { services: [service], stores: [store, other], keys, id } = fixture(t, keys => ({
    set: (ref, key) => keys.set(ref, key), get: ref => keys.get(ref),
    delete: async () => { entered.resolve(); await resume.promise; throw new CredentialStoreError(); }
  }));
  await service.setCredential(id, 'key'); await service.test(id); await service.activate(id);
  const pending = service.deleteCredential(id); await entered.promise;
  await new ConnectionService(other, keys).cleanupCredentials();
  resume.resolve(); await assert.rejects(pending, CredentialStoreError);
  assert.equal((await service.resolve()).apiKey, 'key');
  assert.deepEqual(store.pendingCredentialCleanup(), []);
});

test('failed profile deletion restores its row without replacing a new active selection', async t => {
  const entered = deferred(), resume = deferred();
  const { services: [first, second], stores: [store], id } = fixture(t, keys => ({
    set: (ref, key) => keys.set(ref, key), get: ref => keys.get(ref),
    delete: async () => { entered.resolve(); await resume.promise; throw new CredentialStoreError(); }
  }));
  await first.setCredential(id, 'key'); await first.test(id); await first.activate(id);
  const pending = first.delete(id); await entered.promise;
  const selected = second.create({ kind: 'api', provider: 'ollama', name: 'Local', model: 'local' });
  await second.test(selected.id); await second.activate(selected.id);
  resume.resolve(); await assert.rejects(pending, CredentialStoreError);
  assert.equal((await store.getSettings()).activeConnectionId, selected.id);
  assert.equal((await second.resolve(id)).apiKey, 'key');
});

test('deleted and recreated IDs never allow stale writes or compensation of an older row', async t => {
  const { services: [service], stores: [store], id } = fixture(t);
  const before = store.getConnection(id)!;
  store.deleteConnection(id, before.revision);
  const newer = service.create(input, id);
  assert.ok(newer.revision > before.revision);
  assert.throws(() => store.updateConnection({ ...before, revision: before.revision + 1 }, before.revision), { code: 'AI_CONNECTION_CHANGED' });
  store.deleteConnection(id, newer.revision);
  assert.equal(store.restoreDeletedConnection(before, true), false);
  assert.equal(store.getConnection(id), undefined);
});

test('cleanup reclaims an abandoned process owner and removes its orphan key', async t => {
  const { services: [service], stores: [store], keys } = fixture(t);
  await keys.set('orphan', 'key'); store.journalCredentialCleanup('orphan');
  store.setMetadata('credential_cleanup_owner:orphan', '2147483647:exited-process');
  await service.cleanupCredentials();
  assert.equal(await keys.get('orphan'), null);
  assert.deepEqual(store.pendingCredentialCleanup(), []);
});

test('untested activation reports a typed 409 error', t => {
  const { stores: [store], id } = fixture(t);
  assert.throws(() => store.activateTestedConnection(id), { code: 'AI_CONNECTION_UNTESTED', status: 409 });
});

test('creation never overwrites deterministic IDs and backup import rolls back all data on collision', async t => {
  const { stores: [store, other], services: [service], id } = fixture(t);
  const original = store.getConnection(id)!;
  assert.deepEqual(new ConnectionService(other, new MemoryCredentialStore()).create({ ...input, model: 'overwrite' }, id), service.public(original));
  assert.deepEqual(store.getConnection(id), original);
  await service.setCredential(id, 'key'); await service.test(id); await service.activate(id);
  assert.throws(() => store.importConnectionBackup({ folders: [{ id: 'import-folder', name: 'Imported', timestamp: 1 }], connections: [{ ...original, id: 'new-profile' }, original] }), /already exists/);
  assert.equal(store.getConnection('new-profile'), undefined);
  assert.deepEqual((await store.exportData()).folders, []);
  store.importConnectionBackup({ connections: [{ ...original, id: 'new-profile' }] });
  assert.ok(other.getConnection('new-profile'));
  assert.equal((await store.getSettings()).activeConnectionId, id);
});

test('public atomic finalization rolls back metadata and tested status together', async t => {
  const { stores: [store], id } = fixture(t);
  assert.throws(() => store.atomic(() => {
    store.markConnectionTested(id, 1); store.setMetadata('migration-test', 'complete');
    throw new Error('abort');
  }), /abort/);
  assert.equal(store.getConnection(id)!.testedRevision, null);
  assert.equal(store.getMetadata('migration-test'), null);
  assert.equal(store.atomic(() => 42), 42);
});
