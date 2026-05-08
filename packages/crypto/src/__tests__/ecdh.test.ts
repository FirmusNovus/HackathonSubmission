import { describe, it, expect } from 'vitest';
import { generateEcdhKeyPair, deriveSharedSecret } from '../ecdh';

describe('ECDH', () => {
  it('generates P-256 key pairs with extractable JWKs', async () => {
    const kp = await generateEcdhKeyPair();
    expect(kp.publicJwk.kty).toBe('EC');
    expect(kp.publicJwk.crv).toBe('P-256');
    expect(kp.privateJwk.d).toBeDefined();
    expect(kp.privateJwk.x).toBe(kp.publicJwk.x);
  });

  it('derives the same shared secret from both sides', async () => {
    const alice = await generateEcdhKeyPair();
    const bob = await generateEcdhKeyPair();
    const aliceSecret = await deriveSharedSecret(alice.privateJwk, bob.publicJwk);
    const bobSecret = await deriveSharedSecret(bob.privateJwk, alice.publicJwk);
    expect(new Uint8Array(aliceSecret)).toEqual(new Uint8Array(bobSecret));
  });

  it('produces different secrets for different counter-parties', async () => {
    const alice = await generateEcdhKeyPair();
    const bob = await generateEcdhKeyPair();
    const carol = await generateEcdhKeyPair();
    const ab = await deriveSharedSecret(alice.privateJwk, bob.publicJwk);
    const ac = await deriveSharedSecret(alice.privateJwk, carol.publicJwk);
    expect(new Uint8Array(ab)).not.toEqual(new Uint8Array(ac));
  });
});
