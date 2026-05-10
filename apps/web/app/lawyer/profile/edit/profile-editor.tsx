"use client";

import { useState, useTransition } from "react";
import { Check, Globe, Upload, X } from "lucide-react";
import { PricingKind, VerificationStatus } from "@/lib/db/enums";
import { AvatarBubble } from "@/components/firmus/avatar-bubble";
import { EBSIBadge } from "@/components/firmus/ebsi-badge";
import { PricingBadge } from "@/components/firmus/pricing-badge";
import { Stars } from "@/components/firmus/stars";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { StatusPill } from "@/components/firmus/status-pill";

interface EditorProps {
  profile: {
    id: string;
    headline: string;
    bio: string;
    specialties: string[];
    languages: string[];
    jurisdictions: string[];
    verificationStatus: VerificationStatus;
    ebsiCredentialId: string | null;
    barJurisdiction: string;
    admissionDate: string;
    pricingHeadline: string;
    pricingKind: PricingKind;
    hourlyRateEUR: number;
    user: { name: string };
  };
}

export function ProfileEditor({ profile }: EditorProps) {
  const [headline, setHeadline] = useState(profile.headline);
  const [bio, setBio] = useState(profile.bio);
  const [specialties, setSpecialties] = useState<string[]>(profile.specialties);
  const [specialtyInput, setSpecialtyInput] = useState("");
  const [languages, setLanguages] = useState(profile.languages.join(" · "));
  const [jurisdictions, setJurisdictions] = useState(profile.jurisdictions.join(" · "));
  const [pricingHeadline, setPricingHeadline] = useState(profile.pricingHeadline);
  const [pricingKind, setPricingKind] = useState<PricingKind>(profile.pricingKind);
  const [hourlyRate, setHourlyRate] = useState(profile.hourlyRateEUR);
  const [saving, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const dirty =
    headline !== profile.headline ||
    bio !== profile.bio ||
    specialties.join(",") !== profile.specialties.join(",") ||
    languages !== profile.languages.join(" · ") ||
    jurisdictions !== profile.jurisdictions.join(" · ") ||
    pricingHeadline !== profile.pricingHeadline ||
    pricingKind !== profile.pricingKind ||
    hourlyRate !== profile.hourlyRateEUR;

  const save = () =>
    startTransition(async () => {
      const payload = {
        headline,
        bio,
        specialties,
        languages: languages.split(/[·,;]/).map((s) => s.trim()).filter(Boolean),
        jurisdictions: jurisdictions.split(/[·,;]/).map((s) => s.trim()).filter(Boolean),
        hourlyRateEUR: hourlyRate,
        pricingKind,
        pricingHeadline,
      };
      const res = await fetch("/api/lawyer/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) setSavedAt(new Date());
    });

  return (
    <>
      <Tabs defaultValue="profile" className="mt-6">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="pricing">Pricing</TabsTrigger>
          <TabsTrigger value="verif">
            Verification {profile.verificationStatus === "VERIFIED" ? "✓" : ""}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
            <div className="space-y-6">
              <Section title="Photo">
                <div className="flex items-center gap-5">
                  <AvatarBubble name={profile.user.name} size={96} verified={profile.verificationStatus === "VERIFIED"} sealSize={28} />
                  <div>
                    <Button variant="outline" size="sm" disabled>
                      <Upload className="h-4 w-4" aria-hidden /> Replace photo
                    </Button>
                    <p className="mt-2.5 text-[12px] text-slate-500">
                      JPG or PNG, at least 400×400px. The EBSI seal is added automatically — don't include it in your photo.
                    </p>
                  </div>
                </div>
              </Section>

              <Section title="Name">
                <div className="flex items-center gap-2">
                  <Input value={profile.user.name || "—"} readOnly disabled className="cursor-not-allowed bg-slate-50 text-slate-700" />
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-teal-50 px-2.5 py-1 text-[11px] font-medium text-teal-700">
                    <EBSIBadge variant="seal" size={11} /> Verified
                  </span>
                </div>
                <p className="mt-1.5 text-[12px] text-slate-500">
                  Pulled from your bar credential and anchored on chain — not editable here.
                </p>
              </Section>

              <Section title="Headline">
                <Input value={headline} onChange={(e) => setHeadline(e.target.value)} />
              </Section>

              <Section title="Bio">
                <Textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={6} />
              </Section>

              <Section title="Specializations">
                <div className="flex flex-wrap gap-2 rounded-lg border border-slate-100 bg-white-0 p-3">
                  {specialties.map((s) => (
                    <span key={s} className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 px-3 py-1.5 text-[13px] font-medium text-teal-700">
                      {s}
                      <button type="button" onClick={() => setSpecialties((cur) => cur.filter((x) => x !== s))} className="hover:text-teal-900" aria-label={`Remove ${s}`}>
                        <X className="h-3 w-3" aria-hidden />
                      </button>
                    </span>
                  ))}
                  <input
                    value={specialtyInput}
                    onChange={(e) => setSpecialtyInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && specialtyInput.trim()) {
                        e.preventDefault();
                        setSpecialties((cur) => [...new Set([...cur, specialtyInput.trim()])]);
                        setSpecialtyInput("");
                      }
                    }}
                    placeholder="Add specialization…"
                    className="min-w-[150px] flex-1 border-0 bg-transparent text-[13px] outline-none"
                  />
                </div>
              </Section>

              <div className="grid gap-4 sm:grid-cols-2">
                <Section title="Languages">
                  <Input value={languages} onChange={(e) => setLanguages(e.target.value)} placeholder="Swedish · English" />
                </Section>
                <Section title="Jurisdictions">
                  <Input value={jurisdictions} onChange={(e) => setJurisdictions(e.target.value)} placeholder="SE · EU" />
                </Section>
              </div>
            </div>

            <aside>
              <div className="sticky top-24">
                <div className="mb-3 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">
                  <Globe className="h-3 w-3" aria-hidden /> Live preview · public profile
                </div>
                <div className="rounded-xl border border-slate-100 bg-white-0 p-5 shadow-[var(--shadow-sm)]">
                  <div className="flex gap-3">
                    <AvatarBubble name={profile.user.name} size={56} verified={profile.verificationStatus === "VERIFIED"} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[15px] font-semibold text-navy-900">{profile.user.name}</div>
                      <div className="truncate text-[12px] text-slate-500">{headline.split(" · ")[0]}</div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <Stars value={4.9} />
                        <span className="text-[12px] text-slate-300">·</span>
                        <span className="text-[12px] font-medium text-navy-900">{pricingHeadline}</span>
                      </div>
                      <div className="mt-1.5">
                        <PricingBadge kind={pricingKind} />
                      </div>
                    </div>
                  </div>
                  <p className="mt-3 line-clamp-2 text-[13px] text-slate-500">{bio.split(".")[0]}.</p>
                </div>
              </div>
            </aside>
          </div>
        </TabsContent>

        <TabsContent value="pricing">
          <div className="max-w-[640px] space-y-6 rounded-xl border border-slate-100 bg-white-0 p-6">
            <Section title="Pricing model">
              <select
                value={pricingKind}
                onChange={(e) => setPricingKind(e.target.value as PricingKind)}
                className="h-11 w-full rounded-lg border border-slate-100 bg-white-0 px-3.5 text-[15px]"
              >
                <option value="HOURLY">Hourly</option>
                <option value="FIXED">Fixed packages</option>
                <option value="SUBSCRIPTION">Subscription</option>
                <option value="SUCCESS">No win, no fee</option>
              </select>
            </Section>
            <Section title="Display headline">
              <Input value={pricingHeadline} onChange={(e) => setPricingHeadline(e.target.value)} />
            </Section>
            <Section title="Hourly rate (ETH)">
              <Input type="number" min={0} step="0.001" value={hourlyRate} onChange={(e) => setHourlyRate(Number(e.target.value))} />
            </Section>
            <p className="text-[12px] text-slate-500">
              Service packages can be edited via the <code className="rounded bg-slate-50 px-1.5 py-0.5 font-mono text-[11px]">/api/verification</code> endpoint in this MVP. A package editor UI ships post-MVP.
            </p>
          </div>
        </TabsContent>

        <TabsContent value="verif">
          <div className="max-w-[720px] rounded-2xl border border-slate-100 bg-white-0 p-7">
            <div className="flex items-start gap-5">
              <EBSIBadge variant="seal" size={56} />
              <div className="flex-1">
                <div className="flex items-center gap-2.5">
                  <h3 className="text-base font-semibold text-navy-900">EBSI Verification</h3>
                  {profile.verificationStatus === "VERIFIED" ? <StatusPill status="verified" /> : <StatusPill status="pending" />}
                </div>
                <p className="mt-2 text-[14px] leading-[1.6] text-slate-500">
                  Your bar admission, identity, and specialization certificates are{" "}
                  {profile.verificationStatus === "VERIFIED" ? "verified" : "pending verification"} on the European Blockchain Services Infrastructure. Verification is permanent and portable across the EU.
                </p>
                {profile.ebsiCredentialId && (
                  <p className="mt-3 font-mono text-[12px] text-slate-500">{profile.ebsiCredentialId}</p>
                )}
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <div className="fixed inset-x-0 bottom-0 z-20 flex items-center justify-between border-t border-slate-100 bg-white-0 px-8 py-4 shadow-[0_-4px_12px_rgba(10,31,68,0.04)]">
        <span className="flex items-center gap-2 text-[13px] text-slate-500">
          <span aria-hidden className={dirty ? "h-2 w-2 rounded-full bg-amber-500" : "h-2 w-2 rounded-full bg-green-400"} />
          {savedAt ? `Saved ${savedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : dirty ? "Unsaved changes" : "All changes saved"}
        </span>
        <div className="flex gap-2.5">
          <Button variant="ghost" disabled={!dirty} type="button">
            Discard
          </Button>
          <Button onClick={save} disabled={!dirty || saving} type="button">
            <Check className="h-4 w-4" aria-hidden /> {saving ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="mb-2 block">{title}</Label>
      {children}
    </div>
  );
}
