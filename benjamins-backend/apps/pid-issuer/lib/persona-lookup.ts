import type { Address } from "viem";
import { getDb } from "@/lib/db";

export interface PidPlaceOfBirth {
  locality: string;
  region: string;
  country: string;
}

export interface PidAddress {
  street_address: string;
  house_number: string;
  postal_code: string;
  locality: string;
  region: string;
  country: string;
  formatted: string;
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
  place_of_birth: PidPlaceOfBirth;
  address: PidAddress;
  personal_administrative_number: string;
  document_number: string;
  issuing_authority: string;
  issuing_country: string;
  issuing_jurisdiction: string;
}

type StoredRow = Omit<PidSubjectRow, "nationalities" | "place_of_birth" | "address"> & {
  nationalities: string;
  place_of_birth: string;
  address: string;
};

function inflate(row: StoredRow): PidSubjectRow {
  return {
    ...row,
    nationalities: JSON.parse(row.nationalities),
    place_of_birth: JSON.parse(row.place_of_birth),
    address: JSON.parse(row.address),
  };
}

const COLUMNS = `id, display_name, given_name, family_name, birth_given_name, birth_family_name,
                 birthdate, sex, email, phone_number, nationalities, place_of_birth, address,
                 personal_administrative_number, document_number, issuing_authority,
                 issuing_country, issuing_jurisdiction`;

export function findSubjectByAddress(address: Address): PidSubjectRow | null {
  const row = getDb()
    .prepare(`SELECT ${COLUMNS} FROM subjects WHERE lower(eth_address) = lower(?)`)
    .get(address) as StoredRow | undefined;
  return row ? inflate(row) : null;
}

export function findSubjectById(id: number): PidSubjectRow | null {
  const row = getDb()
    .prepare(`SELECT ${COLUMNS} FROM subjects WHERE id = ?`)
    .get(id) as StoredRow | undefined;
  return row ? inflate(row) : null;
}
