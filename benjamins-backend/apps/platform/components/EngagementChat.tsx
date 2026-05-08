"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  ensureKeypairPublished,
  loadMessages,
  sendMessage,
  type DecryptedMessage,
} from "@/lib/messaging/transport";

interface Props {
  requestId: number;
  /** Whether messaging should be enabled — only true once the engagement is on chain. */
  isActive: boolean;
}

export function EngagementChat({ requestId, isActive }: Props) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [messages, setMessages] = useState<DecryptedMessage[]>([]);
  const [keyStatus, setKeyStatus] = useState<"idle" | "publishing" | "ready" | "error">("idle");
  const [keyError, setKeyError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Defense-in-depth: clear locally-rendered plaintext when the wallet
  // identity changes (or the engagement target changes). Prevents a
  // wallet-swap from briefly displaying the previous wallet's decrypted
  // messages while the new identity's data is still being fetched.
  useEffect(() => {
    setMessages([]);
    setLoadError(null);
  }, [address, requestId]);

  // Publish our messaging pubkey on mount (and whenever the wallet changes).
  // Idempotent on the server — ON CONFLICT DO UPDATE — so re-publishing is
  // free and self-healing if a previous attempt was lost.
  useEffect(() => {
    if (!isActive || !isConnected || !address) {
      setKeyStatus("idle");
      return;
    }
    let cancelled = false;
    (async () => {
      setKeyStatus("publishing");
      setKeyError(null);
      try {
        await ensureKeypairPublished(requestId);
        if (!cancelled) setKeyStatus("ready");
      } catch (e) {
        if (cancelled) return;
        setKeyStatus("error");
        setKeyError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [requestId, isActive, isConnected, address]);

  const refresh = useCallback(async () => {
    if (!address) return;
    try {
      const next = await loadMessages(address, requestId);
      setMessages(next);
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [address, requestId]);

  // SSE-driven refresh: open a stream once and refetch when the server
  // pushes a `message` event for this engagement. Replaces the previous
  // 4-second polling loop. EventSource auto-reconnects on transient
  // network drops.
  useEffect(() => {
    if (!isActive || keyStatus !== "ready") return;
    void refresh(); // initial sync
    const es = new EventSource(`/api/engagements/${requestId}/events/stream`);
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data) as { kind?: string };
        if (ev.kind === "message") void refresh();
      } catch {
        // ignore malformed event line
      }
    };
    es.onerror = () => {
      // Browser will auto-reconnect; we just stop noisy logs. If the
      // server is dead the connection stays in CONNECTING and the user
      // sees stale state — that's fine for the demo.
    };
    return () => es.close();
  }, [isActive, keyStatus, refresh, requestId]);

  // Auto-scroll on new message.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  async function send() {
    if (!address || !draft.trim()) return;
    setSending(true);
    try {
      await sendMessage(
        {
          signMessage: ({ message }) => signMessageAsync({ message }),
          myAddress: address,
        },
        requestId,
        draft.trim()
      );
      setDraft("");
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  if (!isActive) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Messaging</CardTitle>
          <CardDescription>
            Encrypted chat unlocks once the engagement is opened on chain.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // FR-026: explicit "Connect your wallet to view" state. Without a wallet,
  // we can't decrypt anything because the per-engagement private key lives
  // in *this* browser keyed to *this* wallet's session.
  if (!isConnected || !address) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Messaging</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertTitle>Connect your wallet to view</AlertTitle>
            <AlertDescription>
              The encrypted message thread is decrypted in your browser using a key derived from
              your wallet. Without a connected wallet, the platform has no way (and no permission)
              to show you the contents.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Messaging</CardTitle>
        <CardDescription>
          End-to-end encrypted. Each message is signed by your wallet and ciphertext-only on the
          server.
          {keyStatus === "publishing" && " Publishing your messaging key…"}
          {keyStatus === "ready" && " Messaging key published."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {keyStatus === "error" && (
          <Alert variant="destructive">
            <AlertTitle>Couldn't publish messaging key</AlertTitle>
            <AlertDescription>{keyError}</AlertDescription>
          </Alert>
        )}
        {loadError && (
          <Alert variant="destructive">
            <AlertTitle>Couldn't load messages</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        )}

        <div
          ref={scrollRef}
          className="max-h-96 space-y-2 overflow-y-auto rounded-md border bg-muted/20 p-3"
        >
          {messages.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {keyStatus === "ready"
                ? "No messages yet. Say hi."
                : "Setting up messaging keys…"}
            </p>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={`flex flex-col rounded-md border p-2 text-xs ${
                  m.is_self ? "ml-12 border-primary/40 bg-primary/5" : "mr-12 bg-background"
                }`}
              >
                <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                  <span className="font-mono">
                    {m.is_self ? "You" : m.sender_address.slice(0, 8) + "…"}
                  </span>
                  <span>
                    {new Date(m.created_at * 1000).toLocaleTimeString()} · leaf #
                    {m.transcript_leaf_index}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm">{m.plaintext}</p>
              </div>
            ))
          )}
        </div>

        <div className="space-y-2">
          <Textarea
            rows={3}
            placeholder={
              keyStatus === "ready" ? "Type a message…" : "Wait for messaging key to publish…"
            }
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={keyStatus !== "ready" || sending}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className="flex items-center justify-between">
            <Badge variant="outline" className="text-[10px]">
              {messages.length} message{messages.length === 1 ? "" : "s"}
            </Badge>
            <Button
              onClick={send}
              disabled={keyStatus !== "ready" || sending || !draft.trim()}
              size="sm"
            >
              {sending ? "Signing + encrypting…" : "Send (⌘⏎)"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
