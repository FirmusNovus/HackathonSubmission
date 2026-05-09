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
    place_of_birth: { locality: 'M\u00fcnchen', region: 'Bayern', country: 'DE' },
    address: {
      street_address: 'Maximilianstra\u00dfe',
      house_number: '12',
      postal_code: '80539',
      locality: 'M\u00fcnchen',
      region: 'Bayern',
      country: 'DE',
      formatted: 'Maximilianstra\u00dfe 12, 80539 M\u00fcnchen, Bayern, DE',
    },
    personal_administrative_number: 'DE-A-19850412-0001',
    document_number: 'DE-PID-2023-887421',
    issuing_authority: 'Bundesdruckerei',
    issuing_country: 'DE',
    issuing_jurisdiction: 'DE-BY',
  },
  {
    index: 2,
    display_name: 'Carlos Garc\u00eda',
    given_name: 'Carlos',
    family_name: 'Garc\u00eda',
    birth_given_name: 'Carlos',
    birth_family_name: 'Garc\u00eda',
    birthdate: '1981-07-08',
    sex: 1,
    email: 'carlos.garcia@garcia-abogados.es',
    phone_number: '+34915557788',
    nationalities: ['ES'],
    place_of_birth: { locality: 'Madrid', region: 'Comunidad de Madrid', country: 'ES' },
    address: {
      street_address: 'Calle de Serrano',
      house_number: '47',
      postal_code: '28001',
      locality: 'Madrid',
      region: 'Comunidad de Madrid',
      country: 'ES',
      formatted: 'Calle de Serrano 47, 28001 Madrid, Comunidad de Madrid, ES',
    },
    personal_administrative_number: 'ES-A-19810708-0073',
    document_number: 'ES-PID-2022-115502',
    issuing_authority: 'Ministerio del Interior',
    issuing_country: 'ES',
    issuing_jurisdiction: 'ES-MD',
  },
  {
    index: 3,
    display_name: 'Dieter M\u00fcller',
    given_name: 'Dieter',
    family_name: 'M\u00fcller',
    birth_given_name: 'Dieter',
    birth_family_name: 'M\u00fcller',
    birthdate: '1976-11-23',
    sex: 1,
    email: 'dieter.mueller@gdpr-mueller.de',
    phone_number: '+493012345001',
    nationalities: ['DE'],
    place_of_birth: { locality: 'Berlin', region: 'Berlin', country: 'DE' },
    address: {
      street_address: 'Unter den Linden',
      house_number: '44',
      postal_code: '10117',
      locality: 'Berlin',
      region: 'Berlin',
      country: 'DE',
      formatted: 'Unter den Linden 44, 10117 Berlin, Berlin, DE',
    },
    personal_administrative_number: 'DE-B-19761123-0042',
    document_number: 'DE-PID-2022-441208',
    issuing_authority: 'Bundesdruckerei',
    issuing_country: 'DE',
    issuing_jurisdiction: 'DE-BE',
  },
  {
    index: 4,
    display_name: 'Sofia Rossi',
    given_name: 'Sofia',
    family_name: 'Rossi',
    birth_given_name: 'Sofia',
    birth_family_name: 'Rossi',
    birthdate: '1988-02-14',
    sex: 2,
    email: 'sofia.rossi@studiolegale-rossi.it',
    phone_number: '+390652207788',
    nationalities: ['IT'],
    place_of_birth: { locality: 'Roma', region: 'Lazio', country: 'IT' },
    address: {
      street_address: 'Via del Corso',
      house_number: '112',
      postal_code: '00186',
      locality: 'Roma',
      region: 'Lazio',
      country: 'IT',
      formatted: 'Via del Corso 112, 00186 Roma, Lazio, IT',
    },
    personal_administrative_number: 'IT-A-19880214-0089',
    document_number: 'IT-CIE-2023-RM-554210',
    issuing_authority: 'Ministero dell\u2019Interno',
    issuing_country: 'IT',
    issuing_jurisdiction: 'IT-RM',
  },
  {
    index: 5,
    display_name: 'Eva Nov\u00e1k',
    given_name: 'Eva',
    family_name: 'Nov\u00e1k',
    birth_given_name: 'Eva',
    birth_family_name: 'Nov\u00e1k',
    birthdate: '1983-09-30',
    sex: 2,
    email: 'eva.novak@novak-pravo.cz',
    phone_number: '+420224567890',
    nationalities: ['CZ'],
    place_of_birth: { locality: 'Praha', region: 'Hlavn\u00ed m\u011bsto Praha', country: 'CZ' },
    address: {
      street_address: 'N\u00e1rodn\u00ed t\u0159\u00edda',
      house_number: '26',
      postal_code: '11000',
      locality: 'Praha 1',
      region: 'Hlavn\u00ed m\u011bsto Praha',
      country: 'CZ',
      formatted: 'N\u00e1rodn\u00ed t\u0159\u00edda 26, 11000 Praha 1, Hlavn\u00ed m\u011bsto Praha, CZ',
    },
    personal_administrative_number: 'CZ-A-19830930-0017',
    document_number: 'CZ-OP-2024-PR-883104',
    issuing_authority: 'Ministerstvo vnitra',
    issuing_country: 'CZ',
    issuing_jurisdiction: 'CZ-PR',
  },
  {
    index: 6,
    display_name: 'Marta S\u00e1nchez',
    given_name: 'Marta',
    family_name: 'S\u00e1nchez',
    birth_given_name: 'Marta',
    birth_family_name: 'S\u00e1nchez',
    birthdate: '1991-04-22',
    sex: 2,
    email: 'marta.sanchez@founderstartup.es',
    phone_number: '+34910123456',
    nationalities: ['ES'],
    place_of_birth: { locality: 'Barcelona', region: 'Catalunya', country: 'ES' },
    address: {
      street_address: 'Carrer de Bail\u00e8n',
      house_number: '5',
      postal_code: '08010',
      locality: 'Barcelona',
      region: 'Catalunya',
      country: 'ES',
      formatted: 'Carrer de Bail\u00e8n 5, 08010 Barcelona, Catalunya, ES',
    },
    personal_administrative_number: 'ES-A-19910422-0042',
    document_number: 'ES-PID-2023-887422',
    issuing_authority: 'Ministerio del Interior',
    issuing_country: 'ES',
    issuing_jurisdiction: 'ES-CT',
  },
];

const BAR_SUBJECTS: BarSpec[] = [
  {
    index: 1,
    display_name: 'Anna Schmidt',
    given_name: 'Anna',
    family_name: 'Schmidt',
    jurisdiction: 'DE',
    bar_admission_date: '2018-09-15',
    bar_admission_number: 'RAK-Muenchen-2018-04321',
    valid_until: '2030-09-15',
  },
  {
    index: 2,
    display_name: 'Carlos Garc\u00eda',
    given_name: 'Carlos',
    family_name: 'Garc\u00eda',
    jurisdiction: 'ES',
    bar_admission_date: '2014-03-20',
    bar_admission_number: 'ICAM-2014-08327',
    valid_until: '2030-03-20',
  },
  {
    index: 3,
    display_name: 'Dieter M\u00fcller',
    given_name: 'Dieter',
    family_name: 'M\u00fcller',
    jurisdiction: 'DE',
    bar_admission_date: '2010-11-08',
    bar_admission_number: 'RAK-Berlin-2010-01987',
    valid_until: '2030-11-08',
  },
  {
    index: 4,
    display_name: 'Sofia Rossi',
    given_name: 'Sofia',
    family_name: 'Rossi',
    jurisdiction: 'IT',
    bar_admission_date: '2016-06-22',
    bar_admission_number: 'Iscrizione N. A47912 \u2014 Albo Roma',
    valid_until: '2030-06-22',
  },
  {
    index: 5,
    display_name: 'Eva Nov\u00e1k',
    given_name: 'Eva',
    family_name: 'Nov\u00e1k',
    jurisdiction: 'CZ',
    bar_admission_date: '2012-04-01',
    bar_admission_number: '\u010cAK ev. \u010d. 14302',
    valid_until: '2030-04-01',
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
