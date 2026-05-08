"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

interface Matter {
  id: number;
  description: string;
  target_jurisdiction: string;
  target_practice_area: string;
  status: "open" | "engaged" | "withdrawn";
}

/**
 * Client-side widget on the lawyer profile page that lets a verified client
 * pick one of their open matters and send an engagement request to this
 * lawyer. On success, navigates straight to the engagement page so the
 * client can see the lawyer's eventual proposal.
 */
export function EngageLawyer({ lawyerAddress }: { lawyerAddress: string }) {
  const { address, isConnected } = useAccount();
  const router = useRouter();
  const [matters, setMatters] = useState<Matter[]>([]);
  const [authStatus, setAuthStatus] = useState<"checking" | "ok" | "no-session">("checking");
  const [chosenId, setChosenId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isConnected) {
      setAuthStatus("no-session");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const sess = await fetch("/api/auth/siwe/session").then((r) => r.json());
        if (cancelled) return;
        if (!sess.address || !address || sess.address.toLowerCase() !== address.toLowerCase()) {
          setAuthStatus("no-session");
          return;
        }
        const res = await fetch("/api/matters/mine", { cache: "no-store" });
        if (cancelled) return;
        if (res.status === 401) {
          setAuthStatus("no-session");
          return;
        }
        const data = (await res.json()) as { matters?: Matter[] };
        setMatters(data.matters ?? []);
        setAuthStatus("ok");
      } catch (e) {
        setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isConnected, address]);

  async function send() {
    if (!chosenId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/engagements/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matter_id: chosenId, lawyer_address: lawyerAddress }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        request?: { id: number };
        error?: string;
      };
      if (!res.ok || !data.request) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast.success("Engagement request sent");
      router.push(`/engagements/${data.request.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const open = matters.filter((m) => m.status === "open");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Engage this lawyer</CardTitle>
        <CardDescription>
          Pick one of your open matters and send a signed request. The lawyer will reply with a
          first-milestone proposal you can accept (fund), counter, or decline.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {authStatus === "no-session" && (
          <Alert>
            <AlertTitle>Sign in first</AlertTitle>
            <AlertDescription>
              Connect your wallet, complete{" "}
              <a href="/onboarding/client" className="underline">
                client onboarding
              </a>
              , and post a matter at <a href="/matters" className="underline">/matters</a> before
              engaging.
            </AlertDescription>
          </Alert>
        )}
        {authStatus === "ok" && open.length === 0 && (
          <Alert>
            <AlertTitle>No open matters</AlertTitle>
            <AlertDescription>
              Post one at <a href="/matters" className="underline">/matters</a> first.
            </AlertDescription>
          </Alert>
        )}
        {authStatus === "ok" && open.length > 0 && (
          <>
            <div className="space-y-2">
              <Label className="text-xs">Choose a matter</Label>
              <div className="space-y-2">
                {open.map((m) => (
                  <label
                    key={m.id}
                    className={`flex cursor-pointer gap-3 rounded-md border p-3 text-sm hover:bg-muted/40 ${
                      chosenId === m.id ? "border-primary bg-primary/5" : ""
                    }`}
                  >
                    <input
                      type="radio"
                      name="matter"
                      checked={chosenId === m.id}
                      onChange={() => setChosenId(m.id)}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <div className="font-medium">
                        {m.target_practice_area} · {m.target_jurisdiction}
                      </div>
                      <div className="line-clamp-2 text-xs text-muted-foreground">
                        {m.description}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
            <Button
              onClick={send}
              disabled={!chosenId || submitting}
              className="w-full sm:w-auto"
            >
              {submitting ? "Sending…" : "Send engagement request"}
            </Button>
          </>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertTitle>Couldn't send</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
