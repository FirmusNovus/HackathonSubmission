"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Check } from "lucide-react";
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
import { Button } from "@/components/ui/button";
import { useMessagingKeys } from "@/lib/hooks/use-messaging-keys";
import {
  decryptMessage,
  publicKeyFromBase64,
} from "@/lib/crypto/messaging";

/**
 * Submit the caller's encrypted archive of the conversation to the
 * arbiter. Both parties can submit independently — the arbiter sees both,
 * and discrepancies between them are evidence in themselves.
 *
 * Flow:
 *   1. Pull the user's messaging keypair (already enrolled — used for the
 *      regular E2E messaging UI).
 *   2. GET /api/admin/arbiter-pubkey to find out who to encrypt to.
 *   3. GET /api/users/[counterparty]/encryption-key — needed to decrypt
 *      messages the user themselves sent (NaCl box's ECDH is symmetric:
 *      to recover plaintext from a self-sent message, the user pairs the
 *      RECIPIENT's pubkey with their own privkey).
 *   4. GET /api/messages?conversationId=… for the full transcript.
 *   5. For each message, decrypt with the right (otherPub, ownPriv) combo,
 *      then re-encrypt the plaintext to the arbiter's pubkey using the
 *      user's privkey + arbiter's pubkey. (Server stores the resulting
 *      box ciphertext + nonce + the user's pubkey-at-submit-time so the
 *      arbiter can decrypt with their privkey + that pubkey.)
 *   6. POST the bundle to /api/{bookings,orders}/[id]/dispute/archive.
 */

interface DisputeArchiveButtonProps {
  kind: "booking" | "order";
  id: string;
  conversationId: string;
  counterpartyUserId: string;
  /** Once set, skip the prompt and show "Submitted ✓" instead. */
  alreadySubmitted: boolean;
}

export function DisputeArchiveButton({
  kind,
  id,
  conversationId,
  counterpartyUserId,
  alreadySubmitted,
}: DisputeArchiveButtonProps) {
  const router = useRouter();
  const { keypair, publicKeyB64 } = useMessagingKeys();
  const [step, setStep] = useState<"idle" | "running">("idle");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(alreadySubmitted);

  const submit = async () => {
    setError(null);
    if (!keypair || !publicKeyB64) {
      setError("Enable secure messaging first — your privkey is needed to decrypt the conversation.");
      return;
    }
    setStep("running");
    try {
      const [arbiterRes, counterpartyRes, messagesRes] = await Promise.all([
        fetch("/api/admin/arbiter-pubkey"),
        fetch(`/api/users/${counterpartyUserId}/encryption-key`),
        fetch(`/api/messages?conversationId=${conversationId}`),
      ]);
      if (!arbiterRes.ok) {
        const body = await arbiterRes.json().catch(() => ({}));
        throw new Error(body?.error ?? `Arbiter pubkey unavailable (${arbiterRes.status})`);
      }
      const { encryptionPublicKey: arbiterPubB64 } = (await arbiterRes.json()) as {
        encryptionPublicKey: string;
      };
      const counterpartyData = counterpartyRes.ok
        ? ((await counterpartyRes.json()) as { encryptionPublicKey: string | null })
        : { encryptionPublicKey: null };
      if (!messagesRes.ok) throw new Error(`Messages fetch failed (${messagesRes.status})`);
      const { messages } = (await messagesRes.json()) as {
        messages: Array<{
          id: string;
          senderId: string;
          ciphertext: string | null;
          nonce: string | null;
          senderEncryptionPublicKey: string | null;
          content: string | null;
          createdAt: string;
        }>;
      };

      const arbiterPub = publicKeyFromBase64(arbiterPubB64);
      // We identify "I'm the sender" by comparing each message's
      // senderEncryptionPublicKey to our own publicKeyB64 — the User id isn't
      // in scope here, but pubkey equality is sufficient.

      const bundle: Array<{
        originalMessageId: string;
        ciphertextForArbiter: string;
        nonce: string;
        originalSenderId: string;
        originalSenderEncryptionPublicKey: string | null;
        originalCreatedAt: string;
      }> = [];

      for (const m of messages) {
        // Recover plaintext.
        let plain: string | null = null;
        if (m.ciphertext && m.nonce && m.senderEncryptionPublicKey) {
          // Encrypted message. Pick the right "other party's pubkey".
          const otherPubB64 =
            m.senderEncryptionPublicKey === publicKeyB64
              ? counterpartyData.encryptionPublicKey
              : m.senderEncryptionPublicKey;
          if (!otherPubB64) {
            // We can't decrypt this one — skip rather than fail the whole
            // archive. This typically means the counterparty rotated their
            // key, which doesn't happen in the current model but is
            // defended against here.
            continue;
          }
          plain = decryptMessage(m.ciphertext, m.nonce, publicKeyFromBase64(otherPubB64), keypair.secretKey);
          if (plain == null) continue;
        } else if (m.content) {
          // Legacy plaintext (pre-Phase-10 demo seed rows). Pass through as-is.
          plain = m.content;
        }
        if (plain == null) continue;

        // Re-encrypt to the arbiter.
        const plainBytes = naclUtil.decodeUTF8(plain);
        const nonce = nacl.randomBytes(nacl.box.nonceLength);
        const ct = nacl.box(plainBytes, nonce, arbiterPub, keypair.secretKey);
        bundle.push({
          originalMessageId: m.id,
          ciphertextForArbiter: naclUtil.encodeBase64(ct),
          nonce: naclUtil.encodeBase64(nonce),
          originalSenderId: m.senderId,
          originalSenderEncryptionPublicKey: m.senderEncryptionPublicKey,
          originalCreatedAt: m.createdAt,
        });
      }

      const submitRes = await fetch(
        `/api/${kind === "booking" ? "bookings" : "orders"}/${id}/dispute/archive`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            submitterEncryptionPublicKey: publicKeyB64,
            encryptedBundle: bundle,
          }),
        },
      );
      if (!submitRes.ok) {
        const body = await submitRes.json().catch(() => ({}));
        throw new Error(body?.error ?? `Submit failed (${submitRes.status})`);
      }
      setDone(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStep("idle");
    }
  };

  if (done) {
    return (
      <p className="inline-flex items-center gap-1.5 text-[12px] font-medium text-teal-700">
        <Check className="h-3.5 w-3.5" aria-hidden /> Archive submitted to the arbiter.
      </p>
    );
  }

  return (
    <div>
      <Button onClick={() => void submit()} disabled={step === "running" || !keypair} variant="primary" size="sm">
        <Archive className="h-3.5 w-3.5" aria-hidden />{" "}
        {step === "running" ? "Encrypting + submitting…" : "Submit my archive to the arbiter"}
      </Button>
      {!keypair && (
        <p className="mt-2 text-[11px] text-amber-700">
          You need to enable secure messaging first — your privkey is required to decrypt the chat.
        </p>
      )}
      {error && <p className="mt-2 text-[12px] text-red-500">{error}</p>}
    </div>
  );
}
