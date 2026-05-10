import type { Address } from "viem";
import { getDb } from "@/lib/db";

export interface BarSubjectRow {
  id: number;
  display_name: string;
  given_name: string;
  family_name: string;
  jurisdiction: string;
  bar_admission_date: string;
  bar_admission_number: string;
}

const COLUMNS = `id, display_name, given_name, family_name, jurisdiction,
                 bar_admission_date, bar_admission_number`;

export function findSubjectByAddress(address: Address): BarSubjectRow | null {
  const row = getDb()
    .prepare(`SELECT ${COLUMNS} FROM bar_subjects WHERE lower(eth_address) = lower(?)`)
    .get(address) as BarSubjectRow | undefined;
  return row ?? null;
}

export function findSubjectById(id: number): BarSubjectRow | null {
  const row = getDb()
    .prepare(`SELECT ${COLUMNS} FROM bar_subjects WHERE id = ?`)
    .get(id) as BarSubjectRow | undefined;
  return row ?? null;
}

export interface BarPersonaRow extends BarSubjectRow {
  eth_address: string;
}

export function listAllBar(): BarPersonaRow[] {
  return getDb()
    .prepare(`SELECT ${COLUMNS}, eth_address FROM bar_subjects ORDER BY id`)
    .all() as BarPersonaRow[];
}
