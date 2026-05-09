/**
 * Seeds the issuer's `subjects` roster with the six pre-staged personas:
 *   - five lawyers (anvil indices 1-5) with PID + bar entries
 *   - one client (anvil index 6) with a PID entry only
 *
 * Idempotent. Also generates pid-signing-key.jwk + bar-signing-key.jwk on
 * first run if they're missing.
 *
 *   pnpm -F @firmus-novus/issuer seed
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { mnemonicToAccount } from 'viem/accounts';
import type { Address } from 'viem';
import { runSchema } from '../lib/db/schema';
import { ensureKey } from '../lib/keys';

const APP_ROOT = resolve(__dirname, '..');
const DATA_DIR = join(APP_ROOT, 'data');
const DB_PATH = process.env.ISSUER_DB ?? join(DATA_DIR, 'db.sqlite');

const ANVIL_MNEMONIC =
  process.env.ANVIL_MNEMONIC ??
  'test test test test test test test test test test test junk';

interface PidSpec {
  index: number;
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

interface BarSpec {
  index: number;
  display_name: string;
  given_name: string;
  family_name: string;
  jurisdiction: string;
  bar_admission_date: string;
  bar_admission_number: string;
  valid_until: string;
}

const PID_SUBJECTS: PidSpec[] = [
  {
    index: 1,
    display_name: 'Anna Schmidt',
    given_name: 'Anna',
    family_name: 'Schmidt',
    birth_given_name: 'Anna',
    birth_family_name: 'Schmidt',
    birthdate: '1985-04-12',
    sex: 2,
    email: 'anna.schmidt@kanzlei-schmidt.de',
    phone_number: '+498912345678',
    nationalities: ['DE'],
    place_of_birth: { locality: 'München', region: 'Bayern', country: 'DE' },
    address: {
      street_address: 'Maximilianstraße',
      house_number: '12',
      postal_code: '80539',
      locality: 'München',
      region: 'Bayern',
      country: 'DE',
      formatted: 'Maximilianstraße 12, 80539 München, Bayern, DE',
    },
    personal_administrative_number: 'DE-A-19850412-0001',
    document_number: 'DE-PID-2023-887421',
    issuing_authority: 'Bundesdruckerei',
    issuing_country: 'DE',
    issuing_jurisdiction: 'DE-BY',
  },
  {
    index: 2,
    display_name: 'Klaus Weber',
    given_name: 'Klaus',
    family_name: 'Weber',
    birth_given_name: 'Klaus',
    birth_family_name: 'Weber',
    birthdate: '1978-09-22',
    sex: 1,
    email: 'klaus.weber@weber-recht.de',
    phone_number: '+493012345678',
    nationalities: ['DE'],
    place_of_birth: { locality: 'Berlin', region: 'Berlin', country: 'DE' },
    address: {
      street_address: 'Friedrichstraße',
      house_number: '120',
      postal_code: '10117',
      locality: 'Berlin',
      region: 'Berlin',
      country: 'DE',
      formatted: 'Friedrichstraße 120, 10117 Berlin, Berlin, DE',
    },
    personal_administrative_number: 'DE-B-19780922-0042',
    document_number: 'DE-PID-2023-441099',
    issuing_authority: 'Bundesdruckerei',
    issuing_country: 'DE',
    issuing_jurisdiction: 'DE-BE',
  },
  {
    index: 3,
    display_name: 'Lucia Romero',
    given_name: 'Lucia',
    family_name: 'Romero',
    birth_given_name: 'Lucia',
    birth_family_name: 'Romero',
    birthdate: '1982-02-14',
    sex: 2,
    email: 'lucia@romero-abogados.es',
    phone_number: '+34915557788',
    nationalities: ['ES'],
    place_of_birth: { locality: 'Madrid', region: 'Comunidad de Madrid', country: 'ES' },
    address: {
      street_address: 'Calle de Serrano',
      house_number: '45',
      postal_code: '28001',
      locality: 'Madrid',
      region: 'Comunidad de Madrid',
      country: 'ES',
      formatted: 'Calle de Serrano 45, 28001 Madrid, Comunidad de Madrid, ES',
    },
    personal_administrative_number: 'ES-A-19820214-A',
    document_number: 'ES-PID-2023-553201',
    issuing_authority: 'Dirección General de la Policía',
    issuing_country: 'ES',
    issuing_jurisdiction: 'ES-MD',
  },
  {
    index: 4,
    display_name: 'Marco Bianchi',
    given_name: 'Marco',
    family_name: 'Bianchi',
    birth_given_name: 'Marco',
    birth_family_name: 'Bianchi',
    birthdate: '1980-11-30',
    sex: 1,
    email: 'marco@bianchi-studiolegale.it',
    phone_number: '+390245678910',
    nationalities: ['IT'],
    place_of_birth: { locality: 'Milano', region: 'Lombardia', country: 'IT' },
    address: {
      street_address: 'Via Monte Napoleone',
      house_number: '8',
      postal_code: '20121',
      locality: 'Milano',
      region: 'Lombardia',
      country: 'IT',
      formatted: 'Via Monte Napoleone 8, 20121 Milano, Lombardia, IT',
    },
    personal_administrative_number: 'IT-MI-19801130-001',
    document_number: 'IT-PID-2023-009842',
    issuing_authority: 'Ministero dell\u2019Interno',
    issuing_country: 'IT',
    issuing_jurisdiction: 'IT-MI',
  },
  {
    index: 5,
    display_name: 'Pavel Nov\u00e1k',
    given_name: 'Pavel',
    family_name: 'Nov\u00e1k',
    birth_given_name: 'Pavel',
    birth_family_name: 'Nov\u00e1k',
    birthdate: '1988-06-04',
    sex: 1,
    email: 'pavel@novak-pravo.cz',
    phone_number: '+420220123456',
    nationalities: ['CZ'],
    place_of_birth: { locality: 'Praha', region: 'Praha', country: 'CZ' },
    address: {
      street_address: 'V\u00e1clavsk\u00e9 n\u00e1m\u011bst\u00ed',
      house_number: '11',
      postal_code: '11000',
      locality: 'Praha',
      region: 'Praha',
      country: 'CZ',
      formatted: 'V\u00e1clavsk\u00e9 n\u00e1m\u011bst\u00ed 11, 11000 Praha, Praha, CZ',
    },
    personal_administrative_number: 'CZ-PR-19880604-019',
    document_number: 'CZ-PID-2023-114577',
    issuing_authority: 'Ministerstvo vnitra',
    issuing_country: 'CZ',
    issuing_jurisdiction: 'CZ-PR',
  },
  {
    index: 6,
    display_name: 'Erika Mustermann',
    given_name: 'Erika',
    family_name: 'Mustermann',
    birth_given_name: 'Erika',
    birth_family_name: 'Mustermann',
    birthdate: '1992-07-19',
    sex: 2,
    email: 'erika.mustermann@example.de',
    phone_number: '+498900000000',
    nationalities: ['DE'],
    place_of_birth: { locality: 'Hamburg', region: 'Hamburg', country: 'DE' },
    address: {
      street_address: 'Hafenstra\u00dfe',
      house_number: '20',
      postal_code: '20359',
      locality: 'Hamburg',
      region: 'Hamburg',
      country: 'DE',
      formatted: 'Hafenstra\u00dfe 20, 20359 Hamburg, Hamburg, DE',
    },
    personal_administrative_number: 'DE-HH-19920719-007',
    document_number: 'DE-PID-2023-228894',
    issuing_authority: 'Bundesdruckerei',
    issuing_country: 'DE',
    issuing_jurisdiction: 'DE-HH',
  },
];

const BAR_SUBJECTS: BarSpec[] = [
  {
    index: 1,
    display_name: 'Anna Schmidt',
    given_name: 'Anna',
    family_name: 'Schmidt',
    jurisdiction: 'DE',
    bar_admission_date: '2018-04-12',
    bar_admission_number: 'RAK-Muenchen-2018-04321',
    valid_until: '2030-04-12',
  },
  {
    index: 2,
    display_name: 'Klaus Weber',
    given_name: 'Klaus',
    family_name: 'Weber',
    jurisdiction: 'DE',
    bar_admission_date: '2010-09-01',
    bar_admission_number: 'RAK-Berlin-2010-01999',
    valid_until: '2030-09-01',
  },
  {
    index: 3,
    display_name: 'Lucia Romero',
    given_name: 'Lucia',
    family_name: 'Romero',
    jurisdiction: 'ES',
    bar_admission_date: '2015-06-15',
    bar_admission_number: 'ICAM-Madrid-2015-99821',
    valid_until: '2030-06-15',
  },
  {
    index: 4,
    display_name: 'Marco Bianchi',
    given_name: 'Marco',
    family_name: 'Bianchi',
    jurisdiction: 'IT',
    bar_admission_date: '2012-11-20',
    bar_admission_number: 'CNF-Milano-2012-44123',
    valid_until: '2030-11-20',
  },
  {
    index: 5,
    display_name: 'Pavel Nov\u00e1k',
    given_name: 'Pavel',
    family_name: 'Nov\u00e1k',
    jurisdiction: 'CZ',
    bar_admission_date: '2017-03-08',
    bar_admission_number: 'CAK-Praha-2017-12340',
    valid_until: '2030-03-08',
  },
];

function addrAt(index: number): Address {
  return mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: index }).address;
}

async function main() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runSchema(db);

  await ensureKey('pid');
  await ensureKey('bar');

  const upsertPid = db.prepare(`
    INSERT INTO subjects (
      eth_address, credential_type, display_name, given_name, family_name,
      birth_given_name, birth_family_name, birthdate, sex, email, phone_number,
      nationalities, place_of_birth, address_json,
      personal_administrative_number, document_number, issuing_authority,
      issuing_country, issuing_jurisdiction
    ) VALUES (
      @eth_address, 'pid', @display_name, @given_name, @family_name,
      @birth_given_name, @birth_family_name, @birthdate, @sex, @email, @phone_number,
      @nationalities, @place_of_birth, @address_json,
      @personal_administrative_number, @document_number, @issuing_authority,
      @issuing_country, @issuing_jurisdiction
    )
    ON CONFLICT(eth_address, credential_type) DO UPDATE SET
      display_name = excluded.display_name,
      given_name = excluded.given_name,
      family_name = excluded.family_name,
      birth_given_name = excluded.birth_given_name,
      birth_family_name = excluded.birth_family_name,
      birthdate = excluded.birthdate,
      sex = excluded.sex,
      email = excluded.email,
      phone_number = excluded.phone_number,
      nationalities = excluded.nationalities,
      place_of_birth = excluded.place_of_birth,
      address_json = excluded.address_json,
      personal_administrative_number = excluded.personal_administrative_number,
      document_number = excluded.document_number,
      issuing_authority = excluded.issuing_authority,
      issuing_country = excluded.issuing_country,
      issuing_jurisdiction = excluded.issuing_jurisdiction
  `);

  const upsertBar = db.prepare(`
    INSERT INTO subjects (
      eth_address, credential_type, display_name, given_name, family_name,
      jurisdiction, bar_admission_date, bar_admission_number, valid_until
    ) VALUES (
      @eth_address, 'bar', @display_name, @given_name, @family_name,
      @jurisdiction, @bar_admission_date, @bar_admission_number, @valid_until
    )
    ON CONFLICT(eth_address, credential_type) DO UPDATE SET
      display_name = excluded.display_name,
      given_name = excluded.given_name,
      family_name = excluded.family_name,
      jurisdiction = excluded.jurisdiction,
      bar_admission_date = excluded.bar_admission_date,
      bar_admission_number = excluded.bar_admission_number,
      valid_until = excluded.valid_until
  `);

  for (const s of PID_SUBJECTS) {
    upsertPid.run({
      eth_address: addrAt(s.index).toLowerCase(),
      display_name: s.display_name,
      given_name: s.given_name,
      family_name: s.family_name,
      birth_given_name: s.birth_given_name,
      birth_family_name: s.birth_family_name,
      birthdate: s.birthdate,
      sex: s.sex,
      email: s.email,
      phone_number: s.phone_number,
      nationalities: JSON.stringify(s.nationalities),
      place_of_birth: JSON.stringify(s.place_of_birth),
      address_json: JSON.stringify(s.address),
      personal_administrative_number: s.personal_administrative_number,
      document_number: s.document_number,
      issuing_authority: s.issuing_authority,
      issuing_country: s.issuing_country,
      issuing_jurisdiction: s.issuing_jurisdiction,
    });
    console.log(`  ✓ pid: ${s.display_name} (${addrAt(s.index)})`);
  }

  for (const s of BAR_SUBJECTS) {
    upsertBar.run({
      eth_address: addrAt(s.index).toLowerCase(),
      display_name: s.display_name,
      given_name: s.given_name,
      family_name: s.family_name,
      jurisdiction: s.jurisdiction,
      bar_admission_date: s.bar_admission_date,
      bar_admission_number: s.bar_admission_number,
      valid_until: s.valid_until,
    });
    console.log(`  ✓ bar: ${s.display_name} (${addrAt(s.index)})`);
  }

  console.log(`\nIssuer roster seeded at ${DB_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
