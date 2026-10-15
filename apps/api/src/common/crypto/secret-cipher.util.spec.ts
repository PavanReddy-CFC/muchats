import { randomBytes } from 'crypto';
import { SecretCipher } from './secret-cipher.util';

describe('SecretCipher', () => {
  const key = randomBytes(32).toString('base64');

  it('round-trips plaintext through encrypt/decrypt', () => {
    const cipher = new SecretCipher(key);
    const plaintext = JSON.stringify({ project_id: 'demo-project', private_key: 'secret-value' });

    const encrypted = cipher.encrypt(plaintext);

    expect(encrypted).not.toContain('secret-value');
    expect(cipher.decrypt(encrypted)).toBe(plaintext);
  });

  it('produces a different ciphertext each time (random IV) for the same plaintext', () => {
    const cipher = new SecretCipher(key);
    const a = cipher.encrypt('same input');
    const b = cipher.encrypt('same input');

    expect(a).not.toBe(b);
    expect(cipher.decrypt(a)).toBe('same input');
    expect(cipher.decrypt(b)).toBe('same input');
  });

  it('rejects a key that is not exactly 32 bytes when base64-decoded', () => {
    expect(() => new SecretCipher(Buffer.from('too-short').toString('base64'))).toThrow(/32 bytes/);
  });

  it('fails to decrypt with the wrong key (authentication tag mismatch)', () => {
    const cipher = new SecretCipher(key);
    const otherCipher = new SecretCipher(randomBytes(32).toString('base64'));
    const encrypted = cipher.encrypt('sensitive');

    expect(() => otherCipher.decrypt(encrypted)).toThrow();
  });

  it('rejects malformed ciphertext', () => {
    const cipher = new SecretCipher(key);
    expect(() => cipher.decrypt('not-the-right-format')).toThrow(/Malformed/);
  });
});
