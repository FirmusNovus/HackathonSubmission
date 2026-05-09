'use client';
// Owner spec: 001-verified-legal-engagement.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Chip } from '@/components/ui/chip';
import type { LawyerProfile } from '@/lib/db/lawyer-profiles';

const SPECIALTIES = [
  'Family', 'Estate', 'Property', 'Employment',
  'Immigration', 'Business', 'Tax', 'IP',
] as const;

const COMMON_LANGUAGES = ['English', 'German', 'Spanish', 'Italian', 'French', 'Czech', 'Polish', 'Dutch'];

export function VerifyLawyerForm({ profile }: { profile: LawyerProfile }) {
  const router = useRouter();
  const [city, setCity] = useState(profile.city ?? '');
  const [headline, setHeadline] = useState(profile.headline ?? '');
  const [bio, setBio] = useState(profile.bio ?? '');
  const [specialties, setSpecialties] = useState<string[]>(profile.specialties ?? []);
  const [languages, setLanguages] = useState<string[]>(profile.languages ?? []);
  const [yearsExp, setYearsExp] = useState<number>(profile.years_experience ?? 0);
  const [consultationType, setConsultationType] = useState<'FREE' | 'PAID'>(
    profile.consultation_type ?? 'PAID',
  );
  const [rate30, setRate30] = useState(profile.consultation_rate_30_wei ?? '0');
  const [rate60, setRate60] = useState(profile.consultation_rate_60_wei ?? '0');
  const [pricingHeadline, setPricingHeadline] = useState(profile.pricing_headline ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle<T extends string>(arr: T[], v: T): T[] {
    return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
  }

  async function submit() {
    setError(null);
    if (bio.length < 40) {
      setError('Bio must be at least 40 characters.');
      return;
    }
    if (specialties.length === 0) {
      setError('Pick at least one specialty.');
      return;
    }
    if (languages.length === 0) {
      setError('Pick at least one language.');
      return;
    }
    setBusy(true);
    try {
      const r = await fetch('/api/lawyer/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          city,
          headline,
          bio,
          specialties,
          languages,
          jurisdictions: profile.jurisdictions,
          years_experience: yearsExp,
          consultation_type: consultationType,
          pricing_kind: 'HOURLY',
          pricing_headline: pricingHeadline,
          consultation_rate_30_wei: rate30,
          consultation_rate_60_wei: rate60,
          hourly_rate_wei: '0',
          tags: profile.tags ?? [],
          availability: profile.availability ?? {},
        }),
      });
      const j = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok || !j.ok) throw new Error(j.error ?? 'save-failed');
      router.push('/lawyer/dashboard');
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-6 p-6">
      {/* Credential-derived (read-only) */}
      <section>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          From your bar credential
        </h3>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <ReadOnlyField label="Slug" value={profile.slug} />
          <ReadOnlyField label="Jurisdictions" value={(profile.jurisdictions ?? []).join(', ')} />
        </div>
      </section>

      {/* Editable */}
      <section>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Public profile</h3>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="City">
            <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Munich" />
          </Field>
          <Field label="Years of experience">
            <Input
              type="number"
              min={0}
              max={80}
              value={yearsExp}
              onChange={(e) => setYearsExp(Number(e.target.value))}
            />
          </Field>
        </div>

        <Field label="Headline" className="mt-3">
          <Input
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            placeholder="Family + estate counsel for cross-border EU clients."
            maxLength={160}
          />
        </Field>

        <Field label={`Bio (≥ 40 characters · ${bio.length})`} className="mt-3">
          <Textarea
            rows={5}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Describe your practice, what you specialise in, who you typically advise."
            maxLength={2000}
          />
        </Field>

        <Field label="Specialties (pick at least one)" className="mt-3">
          <div className="flex flex-wrap gap-2">
            {SPECIALTIES.map((s) => (
              <button
                type="button"
                key={s}
                onClick={() => setSpecialties((x) => toggle(x, s))}
                aria-pressed={specialties.includes(s)}
              >
                <Chip active={specialties.includes(s)}>{s}</Chip>
              </button>
            ))}
          </div>
        </Field>

        <Field label="Languages (pick at least one)" className="mt-3">
          <div className="flex flex-wrap gap-2">
            {COMMON_LANGUAGES.map((l) => (
              <button
                type="button"
                key={l}
                onClick={() => setLanguages((x) => toggle(x, l))}
                aria-pressed={languages.includes(l)}
              >
                <Chip active={languages.includes(l)}>{l}</Chip>
              </button>
            ))}
          </div>
        </Field>
      </section>

      <section>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Pricing</h3>
        <Field label="Consultation type" className="mt-3">
          <div className="flex gap-2">
            {(['PAID', 'FREE'] as const).map((t) => (
              <Button
                key={t}
                type="button"
                size="sm"
                variant={consultationType === t ? 'primary' : 'secondary'}
                onClick={() => setConsultationType(t)}
              >
                {t === 'PAID' ? 'Paid' : 'Free initial'}
              </Button>
            ))}
          </div>
        </Field>

        {consultationType === 'PAID' ? (
          <>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="30-min rate (wei)">
                <Input
                  value={rate30}
                  onChange={(e) => setRate30(e.target.value)}
                  className="font-mono"
                  placeholder="12000000000000000"
                />
              </Field>
              <Field label="60-min rate (wei)">
                <Input
                  value={rate60}
                  onChange={(e) => setRate60(e.target.value)}
                  className="font-mono"
                  placeholder="22000000000000000"
                />
              </Field>
            </div>
            <Field label="Pricing headline" className="mt-3">
              <Input
                value={pricingHeadline}
                onChange={(e) => setPricingHeadline(e.target.value)}
                placeholder="From 0.012 ETH per consultation"
                maxLength={200}
              />
            </Field>
          </>
        ) : null}
      </section>

      {error ? <div className="text-sm text-red-500">{error}</div> : null}

      <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
        <Button onClick={submit} disabled={busy}>
          {busy ? 'Saving…' : 'Save profile'}
        </Button>
      </div>
    </Card>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm font-mono text-slate-700">
        {value}
      </div>
    </div>
  );
}
