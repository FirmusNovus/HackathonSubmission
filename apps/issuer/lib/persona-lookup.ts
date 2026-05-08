// Owner spec: 001-verified-legal-engagement.

import type { Address } from 'viem';
import { getDb } from './db/client';

export interface BarSubjectRow {
  id: number;
  display_name: string;
  given_name: string;
  family_name: string;
  jurisdiction: string;
  bar_admission_date: string;
  bar_admission_number: string;
  valid_until: string;
}

export interface PidSubjectRow {
  id: number;
  display_name: string;
  given_name: string;
  family_name: string;
  birth_given_name: string;
  birth_family_name: string;
  birthdate: string;
  sex: number;
  email: string;
  phone_number: string;
  nationalities: string[];
  place_of_birth: { locality: string; region: string; country: string };
  address: {
    street_address: string;
    house_number: string;
    postal_code: string;
    locality: string;
    region: string;
    country: string;
    formatted: string;
  };
  personal_administrative_number: string;
  document_number: string;
  issuing_authority: string;
  issuing_country: string;
  issuing_jurisdiction: string;
}

const BAR_COLUMNS = `
  id, display_name, given_name, family_name, jurisdiction,
  bar_admission_date, bar_admission_number, valid_until
`;

const PID_COLUMNS = `
  id, display_name, given_name, family_name, birth_given_name, birth_family_name,
  birthdate, sex, email, phone_number, nationalities, place_of_birth, address_json AS address,
  personal_administrative_number, document_number, issuing_authority,
  issuing_country, issuing_jurisdiction
`;

interface RawPidRow extends Omit<PidSubjectRow, 'nationalities' | 'place_of_birth' | 'address'> {
  nationalities: string;
  place_of_birth: string;
  address: string;
}

function inflatePid(row: RawPidRow): PidSubjectRow {
  return {
    ...row,
    nationalities: JSON.parse(row.nationalities),
    place_of_birth: JSON.parse(row.place_of_birth),
    address: JSON.parse(row.address),
  };
}

export function findBarByAddress(address: Address): BarSubjectRow | null {
  const row = getDb()
    .prepare(
      `SELECT ${BAR_COLUMNS} FROM subjects
       WHERE credential_type = 'bar' AND lower(eth_address) = lower(?)`,
    )
    .get(address) as BarSubjectRow | undefined;
  return row ?? null;
}

export function findBarById(id: number): BarSubjectRow | null {
  const row = getDb()
    .prepare(
      `SELECT ${BAR_COLUMNS} FROM subjects WHERE credential_type = 'bar' AND id = ?`,
    )
    .get(id) as BarSubjectRow | undefined;
  return row ?? null;
}

export function findPidByAddress(address: Address): PidSubjectRow | null {
  const row = getDb()
    .prepare(
      `SELECT ${PID_COLUMNS} FROM subjects
       WHERE credential_type = 'pid' AND lower(eth_address) = lower(?)`,
    )
    .get(address) as RawPidRow | undefined;
  return row ? inflatePid(row) : null;
}

export function findPidById(id: number): PidSubjectRow | null {
  const row = getDb()
    .prepare(`SELECT ${PID_COLUMNS} FROM subjects WHERE credential_type = 'pid' AND id = ?`)
    .get(id) as RawPidRow | undefined;
  return row ? inflatePid(row) : null;
}
