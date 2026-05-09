"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader, PageShell } from "@/components/layout/page-shell";
import { FirmusBadge } from "@/components/firmus/firmus-badge";

// Mirrors the server-side zod schema in app/api/matters/route.ts. Kept in sync
// manually because the api route is server-only (better-sqlite3 import) and
// can't be imported from a client component.
const FormSchema = z.object({
  description: z
    .string()
    .trim()
    .min(20, "give the lawyer at least one or two sentences of context")
    .max(5000),
  target_jurisdiction: z
    .string()
    .trim()
    .regex(/^[A-Z]{2}$/, "two-letter ISO country code (e.g. DE, ES, IT, CZ)"),
  target_practice_area: z.string().trim().min(2).max(120),
});
type FormValues = z.infer<typeof FormSchema>;

interface Matter {
  id: number;
  client_address: string;
  description: string;
  target_jurisdiction: string;
  target_practice_area: string;
  created_at: number;
  status: "open" | "engaged" | "withdrawn";
}

export default function MattersPage() {
  const { address, isConnected } = useAccount();
  const [matters, setMatters] = useState<Matter[]>([]);
  const [authStatus, setAuthStatus] = useState<"checking" | "ok" | "no-session" | "not-client">(
    "checking"
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: { description: "", target_jurisdiction: "", target_practice_area: "" },
  });

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/matters/mine", { cache: "no-store" });
      if (res.status === 401) {
        setAuthStatus("no-session");
        return;
      }
      const data = (await res.json()) as { matters?: Matter[]; error?: string };
      if (!res.ok) {
        // 403 from the POST route means "not a verified client". GET has no
        // such check, but if the user lands here without onboarding, the
        // resulting empty list is still a sensible signal — we just hint at
        // the cause via session-then-attestation probing.
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setMatters(data.matters ?? []);
      setAuthStatus("ok");
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);

  // After we know the SIWE session matches the connected wallet, also confirm
  // the wallet has completed client onboarding. POST will 403 otherwise; we
  // surface that proactively so the form can be disabled with a useful CTA.
  useEffect(() => {
    if (!isConnected || !address) {
      setAuthStatus("no-session");
      return;
    }
    let cancelled = false;
    (async () => {
      const sess = await fetch("/api/auth/siwe/session").then((r) => r.json());
      if (cancelled) return;
      if (!sess.address || sess.address.toLowerCase() !== address.toLowerCase()) {
        setAuthStatus("no-session");
        return;
      }
      // POST a tiny probe? Cheaper: just call the GET and let absence of any
      // matters + a separate attestation check happen via the post path. For
      // simplicity we treat session-OK as sufficient to render the form; the
      // POST itself will 403 if the wallet isn't a verified client.
      await refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [isConnected, address, refresh]);

  // Wallet-scoped SSE: refresh the matters/requests list whenever something
  // touching this wallet happens (proposal, decline, engagement opened…),
  // so status badges flip without a manual reload.
  useEffect(() => {
    if (authStatus !== "ok") return;
    const es = new EventSource("/api/me/events/stream");
    es.onmessage = () => {
      void refresh();
    };
    return () => es.close();
  }, [authStatus, refresh]);

  async function onSubmit(values: FormValues) {
    try {
      const res = await fetch("/api/matters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        if (res.status === 403) {
          setAuthStatus("not-client");
        }
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      form.reset();
      toast.success("Matter posted");
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <PageShell width="wide" className="space-y-8">
      <PageHeader
        eyebrow="Client"
        title="Your matters."
        description="A matter is a free-form description of a legal question, scoped to a target jurisdiction and practice area. It does not include a price — pricing is the lawyer's response to an engagement request, never part of the matter itself."
      />

      {authStatus === "no-session" && (
        <Alert>
          <AlertTitle>Sign in first</AlertTitle>
          <AlertDescription>
            Connect your wallet and complete{" "}
            <a href="/onboarding/client" className="underline">
              client onboarding
            </a>{" "}
            before posting a matter.
          </AlertDescription>
        </Alert>
      )}

      {authStatus === "not-client" && (
        <Alert variant="destructive">
          <AlertTitle>Not a verified client yet</AlertTitle>
          <AlertDescription>
            You're signed in, but your wallet hasn't completed PID-based client onboarding. Visit{" "}
            <a href="/onboarding/client" className="underline">
              /onboarding/client
            </a>
            .
          </AlertDescription>
        </Alert>
      )}

      <Card className="border-slate-100 bg-white shadow-none">
        <CardHeader>
          <CardTitle className="font-display text-2xl text-navy-900">Post a new matter</CardTitle>
          <CardDescription className="text-[14px] leading-relaxed text-slate-500">
            Describe what you need help with. The lawyer who picks it up only sees the description,
            jurisdiction, practice area, and the disclosed-attribute subset of your PID — not your
            name, document number, or any other PID claim.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                rows={6}
                placeholder="One or two paragraphs is fine. Avoid sharing identifying details — those go through E2EE messaging once an engagement starts."
                disabled={form.formState.isSubmitting || authStatus !== "ok"}
                {...form.register("description")}
              />
              {form.formState.errors.description && (
                <p className="text-xs text-destructive">
                  {form.formState.errors.description.message}
                </p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="target_jurisdiction">Target jurisdiction</Label>
                <Input
                  id="target_jurisdiction"
                  placeholder="DE"
                  maxLength={2}
                  className="uppercase"
                  disabled={form.formState.isSubmitting || authStatus !== "ok"}
                  {...form.register("target_jurisdiction", {
                    setValueAs: (v) => (typeof v === "string" ? v.toUpperCase() : v),
                  })}
                />
                {form.formState.errors.target_jurisdiction && (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.target_jurisdiction.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="target_practice_area">Practice area</Label>
                <Input
                  id="target_practice_area"
                  placeholder="employment, GDPR, contract dispute, …"
                  disabled={form.formState.isSubmitting || authStatus !== "ok"}
                  {...form.register("target_practice_area")}
                />
                {form.formState.errors.target_practice_area && (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.target_practice_area.message}
                  </p>
                )}
              </div>
            </div>

            <Button
              type="submit"
              disabled={form.formState.isSubmitting || authStatus !== "ok"}
              className="rounded-lg bg-teal-500 px-5 text-white hover:bg-teal-600"
            >
              {form.formState.isSubmitting ? "Posting…" : "Post matter"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <h2 className="font-display text-2xl text-navy-900">Posted</h2>
        {loadError && (
          <Alert variant="destructive">
            <AlertTitle>Couldn't load your matters</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        )}
        {authStatus === "ok" && matters.length === 0 && !loadError && (
          <p className="text-[14px] text-slate-500">No matters yet.</p>
        )}
        {matters.map((m) => (
          <Card key={m.id} className="border-slate-100 bg-white shadow-none">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="font-display text-[18px] text-navy-900">
                  {m.target_practice_area} · {m.target_jurisdiction}
                </CardTitle>
                <FirmusBadge
                  kind={m.status === "open" ? "info" : m.status === "engaged" ? "success" : "neutral"}
                >
                  {m.status}
                </FirmusBadge>
              </div>
              <CardDescription className="font-mono text-[12px] text-slate-300">
                #{m.id} · posted {new Date(m.created_at * 1000).toLocaleString()}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-slate-700">
                {m.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </PageShell>
  );
}
