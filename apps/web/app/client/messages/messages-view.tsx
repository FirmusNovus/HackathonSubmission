"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { FileText, Lock, Send, Paperclip, ShieldOff, X } from "lucide-react";
import { Role as RoleEnum } from "@/lib/db/enums";
import { AvatarBubble } from "@/components/firmus/avatar-bubble";
import { EBSIBadge } from "@/components/firmus/ebsi-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";
import { useMessagingKeys } from "@/lib/hooks/use-messaging-keys";
import { decryptMessage, encryptMessage, publicKeyFromBase64 } from "@/lib/crypto/messaging";

interface Thread {
  id: string;
  /** User id of the other participant, used to fetch their encryption pubkey. */
  counterpartyUserId: string;
  counterpartyName: string;
  /** Wallet address of the other party — needed for the lawyer's "Send order" link. */
  counterpartyWalletAddress: string;
  /** Their X25519 pubkey so the sidebar can decrypt previews of messages WE sent. */
  counterpartyEncryptionPublicKey: string | null;
  subject: string;
  /** Engagement chain id — shown as a chip in the sidebar so the user can tell
   *  multiple cases with the same counterparty apart. Null when the booking
   *  hasn't been funded on chain yet (no Engagement row). */
  engagementChainId: number | null;
  /** First line of the case description, used to add an instant "what is this
   *  case about" hint below the practice area. */
  caseSummary: string | null;
  /**
   * Last message metadata; null if the conversation has no messages yet.
   * The sidebar decrypts these client-side using the user's keypair.
   */
  lastMessage: {
    senderId: string;
    content: string | null;
    ciphertext: string | null;
    nonce: string | null;
    senderEncryptionPublicKey: string | null;
  } | null;
  lastTime: string;
  counterpartyVerified: boolean;
}

/**
 * Server-shape — what /api/messages returns. We normalise to a richer
 * client-side shape (`DisplayMessage`) below by decrypting any encrypted
 * rows and falling back to legacy plaintext for older seeded data.
 */
interface ServerMessage {
  id: string;
  senderId: string;
  content: string | null;
  ciphertext: string | null;
  nonce: string | null;
  senderEncryptionPublicKey: string | null;
  attachmentUrl: string | null;
  attachmentType: string | null;
  createdAt: string;
  sender: { id: string; name: string | null; role: RoleEnum };
}

type DecryptStatus = "plain" | "decrypted" | "decrypt-failed" | "encrypted-no-key";

interface DisplayMessage extends ServerMessage {
  display: string;
  status: DecryptStatus;
}

interface MessagesViewProps {
  currentUserId: string;
  currentUserRole: RoleEnum;
  threads: Thread[];
  initialActiveId: string;
}

export function MessagesView({
  currentUserId,
  currentUserRole,
  threads,
  initialActiveId,
}: MessagesViewProps) {
  const [activeId, setActiveId] = useState(initialActiveId);
  const [serverMessages, setServerMessages] = useState<ServerMessage[]>([]);
  const [content, setContent] = useState("");
  const [attachment, setAttachment] = useState<{ url: string; name: string; type: string } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [counterpartyPubB64, setCounterpartyPubB64] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const active = threads.find((t) => t.id === activeId);

  const { keypair, publicKeyB64, enrolling, error: enrollError, enroll } = useMessagingKeys();

  // Sidebar previews: decrypt each thread's last message client-side. The
  // server can't show plaintext (no privkey), so it ships the ciphertext +
  // both pubkeys we need (sender's, plus counterparty's for self-sent rows)
  // and we recover the preview here. Falls back to legacy `content` for
  // pre-Phase-10 plaintext rows.
  const threadPreviews: Record<string, string> = useMemo(() => {
    const out: Record<string, string> = {};
    for (const t of threads) {
      const last = t.lastMessage;
      if (!last) {
        out[t.id] = "";
        continue;
      }
      if (last.content && !last.ciphertext) {
        out[t.id] = last.content;
        continue;
      }
      if (!last.ciphertext || !last.nonce || !last.senderEncryptionPublicKey) {
        out[t.id] = "";
        continue;
      }
      if (!keypair) {
        out[t.id] = "🔒 Sign in to messaging to read";
        continue;
      }
      const otherPubB64 =
        last.senderId === currentUserId
          ? t.counterpartyEncryptionPublicKey
          : last.senderEncryptionPublicKey;
      if (!otherPubB64) {
        out[t.id] = "🔒 Encrypted";
        continue;
      }
      const plain = decryptMessage(
        last.ciphertext,
        last.nonce,
        publicKeyFromBase64(otherPubB64),
        keypair.secretKey,
      );
      out[t.id] = plain ?? "🔒 Could not decrypt";
    }
    return out;
  }, [threads, keypair, currentUserId]);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // When the active thread changes, fetch the counterparty's pubkey so we
  // can encrypt outgoing messages to them. We poll occasionally in case
  // they enroll while we're sitting on the page.
  useEffect(() => {
    if (!active?.counterpartyUserId) {
      setCounterpartyPubB64(null);
      return;
    }
    let cancelled = false;
    const fetchKey = async () => {
      try {
        const res = await fetch(`/api/users/${active.counterpartyUserId}/encryption-key`);
        if (!res.ok) return;
        const data = (await res.json()) as { encryptionPublicKey: string | null };
        if (!cancelled) setCounterpartyPubB64(data.encryptionPublicKey);
      } catch {
        // best-effort
      }
    };
    void fetchKey();
    const t = setInterval(fetchKey, 10_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [active?.counterpartyUserId]);

  async function refresh() {
    const res = await fetch(`/api/messages?conversationId=${activeId}`);
    if (!res.ok) return;
    const data = (await res.json()) as { messages: ServerMessage[] };
    setServerMessages(data.messages);
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));
  }

  // Decrypt all server messages once we have a keypair. Pure derivation;
  // re-runs whenever messages, my keypair, or the counterparty's pubkey
  // changes.
  //
  // Decrypt-key selection: NaCl box's ECDH is symmetric, so the shared
  // secret is the same whether we compute it as (myPub, theirPriv) or
  // (theirPub, myPriv). To open ANY message in this conversation, the
  // viewer uses the OTHER party's pubkey + their own privkey:
  //   - If I sent it: other = counterparty (we already fetched their pub
  //     for sending).
  //   - If they sent it: other = sender (stored on the message row as
  //     `senderEncryptionPublicKey`).
  // This is what fixes "I can't read my own outgoing messages" — the
  // sender has to use the recipient's pubkey, not their own.
  const messages: DisplayMessage[] = useMemo(() => {
    return serverMessages.map((m) => {
      // Modern ciphertext path.
      if (m.ciphertext && m.nonce && m.senderEncryptionPublicKey) {
        if (!keypair) {
          return { ...m, display: "🔒 Encrypted message — enable secure messaging to read.", status: "encrypted-no-key" };
        }
        const otherPubB64 =
          m.senderId === currentUserId ? counterpartyPubB64 : m.senderEncryptionPublicKey;
        if (!otherPubB64) {
          return {
            ...m,
            display: "🔒 Waiting for the counterparty's key to decrypt this message.",
            status: "encrypted-no-key",
          };
        }
        const plain = decryptMessage(
          m.ciphertext,
          m.nonce,
          publicKeyFromBase64(otherPubB64),
          keypair.secretKey,
        );
        if (plain == null) {
          return { ...m, display: "⚠ Could not decrypt this message.", status: "decrypt-failed" };
        }
        return { ...m, display: plain, status: "decrypted" };
      }
      // Legacy plaintext path — old seeded rows or pre-Phase-10 messages.
      return { ...m, display: m.content ?? "", status: "plain" };
    });
  }, [serverMessages, keypair, counterpartyPubB64, currentUserId]);

  async function send() {
    if (!content.trim() && !attachment) return;
    setSendError(null);
    if (!keypair) {
      setSendError("Enable secure messaging first (sign with your wallet to derive a key).");
      return;
    }
    if (!counterpartyPubB64) {
      setSendError("The other party hasn't enabled secure messaging yet — they need to enroll their key.");
      return;
    }
    const plaintext = content.trim() || (attachment ? `📎 ${attachment.name}` : "");
    const { ciphertextB64, nonceB64 } = encryptMessage(
      plaintext,
      publicKeyFromBase64(counterpartyPubB64),
      keypair.secretKey,
    );
    const body = JSON.stringify({
      conversationId: activeId,
      ciphertext: ciphertextB64,
      nonce: nonceB64,
      senderEncryptionPublicKey: publicKeyB64,
      attachmentUrl: attachment?.url,
      attachmentType: attachment?.type ?? undefined,
    });
    setContent("");
    setAttachment(null);
    setUploadError(null);
    const res = await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setSendError(err.error ?? `Send failed (${res.status})`);
      return;
    }
    void refresh();
  }

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setUploadError(null);
    const fd = new FormData();
    fd.set("file", f);
    fd.set("purpose", "messages");
    const res = await fetch("/api/uploads", { method: "POST", body: fd });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setUploadError(err.error ?? `Upload failed (${res.status})`);
      return;
    }
    const data = (await res.json()) as { url: string };
    setAttachment({ url: data.url, name: f.name, type: f.type });
  }

  return (
    <div className="mx-auto grid h-[calc(100vh-65px)] max-w-[1280px] grid-cols-1 lg:grid-cols-[320px_1fr]">
      <aside className="overflow-y-auto border-r border-slate-100 bg-white-0">
        <div className="border-b border-slate-100 px-5 py-4">
          <h1 className="font-display text-xl text-navy-900">Messages</h1>
        </div>
        <ul>
          {threads.map((t) => {
            const isActive = t.id === activeId;
            return (
              <li key={t.id}>
                <button
                  onClick={() => setActiveId(t.id)}
                  className={cn(
                    "flex w-full items-start gap-3 border-b border-slate-100 px-5 py-4 text-left transition-colors",
                    isActive ? "bg-teal-50" : "hover:bg-white-50",
                  )}
                >
                  <AvatarBubble name={t.counterpartyName} size={40} verified={t.counterpartyVerified} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <span className="truncate text-[14px] font-semibold text-navy-900">{t.counterpartyName}</span>
                      <span className="ml-2 shrink-0 text-[11px] text-slate-500">
                        {new Date(t.lastTime).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[12px] text-slate-500">
                      <span>{t.subject}</span>
                      {t.engagementChainId !== null && (
                        <span className="rounded bg-slate-100 px-1.5 py-px font-mono text-[10px] text-slate-600">
                          #{t.engagementChainId}
                        </span>
                      )}
                    </div>
                    {t.caseSummary && (
                      <div className="mt-0.5 truncate text-[12px] italic text-slate-400">
                        {t.caseSummary}
                      </div>
                    )}
                    <div className="mt-1 truncate text-[13px] text-slate-700">
                      {threadPreviews[t.id] || "No messages yet"}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      <section className="flex flex-col bg-white-50">
        {active && (
          <header className="flex items-center justify-between border-b border-slate-100 bg-white-0 px-6 py-4">
            <div className="flex items-center gap-3">
              <AvatarBubble name={active.counterpartyName} size={40} verified={active.counterpartyVerified} />
              <div>
                <div className="flex items-center gap-2 text-[15px] font-semibold text-navy-900">
                  {active.counterpartyName}
                  {active.counterpartyVerified && <EBSIBadge variant="small" label="Verified" />}
                </div>
                <div className="text-[12px] text-slate-500">{active.subject}</div>
              </div>
            </div>
            <SecurityBadge keypairReady={!!keypair} counterpartyEnrolled={!!counterpartyPubB64} />
          </header>
        )}

        {!keypair && (
          <div className="m-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <ShieldOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden />
            <div className="flex-1">
              <p className="text-[13px] font-medium text-navy-900">Enable secure messaging</p>
              <p className="mt-1 text-[12px] text-slate-700">
                Messages here are end-to-end encrypted. Sign once with your wallet to derive your encryption
                key — only you and {active?.counterpartyName ?? "your counterparty"} will be able to read what's said.
              </p>
              {enrollError && <p className="mt-2 text-[12px] text-red-500">{enrollError}</p>}
              <Button onClick={() => void enroll()} disabled={enrolling} size="sm" className="mt-3">
                <Lock className="h-3.5 w-3.5" aria-hidden />{" "}
                {enrolling ? "Confirm in wallet…" : "Sign to enable encryption"}
              </Button>
            </div>
          </div>
        )}

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-6 py-6">
          {messages.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-200 bg-white-0 p-10 text-center text-[14px] text-slate-500">
              No messages yet — start the conversation.
            </div>
          )}
          {messages.map((m) => {
            const me = m.senderId === currentUserId;
            return (
              <div key={m.id} className={cn("flex gap-2.5", me ? "flex-row-reverse" : "flex-row")}>
                <AvatarBubble name={m.sender.name ?? "?"} size={32} verified={m.sender.role === "LAWYER"} />
                <div
                  className={cn(
                    "max-w-[70%] space-y-2 rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed shadow-[var(--shadow-sm)]",
                    me ? "rounded-br-md bg-teal-500 text-white" : "rounded-bl-md bg-white-0 text-navy-900",
                    m.status === "encrypted-no-key" || m.status === "decrypt-failed" ? "italic opacity-80" : "",
                  )}
                >
                  {m.display && <div>{m.display}</div>}
                  {m.attachmentUrl && <Attachment url={m.attachmentUrl} type={m.attachmentType ?? null} mine={me} />}
                  {m.status === "plain" && (
                    <span className={cn("mt-1 block text-[10px] uppercase tracking-[0.08em]", me ? "text-white/70" : "text-slate-400")}>
                      legacy · plaintext
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          className="border-t border-slate-100 bg-white-0 px-4 py-3"
        >
          {(uploadError || sendError) && (
            <p className="mb-2 text-[12px] text-red-500" role="alert">
              {uploadError ?? sendError}
            </p>
          )}
          {!counterpartyPubB64 && active && keypair && (
            <p className="mb-2 text-[12px] text-amber-700">
              {active.counterpartyName} hasn't enabled secure messaging yet. They'll see a prompt next time
              they open this thread.
            </p>
          )}
          {attachment && (
            <div className="mb-2 flex items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-1.5 text-[12px] text-slate-700">
              <span className="truncate">📎 {attachment.name}</span>
              <button
                type="button"
                onClick={() => setAttachment(null)}
                aria-label="Remove attachment"
                className="rounded p-0.5 hover:bg-slate-200"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <input ref={fileInputRef} type="file" className="hidden" onChange={onFilePicked} aria-hidden />
            <button
              type="button"
              aria-label="Attach file"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-md p-2 text-slate-500 hover:bg-slate-50 hover:text-navy-900"
            >
              <Paperclip className="h-4 w-4" aria-hidden />
            </button>
            {currentUserRole === RoleEnum.LAWYER && active && (
              <Link
                href="/lawyer/orders/new"
                aria-label={`Send a follow-up order to ${active.counterpartyName}`}
                className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-teal-50 px-3 text-[13px] font-medium text-teal-700 transition-colors hover:bg-teal-100"
              >
                <FileText className="h-3.5 w-3.5" aria-hidden /> Send order
              </Link>
            )}
            <Input value={content} onChange={(e) => setContent(e.target.value)} placeholder="Type a message…" />
            <Button
              size="md"
              type="submit"
              disabled={(!content.trim() && !attachment) || !keypair || !counterpartyPubB64}
            >
              <Send className="h-4 w-4" aria-hidden />
              <span className="sr-only">Send</span>
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}

function SecurityBadge({
  keypairReady,
  counterpartyEnrolled,
}: {
  keypairReady: boolean;
  counterpartyEnrolled: boolean;
}) {
  if (keypairReady && counterpartyEnrolled) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 px-2.5 py-1 text-[11px] font-medium text-teal-700">
        <Lock className="h-3 w-3" aria-hidden /> End-to-end encrypted
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
      <ShieldOff className="h-3 w-3" aria-hidden /> Encryption pending
    </span>
  );
}

function Attachment({ url, type, mine }: { url: string; type: string | null; mine: boolean }) {
  const isImage = type?.startsWith("image/");
  const filename = decodeURIComponent(url.split("/").pop() ?? "attachment").replace(/^\d+-/, "");
  if (isImage) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-lg">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={filename} className="max-h-64 w-full max-w-xs rounded-lg object-cover" />
      </a>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] underline",
        mine ? "bg-white/10 text-white" : "bg-slate-50 text-navy-900",
      )}
    >
      <Paperclip className="h-3.5 w-3.5" aria-hidden /> {filename}
    </a>
  );
}
