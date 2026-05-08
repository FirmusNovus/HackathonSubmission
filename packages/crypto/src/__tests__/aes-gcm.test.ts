import { describe, it, expect } from 'vitest';
import { generateEcdhKeyPair, deriveSharedSecret } from '../ecdh';
import { encryptMessage, decryptMessage } from '../aes-gcm';

describe('AES-GCM', () => {
  it('round-trips plaintext through ECDH-derived AES-GCM', async () => {
    const alice = await generateEcdhKeyPair();
    const bob = await generateEcdhKeyPair();
    const aliceSecret = await deriveSharedSecret(alice.privateJwk, bob.publicJwk);
    const bobSecret = await deriveSharedSecret(bob.privateJwk, alice.publicJwk);

    const plaintext = new TextEncoder().encode('Tomorrow at 10? Bring the deeds.');
    const env = await encryptMessage(aliceSecret, plaintext);

    const decoded = await decryptMessage(bobSecret, env);
    expect(new TextDecoder().decode(decoded)).toBe('Tomorrow at 10? Bring the deeds.');
  });

  it('produces fresh IV/salt per message — same plaintext yields different ciphertext', async () => {
    const alice = await generateEcdhKeyPair();
    const bob = await generateEcdhKeyPair();
    const secret = await deriveSharedSecret(alice.privateJwk, bob.publicJwk);
    const pt = new TextEncoder().encode('hello');
    const env1 = await encryptMessage(secret, pt);
    const env2 = await encryptMessage(secret, pt);
    expect(env1.iv).not.toEqual(env2.iv);
    expect(env1.salt).not.toEqual(env2.salt);
    expect(env1.ciphertext).not.toEqual(env2.ciphertext);
  });

  it('decryption fails for tampered ciphertext', async () => {
    const alice = await generateEcdhKeyPair();
    const bob = await generateEcdhKeyPair();
    const secret = await deriveSharedSecret(alice.privateJwk, bob.publicJwk);
    const env = await encryptMessage(secret, new TextEncoder().encode('immutable'));
    env.ciphertext[0] ^= 0xff;
    await expect(decryptMessage(secret, env)).rejects.toThrow();
  });

  it('decryption fails with wrong shared secret', async () => {
    const alice = await generateEcdhKeyPair();
    const bob = await generateEcdhKeyPair();
    const carol = await generateEcdhKeyPair();
    const ab = await deriveSharedSecret(alice.privateJwk, bob.publicJwk);
    const ac = await deriveSharedSecret(alice.privateJwk, carol.publicJwk);
    const env = await encryptMessage(ab, new TextEncoder().encode('private'));
    await expect(decryptMessage(ac, env)).rejects.toThrow();
  });
});
