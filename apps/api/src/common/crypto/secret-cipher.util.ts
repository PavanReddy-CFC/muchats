import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit nonce, the GCM-recommended size

/** AES-256-GCM encrypt/decrypt for secrets stored at rest (currently: per-tenant Firebase
 *  service-account JSON — see TenantPushConfig). The key is deployment-wide
 *  (PUSH_CONFIG_ENCRYPTION_KEY), not per-tenant: it protects the *storage*, while the
 *  Firebase credentials themselves are what's actually per-tenant. Ciphertext is packed as
 *  base64(iv):base64(authTag):base64(data) so it's a single opaque string column. */
export class SecretCipher {
  constructor(private readonly keyBase64: string) {
    const key = Buffer.from(keyBase64, 'base64');
    if (key.length !== 32) {
      throw new Error('PUSH_CONFIG_ENCRYPTION_KEY must decode (base64) to exactly 32 bytes');
    }
  }

  private get key(): Buffer {
    return Buffer.from(this.keyBase64, 'base64');
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [iv.toString('base64'), authTag.toString('base64'), encrypted.toString('base64')].join(':');
  }

  decrypt(packed: string): string {
    const [ivB64, authTagB64, dataB64] = packed.split(':');
    if (!ivB64 || !authTagB64 || !dataB64) {
      throw new Error('Malformed ciphertext');
    }
    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
    return decrypted.toString('utf8');
  }
}
