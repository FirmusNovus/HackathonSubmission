'use client';
// Owner spec: 001-verified-legal-engagement.
// Browser-only ECDH + AES-GCM. The platform never sees plaintext.

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ensureKeyPair, deriveSharedSecret, encryptMessage, decryptMessage } from '@/lib/crypto/client';

interface Props {
  engagementId: number;
  selfAddress: string;
  peerAddress: string;
  role: 'client' | 'lawyer';
}

interface DisplayedMessage {
  id: number;
  sender: string;
  text: string;
  createdAt: number;
}

interface ServerMessage {
  id: number;
  sender: string;
  ciphertextB64: string;
  ivB64: string;
  saltB64: string;
  signature: string;
  createdAt: number;
  transcriptLeafIndex: number;
}

function b64ToBytes(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, 'base64'));
}
function bytesToB64(b: Uint8Array): string {
  return Buffer.from(b).toString('base64');
}

export function ChatPanel({ engagementId, selfAddress, peerAddress, role }: Props) {
  const [ready, setReady] = useState(false);
  const [messages, setMessages] = useState<DisplayedMessage[]>([]);
  const [draft, setDraft] = useState('');
  const sharedRef = useRef<ArrayBuffer | null>(null);
  const lastIdRef = useRef<number>(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const kp = await ensureKeyPair(selfAddress, engagementId);
      // Register our public key + announce to server.
      await fetch('/api/messaging-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicJwk: kp.publicJwk, role }),
      });

      // Fetch peer's public key. Wait until peer publishes — poll on demand.
      let peerPublicJwk: Record<string, unknown> | null = null;
      for (let attempts = 0; attempts < 40; attempts++) {
        const r = await fetch(`/api/messaging-keys?engagementId=${engagementId}`);
        if (r.ok) {
          const j = (await r.json()) as {
            clientPublicJwk: Record<string, unknown> | null;
            lawyerPublicJwk: Record<string, unknown> | null;
            clientAddress: string;
            lawyerAddress: string;
          };
          const peerKey = j.lawyerAddress.toLowerCase() === peerAddress.toLowerCase() ? j.lawyerPublicJwk : j.clientPublicJwk;
          if (peerKey) {
            peerPublicJwk = peerKey;
            break;
          }
        }
        await new Promise((res) => setTimeout(res, 1000));
      }
      if (cancelled || !peerPublicJwk) return;
      sharedRef.current = await deriveSharedSecret(kp.privateJwk, peerPublicJwk as never);
      setReady(true);
      poll();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engagementId]);

  async function poll() {
    if (!sharedRef.current) return;
    try {
      const r = await fetch(`/api/messages?engagementId=${engagementId}&sinceId=${lastIdRef.current}`);
      if (r.ok) {
        const j = (await r.json()) as { messages: ServerMessage[] };
        for (const m of j.messages) {
          try {
            const text = await decryptMessage(sharedRef.current!, {
              ciphertext: b64ToBytes(m.ciphertextB64),
              iv: b64ToBytes(m.ivB64),
              salt: b64ToBytes(m.saltB64),
            });
            setMessages((prev) => [
              ...prev,
              { id: m.id, sender: m.sender, text: new TextDecoder().decode(text), createdAt: m.createdAt },
            ]);
          } catch {
            setMessages((prev) => [
              ...prev,
              { id: m.id, sender: m.sender, text: '[decrypt failed]', createdAt: m.createdAt },
            ]);
          }
          lastIdRef.current = Math.max(lastIdRef.current, m.id);
        }
      }
    } finally {
      setTimeout(poll, 5000);
    }
  }

  async function send() {
    if (!sharedRef.current || !draft.trim()) return;
    const env = await encryptMessage(sharedRef.current, new TextEncoder().encode(draft));
    const r = await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        engagementId,
        ciphertextB64: bytesToB64(env.ciphertext),
        ivB64: bytesToB64(env.iv),
        saltB64: bytesToB64(env.salt),
        signature: 'dev-stub',
      }),
    });
    if (r.ok) {
      setDraft('');
      poll();
    }
  }

  return (
    <div className="flex h-[28rem] flex-col">
      <div className="border-b border-navy-800 px-3 py-2 text-xs uppercase tracking-wide text-slate-300">
        Encrypted chat {ready ? '· ready' : '· initializing…'}
      </div>
      <ol className="flex-1 space-y-2 overflow-y-auto p-3 text-sm">
        {messages.length === 0 ? (
          <li className="text-xs text-slate-300">No messages yet — start with a hello.</li>
        ) : (
          messages.map((m) => (
            <li
              key={m.id}
              className={
                m.sender.toLowerCase() === selfAddress.toLowerCase()
                  ? 'ml-auto max-w-[85%] rounded-xl bg-teal-500 px-3 py-2 text-white-0'
                  : 'max-w-[85%] rounded-xl bg-navy-800 px-3 py-2 text-white-0'
              }
            >
              <div className="text-[10px] uppercase tracking-wide opacity-70">
                {m.sender.toLowerCase() === selfAddress.toLowerCase() ? 'You' : 'Counsel'}
              </div>
              <div className="mt-0.5 whitespace-pre-wrap">{m.text}</div>
            </li>
          ))
        )}
      </ol>
      <div className="flex items-center gap-2 border-t border-navy-800 p-2">
        <input
          className="h-9 flex-1 rounded-lg bg-navy-800 px-3 text-sm text-white-0 placeholder:text-slate-300 focus:outline-none"
          value={draft}
          placeholder={ready ? 'Type a message…' : 'Connecting…'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => (e.key === 'Enter' ? send() : null)}
          disabled={!ready}
        />
        <Button onClick={send} size="sm" disabled={!ready || !draft.trim()}>
          Send
        </Button>
      </div>
    </div>
  );
}
