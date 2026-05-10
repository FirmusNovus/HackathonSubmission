"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import {
  MESSAGING_KEY_DERIVATION_MESSAGE,
  deriveMessagingKeypair,
  publicKeyToBase64,
  type MessagingKeypair,
} from "@/lib/crypto/messaging";

/**
 * Manages a per-wallet messaging keypair. First time we see a wallet, we
 * prompt them to sign MESSAGING_KEY_DERIVATION_MESSAGE; the signature
 * deterministically seeds an X25519 keypair, the public half is uploaded to
 * the server, and the private half is cached in localStorage so subsequent
 * loads don't have to re-prompt the wallet.
 *
 * Returns `enroll` (call when the user clicks "Enable secure messaging")
 * and `keypair` (null until enrolled). Components that need to encrypt
 * outgoing messages or decrypt incoming ones consume `keypair`.
 */
const STORAGE_KEY_PREFIX = "firmus.messaging.key.";

interface StoredKey {
  publicKeyB64: string;
  secretKeyB64: string;
}

export function useMessagingKeys(): {
  keypair: MessagingKeypair | null;
  publicKeyB64: string | null;
  enrolling: boolean;
  error: string | null;
  enroll: () => Promise<void>;
} {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [keypair, setKeypair] = useState<MessagingKeypair | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reload the cached keypair whenever the connected wallet changes.
  useEffect(() => {
    if (!address) {
      setKeypair(null);
      return;
    }
    const raw = window.localStorage.getItem(STORAGE_KEY_PREFIX + address.toLowerCase());
    if (!raw) {
      setKeypair(null);
      return;
    }
    try {
      const parsed = JSON.parse(raw) as StoredKey;
      setKeypair({
        publicKey: base64ToBytes(parsed.publicKeyB64),
        secretKey: base64ToBytes(parsed.secretKeyB64),
      });
    } catch {
      setKeypair(null);
    }
  }, [address]);

  // Track the last-enrolled wallet so we don't post the pubkey to the server
  // on every render.
  const lastUploaded = useRef<string | null>(null);
  useEffect(() => {
    if (!address || !keypair) return;
    const pubB64 = publicKeyToBase64(keypair.publicKey);
    const cacheKey = `${address.toLowerCase()}:${pubB64}`;
    if (lastUploaded.current === cacheKey) return;
    void fetch("/api/users/me/encryption-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ encryptionPublicKey: pubB64 }),
    })
      .then(() => {
        lastUploaded.current = cacheKey;
      })
      .catch(() => {
        // If upload fails, we'll retry on next render.
      });
  }, [address, keypair]);

  const enroll = useCallback(async () => {
    if (!address) {
      setError("Connect your wallet to enable secure messaging.");
      return;
    }
    setEnrolling(true);
    setError(null);
    try {
      const sig = await signMessageAsync({ message: MESSAGING_KEY_DERIVATION_MESSAGE });
      const kp = await deriveMessagingKeypair(sig);
      const stored: StoredKey = {
        publicKeyB64: publicKeyToBase64(kp.publicKey),
        secretKeyB64: publicKeyToBase64(kp.secretKey),
      };
      window.localStorage.setItem(STORAGE_KEY_PREFIX + address.toLowerCase(), JSON.stringify(stored));
      setKeypair(kp);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEnrolling(false);
    }
  }, [address, signMessageAsync]);

  return {
    keypair,
    publicKeyB64: keypair ? publicKeyToBase64(keypair.publicKey) : null,
    enrolling,
    error,
    enroll,
  };
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
