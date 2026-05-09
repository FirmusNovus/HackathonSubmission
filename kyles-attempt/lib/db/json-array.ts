// SQLite-via-Prisma can't store native scalar arrays, so list-shaped fields on
// `LawyerProfile` (specialties, languages, jurisdictions, tags,
// credentialDocsUrl) are kept as JSON-encoded strings. These helpers handle
// the round-trip — and `containsValue` builds a Prisma `contains` filter that
// matches an exact element via the JSON-quoted shape (e.g. `"Family"` won't
// false-match against the substring `Tax` ⊂ `"Tax Law"`).

import type { PricingKind, VerificationStatus } from "@/lib/db/enums";

export function parseStrArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function stringifyStrArray(arr: readonly string[]): string {
  return JSON.stringify(arr);
}

/** Substring filter that matches an exact element inside a JSON-encoded string array. */
export function containsValue(value: string): { contains: string } {
  return { contains: JSON.stringify(value) };
}

/**
 * Rehydrate the JSON-encoded list fields on a `LawyerProfile` row back into
 * `string[]`, and narrow the string-typed enum columns (`pricingKind`,
 * `verificationStatus`) to their union types. Other fields pass through.
 */
export function expandLawyerProfile<
  T extends {
    specialties: string;
    languages: string;
    jurisdictions: string;
    tags: string;
    credentialDocsUrl: string;
    pricingKind: string;
    verificationStatus: string;
  },
>(
  row: T,
): Omit<
  T,
  "specialties" | "languages" | "jurisdictions" | "tags" | "credentialDocsUrl" | "pricingKind" | "verificationStatus"
> & {
  specialties: string[];
  languages: string[];
  jurisdictions: string[];
  tags: string[];
  credentialDocsUrl: string[];
  pricingKind: PricingKind;
  verificationStatus: VerificationStatus;
} {
  return {
    ...row,
    specialties: parseStrArray(row.specialties),
    languages: parseStrArray(row.languages),
    jurisdictions: parseStrArray(row.jurisdictions),
    tags: parseStrArray(row.tags),
    credentialDocsUrl: parseStrArray(row.credentialDocsUrl),
    pricingKind: row.pricingKind as PricingKind,
    verificationStatus: row.verificationStatus as VerificationStatus,
  };
}
