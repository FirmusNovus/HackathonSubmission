"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowRight, Upload, X } from "lucide-react";
import { PricingKind } from "@prisma/client";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

const Schema = z.object({
  fullName: z.string().min(2),
  email: z.string().email().optional().or(z.literal("")),
  city: z.string().min(2),
  headline: z.string().min(4).max(120),
  bio: z.string().min(40).max(2000),
  barRegistrationNum: z.string().min(2),
  barJurisdiction: z.string().min(2),
  jurisdictionsRaw: z.string().min(2),
  admissionDate: z.string().min(4),
  specialtiesRaw: z.string().min(2),
  languagesRaw: z.string().min(2),
  yearsExperience: z.coerce.number().int().nonnegative(),
  hourlyRateEUR: z.coerce.number().nonnegative(),
  pricingKind: z.nativeEnum(PricingKind),
  pricingHeadline: z.string().min(2),
});

type FormValues = z.infer<typeof Schema>;

export function VerifyLawyerForm() {
  const router = useRouter();
  const [docs, setDocs] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
  } = useForm<FormValues>({
    resolver: zodResolver(Schema),
    defaultValues: {
      pricingKind: PricingKind.HOURLY,
      pricingHeadline: "€240 / hr",
      hourlyRateEUR: 240,
      yearsExperience: 5,
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);
    setServerError(null);
    try {
      const payload = {
        fullName: values.fullName,
        email: values.email || undefined,
        city: values.city,
        headline: values.headline,
        bio: values.bio,
        barRegistrationNum: values.barRegistrationNum,
        barJurisdiction: values.barJurisdiction,
        jurisdictions: splitList(values.jurisdictionsRaw),
        admissionDate: values.admissionDate,
        specialties: splitList(values.specialtiesRaw),
        languages: splitList(values.languagesRaw),
        yearsExperience: values.yearsExperience,
        hourlyRateEUR: values.hourlyRateEUR,
        pricingKind: values.pricingKind,
        pricingHeadline: values.pricingHeadline,
        credentialDocsUrl: docs,
      };
      const res = await fetch("/api/verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setServerError(data?.error ?? "Submission failed");
        return;
      }
      router.push("/lawyer/dashboard");
    } finally {
      setSubmitting(false);
    }
  });

  const onUpload = async (file: File, purpose: string) => {
    const fd = new FormData();
    fd.set("file", file);
    fd.set("purpose", purpose);
    const res = await fetch("/api/uploads", { method: "POST", body: fd });
    if (!res.ok) return;
    const data = (await res.json()) as { url: string };
    setDocs((d) => [...d, data.url]);
  };

  const pricingKind = watch("pricingKind");

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Full legal name" required error={errors.fullName?.message}>
          <Input {...register("fullName")} placeholder="Maria Lindqvist" />
        </Field>
        <Field label="Bar registration number" required error={errors.barRegistrationNum?.message}>
          <Input {...register("barRegistrationNum")} placeholder="SE-2003-08291" />
        </Field>
        <Field label="Bar / jurisdiction body" required error={errors.barJurisdiction?.message}>
          <Input {...register("barJurisdiction")} placeholder="Stockholm Bar Association" />
        </Field>
        <Field label="Date of admission" required error={errors.admissionDate?.message}>
          <Input type="date" {...register("admissionDate")} />
        </Field>
        <Field label="City" required error={errors.city?.message}>
          <Input {...register("city")} placeholder="Stockholm" />
        </Field>
        <Field label="Country / EU jurisdictions (comma-separated)" required error={errors.jurisdictionsRaw?.message}>
          <Input {...register("jurisdictionsRaw")} placeholder="SE, EU" />
        </Field>
        <Field label="Email" error={errors.email?.message}>
          <Input type="email" {...register("email")} placeholder="you@example.eu" />
        </Field>
        <Field label="Years of experience" required error={errors.yearsExperience?.message}>
          <Input type="number" min={0} {...register("yearsExperience")} />
        </Field>
      </div>

      <Field label="Headline" required error={errors.headline?.message}>
        <Input {...register("headline")} placeholder="Family & Estate counsel · Stockholm" />
      </Field>

      <Field label="Bio" required error={errors.bio?.message}>
        <Textarea
          {...register("bio")}
          placeholder="Twenty-two years guiding families through inheritance, divorce and custody under Swedish and EU law…"
          rows={6}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Specializations (comma-separated)" required error={errors.specialtiesRaw?.message}>
          <Input {...register("specialtiesRaw")} placeholder="Family Law, Estate Planning, EU Cross-Border" />
        </Field>
        <Field label="Languages (comma-separated)" required error={errors.languagesRaw?.message}>
          <Input {...register("languagesRaw")} placeholder="Swedish, English" />
        </Field>
      </div>

      <fieldset className="rounded-xl border border-slate-100 bg-white-0 p-5">
        <legend className="px-2 text-[13px] font-medium text-navy-900">Pricing</legend>
        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Pricing model" required>
            <select
              {...register("pricingKind")}
              className="h-11 rounded-lg border border-slate-100 bg-white-0 px-3.5 text-[15px] text-navy-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-50"
            >
              <option value="HOURLY">Hourly</option>
              <option value="FIXED">Fixed packages</option>
              <option value="SUBSCRIPTION">Subscription</option>
              <option value="SUCCESS">No win, no fee</option>
            </select>
          </Field>
          <Field label="Headline (e.g. €240 / hr)" required error={errors.pricingHeadline?.message}>
            <Input {...register("pricingHeadline")} placeholder={pricingKind === "SUCCESS" ? "No win, no fee" : "€240 / hr"} />
          </Field>
          <Field label="Hourly equivalent (EUR)" required error={errors.hourlyRateEUR?.message}>
            <Input type="number" min={0} step="10" {...register("hourlyRateEUR")} />
          </Field>
        </div>
        <p className="mt-3 text-[12px] text-slate-500">
          For non-hourly models, "Hourly equivalent" is used to scale platform metrics. You can edit packages from your profile editor after verification.
        </p>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <DropZone title="Bar certificate" subtitle="PDF or image · max 10 MB" onFile={(f) => onUpload(f, "credentials")} />
        <DropZone title="Government ID" subtitle="Passport or national ID · PDF or image" onFile={(f) => onUpload(f, "credentials")} />
      </div>
      {docs.length > 0 && (
        <ul className="space-y-1.5 text-[12px] text-slate-500">
          {docs.map((d) => (
            <li key={d} className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-teal-500" aria-hidden />
              <span className="truncate">{d}</span>
              <button
                type="button"
                onClick={() => setDocs((cur) => cur.filter((x) => x !== d))}
                className="text-slate-400 hover:text-navy-900"
                aria-label="Remove"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      {serverError && <p className="text-[13px] text-red-500">{serverError}</p>}

      <div className="flex justify-end border-t border-slate-100 pt-6">
        <Button type="submit" disabled={submitting}>
          {submitting ? "Submitting…" : "Submit for Verification"} <ArrowRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </form>
  );
}

function splitList(raw: string): string[] {
  return raw
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label className="mb-1.5 block">
        {label} {required && <span className="text-teal-500">*</span>}
      </Label>
      {children}
      {error && <p className="mt-1 text-[12px] text-red-500">{error}</p>}
    </div>
  );
}

function DropZone({ title, subtitle, onFile }: { title: string; subtitle: string; onFile: (f: File) => void }) {
  return (
    <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-teal-500 bg-[#F0FBF9] p-6 text-center transition-colors hover:bg-teal-50">
      <input
        type="file"
        className="sr-only"
        accept="application/pdf,image/png,image/jpeg,image/webp"
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          if (f) onFile(f);
        }}
      />
      <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-white-0">
        <Upload className="h-4 w-4 text-teal-700" aria-hidden />
      </span>
      <span className="text-[14px] font-medium text-navy-900">{title}</span>
      <span className="text-[12px] text-slate-500">
        Drop a file here, or <span className="text-teal-600">browse</span>
      </span>
      <span className="text-[11px] text-slate-300">{subtitle}</span>
    </label>
  );
}
