export interface CredentialStore {
  set(reference: string, secret: string): Promise<void>;
  get(reference: string): Promise<string | null>;
  delete(reference: string): Promise<void>;
}

export class CredentialStoreError extends Error {
  readonly code = 'AI_CREDENTIAL_STORE_UNAVAILABLE';
  readonly status = 503;
  constructor() { super('macOS Keychain is unavailable or access was denied. Allow Keychain access and retry.'); }
}

export class MacKeychainCredentialStore implements CredentialStore {
  private async entry(reference: string) {
    if (process.platform !== 'darwin') throw new CredentialStoreError();
    const { AsyncEntry } = await import('@napi-rs/keyring');
    return new AsyncEntry('local.startup-idea-tracker', reference);
  }
  async set(reference: string, secret: string): Promise<void> {
    try { await (await this.entry(reference)).setPassword(secret); } catch { throw new CredentialStoreError(); }
  }
  async get(reference: string): Promise<string | null> {
    try { return await (await this.entry(reference)).getPassword(); } catch (error) {
      // Missing entries are different from a locked/denied keychain.
      if (/no entry|not found|NoEntry/i.test(String(error))) return null;
      throw new CredentialStoreError();
    }
  }
  async delete(reference: string): Promise<void> {
    try { await (await this.entry(reference)).deletePassword(); } catch (error) {
      if (/no entry|not found|NoEntry/i.test(String(error))) return;
      throw new CredentialStoreError();
    }
  }
}

export class MemoryCredentialStore implements CredentialStore {
  private values = new Map<string, string>();
  async set(reference: string, secret: string) { this.values.set(reference, secret); }
  async get(reference: string) { return this.values.get(reference) ?? null; }
  async delete(reference: string) { this.values.delete(reference); }
}
