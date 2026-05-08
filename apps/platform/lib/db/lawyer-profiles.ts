// Owner spec: 001-verified-legal-engagement.

import { getDb } from './client';

export interface LawyerProfile {
  user_id: string;
  slug: string;
  city: string;
  headline: string;
  bio: string;
  specialties: string[];
  languages: string[];
  jurisdictions: string[];
  years_experience: number;
  consultation_type: 'FREE' | 'PAID';
  hourly_rate_wei: string;
  pricing_kind: 'HOURLY' | 'FIXED' | 'SUBSCRIPTION' | 'SUCCESS';
  pricing_headline: string;
  consultation_rate_30_wei: string;
  consultation_rate_60_wei: string;
  pricing_items: Array<{ title: string; desc: string; price: string; unit: string }>;
  tags: string[];
  availability: Record<string, unknown>;
  avatar_url: string | null;
  avatar_uploaded_at: number | null;
  created_at: number;
  updated_at: number;
}

const JSON_FIELDS = [
  'specialties',
  'languages',
  'jurisdictions',
  'pricing_items',
  'tags',
  'availability',
] as const;

function rowToProfile(row: Record<string, unknown>): LawyerProfile {
  const out: Record<string, unknown> = { ...row };
  for (const f of JSON_FIELDS) out[f] = JSON.parse((row[f] as string) ?? '[]');
  return out as unknown as LawyerProfile;
}

export function upsertLawyerProfile(p: Omit<LawyerProfile, 'created_at' | 'updated_at'>) {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO lawyer_profiles (user_id, slug, city, headline, bio, specialties, languages, jurisdictions,
      years_experience, consultation_type, hourly_rate_wei, pricing_kind, pricing_headline,
      consultation_rate_30_wei, consultation_rate_60_wei, pricing_items, tags, availability, avatar_url,
      avatar_uploaded_at, created_at, updated_at)
     VALUES (@user_id, @slug, @city, @headline, @bio, @specialties, @languages, @jurisdictions,
       @years_experience, @consultation_type, @hourly_rate_wei, @pricing_kind, @pricing_headline,
       @consultation_rate_30_wei, @consultation_rate_60_wei, @pricing_items, @tags, @availability,
       @avatar_url, @avatar_uploaded_at, @created_at, @updated_at)
     ON CONFLICT(user_id) DO UPDATE SET
       slug = excluded.slug,
       city = excluded.city,
       headline = excluded.headline,
       bio = excluded.bio,
       specialties = excluded.specialties,
       languages = excluded.languages,
       jurisdictions = excluded.jurisdictions,
       years_experience = excluded.years_experience,
       consultation_type = excluded.consultation_type,
       hourly_rate_wei = excluded.hourly_rate_wei,
       pricing_kind = excluded.pricing_kind,
       pricing_headline = excluded.pricing_headline,
       consultation_rate_30_wei = excluded.consultation_rate_30_wei,
       consultation_rate_60_wei = excluded.consultation_rate_60_wei,
       pricing_items = excluded.pricing_items,
       tags = excluded.tags,
       availability = excluded.availability,
       avatar_url = excluded.avatar_url,
       avatar_uploaded_at = excluded.avatar_uploaded_at,
       updated_at = excluded.updated_at`,
  ).run({
    user_id: p.user_id.toLowerCase(),
    slug: p.slug,
    city: p.city,
    headline: p.headline,
    bio: p.bio,
    specialties: JSON.stringify(p.specialties),
    languages: JSON.stringify(p.languages),
    jurisdictions: JSON.stringify(p.jurisdictions),
    years_experience: p.years_experience,
    consultation_type: p.consultation_type,
    hourly_rate_wei: p.hourly_rate_wei,
    pricing_kind: p.pricing_kind,
    pricing_headline: p.pricing_headline,
    consultation_rate_30_wei: p.consultation_rate_30_wei,
    consultation_rate_60_wei: p.consultation_rate_60_wei,
    pricing_items: JSON.stringify(p.pricing_items),
    tags: JSON.stringify(p.tags),
    availability: JSON.stringify(p.availability),
    avatar_url: p.avatar_url,
    avatar_uploaded_at: p.avatar_uploaded_at,
    created_at: now,
    updated_at: now,
  });
}

export function getLawyerProfile(userId: string): LawyerProfile | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM lawyer_profiles WHERE user_id = ?`).get(userId.toLowerCase()) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToProfile(row) : null;
}

export function listVerifiedLawyerDirectory(): Array<LawyerProfile & { eth_address: string; attestation_uid: string; disclosed_attrs: Record<string, unknown> }> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT v.eth_address, v.attestation_uid, v.disclosed_attrs, p.*
       FROM verified_users v
       JOIN lawyer_profiles p ON p.user_id = v.eth_address
       WHERE v.attested_role = 'lawyer' AND v.revoked_at IS NULL
       ORDER BY v.attested_at DESC`,
    )
    .all() as Record<string, unknown>[];
  return rows.map((r) => ({
    ...rowToProfile(r),
    eth_address: r.eth_address as string,
    attestation_uid: r.attestation_uid as string,
    disclosed_attrs: JSON.parse((r.disclosed_attrs as string) ?? '{}'),
  }));
}
