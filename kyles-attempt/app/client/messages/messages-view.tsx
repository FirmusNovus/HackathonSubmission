"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FileText, Send, Paperclip, X } from "lucide-react";
import { Role as RoleEnum } from "@prisma/client";
import { AvatarBubble } from "@/components/firmus/avatar-bubble";
import { EBSIBadge } from "@/components/firmus/ebsi-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";

interface Thread {
  id: string;
  counterpartyName: string;
  /** Wallet address of the other party — needed for the lawyer's "Send invoice" link. */
  counterpartyWalletAddress: string;
  subject: string;
  lastMessage: string;
  lastTime: string;
  counterpartyVerified: boolean;
}

interface ChatMessage {
  id: string;
  senderId: string;
  content: string;
  attachmentUrl: string | null;
  attachmentType: string | null;
  createdAt: string;
  sender: { id: string; name: string | null; role: RoleEnum };
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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [content, setContent] = useState("");
  const [attachment, setAttachment] = useState<{ url: string; name: string; type: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const active = threads.find((t) => t.id === activeId);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  async function refresh() {
    const res = await fetch(`/api/messages?conversationId=${activeId}`);
    if (!res.ok) return;
    const data = (await res.json()) as { messages: ChatMessage[] };
    setMessages(data.messages);
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));
  }

  async function send() {
    if (!content.trim() && !attachment) return;
    const body = JSON.stringify({
      conversationId: activeId,
      content: content.trim() || (attachment ? `📎 ${attachment.name}` : ""),
      attachmentUrl: attachment?.url,
      attachmentType: attachment?.type ?? undefined,
    });
    setContent("");
    setAttachment(null);
    setUploadError(null);
    await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    void refresh();
  }

  const [uploadError, setUploadError] = useState<string | null>(null);

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
                    <div className="text-[12px] text-slate-500">{t.subject}</div>
                    <div className="mt-1 truncate text-[13px] text-slate-700">{t.lastMessage || "No messages yet"}</div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      <section className="flex flex-col bg-white-50">
        {active && (
          <header className="flex items-center gap-3 border-b border-slate-100 bg-white-0 px-6 py-4">
            <AvatarBubble name={active.counterpartyName} size={40} verified={active.counterpartyVerified} />
            <div>
              <div className="flex items-center gap-2 text-[15px] font-semibold text-navy-900">
                {active.counterpartyName}
                {active.counterpartyVerified && <EBSIBadge variant="small" label="Verified" />}
              </div>
              <div className="text-[12px] text-slate-500">{active.subject}</div>
            </div>
          </header>
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
                  )}
                >
                  {m.content && <div>{m.content}</div>}
                  {m.attachmentUrl && <Attachment url={m.attachmentUrl} type={m.attachmentType ?? null} mine={me} />}
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
          {uploadError && (
            <p className="mb-2 text-[12px] text-red-500" role="alert">
              {uploadError}
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
                href={`/lawyer/invoices/new?client=${encodeURIComponent(active.counterpartyWalletAddress)}&from=${active.id}`}
                aria-label={`Send an invoice to ${active.counterpartyName}`}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-teal-50 px-3 text-[13px] font-medium text-teal-700 transition-colors hover:bg-teal-100"
              >
                <FileText className="h-3.5 w-3.5" aria-hidden /> Send invoice
              </Link>
            )}
            <Input value={content} onChange={(e) => setContent(e.target.value)} placeholder="Type a message…" />
            <Button size="md" type="submit" disabled={!content.trim() && !attachment}>
              <Send className="h-4 w-4" aria-hidden />
              <span className="sr-only">Send</span>
            </Button>
          </div>
        </form>
      </section>
    </div>
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
      download
      className={cn(
        "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px] font-medium",
        mine ? "border-white/30 bg-white/10 text-white hover:bg-white/20" : "border-slate-200 bg-slate-50 text-navy-900 hover:bg-slate-100",
      )}
    >
      <Paperclip className="h-3.5 w-3.5" aria-hidden />
      <span className="truncate">{filename}</span>
    </a>
  );
}
