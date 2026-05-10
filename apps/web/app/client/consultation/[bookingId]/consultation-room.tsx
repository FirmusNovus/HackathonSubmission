"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Mic, MicOff, PhoneOff, Send, Video, VideoOff, ScreenShare, Lock } from "lucide-react";
import { FirmusLogo } from "@/components/firmus/firmus-logo";
import { AvatarBubble } from "@/components/firmus/avatar-bubble";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Role } from "@/lib/db/enums";
import { cn } from "@/lib/utils/cn";

interface ConsultationRoomProps {
  role: "client" | "lawyer";
  currentUser: { id: string; name: string; role: Role };
  lawyerName: string;
  booking: { id: string; practiceArea: string; scheduledAt: string; durationMinutes: number };
  conversationId: string | null;
}

interface ChatMessage {
  id: string;
  senderId: string;
  content: string;
  attachmentUrl: string | null;
  attachmentType: string | null;
  createdAt: string;
  sender: { id: string; name: string | null; role: Role };
}

export function ConsultationRoom({ role, currentUser, lawyerName, booking, conversationId }: ConsultationRoomProps) {
  const router = useRouter();
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [content, setContent] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!conversationId) return;
    void refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  async function refresh() {
    if (!conversationId) return;
    const res = await fetch(`/api/messages?conversationId=${conversationId}`);
    if (!res.ok) return;
    const data = (await res.json()) as { messages: ChatMessage[] };
    setMessages(data.messages);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    });
  }

  async function send() {
    if (!conversationId || !content.trim()) return;
    const body = JSON.stringify({ conversationId, content });
    setContent("");
    await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    void refresh();
  }

  async function complete() {
    setCompleting(true);
    await fetch(`/api/bookings/${booking.id}/complete`, { method: "POST" });
    router.push(role === "lawyer" ? "/lawyer/dashboard" : "/client/home");
  }

  return (
    <div className="flex min-h-screen flex-col bg-navy-950 text-white">
      <header className="flex items-center justify-between border-b border-white/10 px-6 py-4">
        <FirmusLogo light size={18} />
        <div className="hidden items-center gap-2 text-[12px] text-white/60 sm:flex">
          <span className="h-2 w-2 animate-pulse rounded-full bg-green-400" aria-hidden />
          Encrypted session · {booking.practiceArea}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="text-white hover:bg-white/5" onClick={complete} disabled={completing}>
            {completing ? "Completing…" : "Mark Complete"}
          </Button>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-1 lg:grid-cols-[1fr_360px]">
        <section className="relative flex flex-col">
          <div className="grid flex-1 grid-cols-1 gap-3 p-4 sm:grid-cols-2">
            <VideoTile name={role === "client" ? lawyerName : currentUser.name} primary />
            <VideoTile name={role === "client" ? currentUser.name : lawyerName} cameraOff={cameraOff} />
          </div>
          <div className="flex items-center justify-center gap-3 border-t border-white/10 bg-navy-950/80 p-4">
            <ControlButton onClick={() => setMuted((m) => !m)} active={muted} icon={muted ? MicOff : Mic} label={muted ? "Unmute" : "Mute"} />
            <ControlButton onClick={() => setCameraOff((c) => !c)} active={cameraOff} icon={cameraOff ? VideoOff : Video} label={cameraOff ? "Turn camera on" : "Turn camera off"} />
            <ControlButton icon={ScreenShare} label="Share screen" />
            <ControlButton onClick={complete} icon={PhoneOff} label="Leave & complete" danger />
          </div>
        </section>

        <aside className="flex max-h-[calc(100vh-65px)] flex-col border-l border-white/10 bg-navy-950">
          <div className="border-b border-white/10 p-4">
            <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-white/60">Case</div>
            <div className="mt-1 font-display text-lg">{lawyerName}</div>
            <div className="mt-1 flex items-center gap-2 text-[12px] text-white/60">
              <Lock className="h-3 w-3 text-teal-300" aria-hidden /> Funds in escrow · {booking.durationMinutes} min
            </div>
          </div>
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.length === 0 && <p className="text-[13px] text-white/50">No messages yet.</p>}
            {messages.map((m) => {
              const me = m.senderId === currentUser.id;
              return (
                <div key={m.id} className={cn("flex gap-2", me ? "flex-row-reverse" : "flex-row")}>
                  <AvatarBubble name={m.sender.name ?? "?"} size={28} />
                  <div className={cn("max-w-[80%] space-y-1.5 rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed", me ? "bg-teal-500 text-white" : "bg-white/5 text-white/90")}>
                    {m.content && <div>{m.content}</div>}
                    {m.attachmentUrl && (
                      <a
                        href={m.attachmentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        download
                        className="inline-flex items-center gap-1.5 rounded border border-white/30 bg-white/10 px-2 py-1 text-[11px] hover:bg-white/20"
                      >
                        📎 {decodeURIComponent(m.attachmentUrl.split("/").pop() ?? "file").replace(/^\d+-/, "")}
                      </a>
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
            className="flex items-center gap-2 border-t border-white/10 p-3"
          >
            <Input
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Type a message…"
              className="border-white/10 bg-white/5 text-white placeholder:text-white/40 focus:border-teal-500 focus:ring-teal-500/20"
            />
            <Button size="md" disabled={!content.trim() || !conversationId} type="submit" aria-label="Send">
              <Send className="h-4 w-4" aria-hidden />
            </Button>
          </form>
        </aside>
      </div>
    </div>
  );
}

function VideoTile({ name, primary, cameraOff }: { name: string; primary?: boolean; cameraOff?: boolean }) {
  return (
    <div
      className={cn(
        "relative flex items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-navy-800 to-navy-950",
        primary ? "min-h-[320px] sm:row-span-2 sm:min-h-[480px]" : "min-h-[180px]",
      )}
    >
      {cameraOff ? (
        <AvatarBubble name={name} size={primary ? 96 : 56} />
      ) : (
        <div className="flex flex-col items-center gap-3">
          <AvatarBubble name={name} size={primary ? 96 : 56} />
          <span className="text-[12px] text-white/50">Video stream — placeholder</span>
        </div>
      )}
      <span className="absolute bottom-3 left-3 rounded-full bg-black/40 px-2.5 py-1 text-[11px] font-medium tracking-wide">
        {name}
      </span>
    </div>
  );
}

function ControlButton({
  icon: Icon,
  label,
  onClick,
  active,
  danger,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "flex h-12 w-12 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500",
        danger ? "bg-red-500 text-white hover:bg-red-500/80" : active ? "bg-teal-500 text-white hover:bg-teal-600" : "bg-white/5 text-white hover:bg-white/10",
      )}
    >
      <Icon className="h-5 w-5" />
    </button>
  );
}
