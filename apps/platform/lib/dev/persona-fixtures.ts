// Owner spec: 001-verified-legal-engagement.
// Dev-only fixtures. MUST NOT be imported anywhere under apps/platform/lib/
// outside of lib/dev/. Verified by scripts/check-feature-isolation.sh.

import { mnemonicToAccount } from 'viem/accounts';

export interface Persona {
  index: number;
  walletAddress: `0x${string}`;
  displayName: string;
  roles: Array<'client' | 'lawyer'>;
  disclosed_attrs: {
    client?: { country_of_residence: string; age_equal_or_over_18: boolean };
    lawyer?: {
      given_name: string;
      family_name: string;
      jurisdiction: string;
      bar_admission_date: string;
      bar_admission_number: string;
      valid_until: string;
    };
  };
  lawyerProfile?: {
    slug: string;
    city: string;
    headline: string;
    bio: string;
    specialties: string[];
    languages: string[];
    jurisdictions: string[];
    years_experience: number;
    consultation_type: 'FREE' | 'PAID';
    pricing_kind: 'HOURLY' | 'FIXED' | 'SUBSCRIPTION' | 'SUCCESS';
    pricing_headline: string;
    consultation_rate_30_wei: string;
    consultation_rate_60_wei: string;
    hourly_rate_wei: string;
    pricing_items: Array<{ title: string; desc: string; price: string; unit: string }>;
    tags: string[];
    availability: Record<string, unknown>;
  };
}

const MNEMONIC = process.env.ANVIL_MNEMONIC ?? '';

function addrAt(index: number): `0x${string}` {
  if (!MNEMONIC) {
    throw new Error('ANVIL_MNEMONIC missing — required for dev-bypass persona derivation');
  }
  return mnemonicToAccount(MNEMONIC, { addressIndex: index }).address;
}

const wei = (eth: number): string => (BigInt(Math.round(eth * 1e6)) * 10n ** 12n).toString();

export const PERSONAS: Persona[] = [
  {
    index: 0,
    get walletAddress() { return addrAt(0); },
    displayName: 'Platform Operator',
    roles: [],
    disclosed_attrs: {},
  },
  {
    index: 1,
    get walletAddress() { return addrAt(1); },
    displayName: 'Anna Schmidt',
    roles: ['lawyer'],
    disclosed_attrs: {
      lawyer: {
        given_name: 'Anna',
        family_name: 'Schmidt',
        jurisdiction: 'DE',
        bar_admission_date: '2018-04-12',
        bar_admission_number: 'RAK-Muenchen-2018-04321',
        valid_until: '2030-04-12',
      },
    },
    lawyerProfile: {
      slug: 'anna-schmidt',
      city: 'Munich',
      headline: 'Family & inheritance counsel for cross-border EU clients.',
      bio: 'Eight years advising international families on succession planning, prenuptial agreements, and divorce mediation. Working in German, English, and French.',
      specialties: ['Family', 'Estate'],
      languages: ['German', 'English', 'French'],
      jurisdictions: ['DE'],
      years_experience: 8,
      consultation_type: 'PAID',
      pricing_kind: 'HOURLY',
      pricing_headline: 'From 0.012 ETH per consultation',
      consultation_rate_30_wei: wei(0.012),
      consultation_rate_60_wei: wei(0.022),
      hourly_rate_wei: wei(0.05),
      pricing_items: [],
      tags: ['EU resident', 'EN/DE/FR'],
      availability: { Mon: '09-17', Tue: '09-17', Wed: '09-13', Thu: '09-17', Fri: '09-13' },
    },
  },
  {
    index: 2,
    get walletAddress() { return addrAt(2); },
    displayName: 'Carlos García',
    roles: ['lawyer'],
    disclosed_attrs: {
      lawyer: {
        given_name: 'Carlos',
        family_name: 'García',
        jurisdiction: 'ES',
        bar_admission_date: '2014-03-20',
        bar_admission_number: 'ICAM-2014-08327',
        valid_until: '2030-03-20',
      },
    },
    lawyerProfile: {
      slug: 'carlos-garcia',
      city: 'Madrid',
      headline: 'Property & business counsel for international owners.',
      bio: 'Twelve years across Spanish real-estate transactions, SL incorporation, and cross-border tax structuring. Bilingual ES/EN; fluent advising EU investors and digital nomads relocating to Spain.',
      specialties: ['Property', 'Business'],
      languages: ['Spanish', 'English'],
      jurisdictions: ['ES'],
      years_experience: 12,
      consultation_type: 'FREE',
      pricing_kind: 'HOURLY',
      pricing_headline: 'Free 30-min initial consultation',
      consultation_rate_30_wei: '0',
      consultation_rate_60_wei: wei(0.025),
      hourly_rate_wei: wei(0.06),
      pricing_items: [],
      tags: ['ES/EN', 'Free intro'],
      availability: { Mon: '10-18', Wed: '10-18', Fri: '10-14' },
    },
  },
  {
    index: 3,
    get walletAddress() { return addrAt(3); },
    displayName: 'Dieter Müller',
    roles: ['lawyer'],
    disclosed_attrs: {
      lawyer: {
        given_name: 'Dieter',
        family_name: 'Müller',
        jurisdiction: 'DE',
        bar_admission_date: '2010-11-08',
        bar_admission_number: 'RAK-Berlin-2010-01987',
        valid_until: '2030-11-08',
      },
    },
    lawyerProfile: {
      slug: 'dieter-mueller',
      city: 'Berlin',
      headline: 'Employment + immigration counsel for tech professionals.',
      bio: 'Fifteen years across German employment disputes and EU Blue Card matters. Direct, written-first, available evenings. Frequent advisor to Berlin tech employers and engineers relocating from outside the EU.',
      specialties: ['Employment', 'Immigration'],
      languages: ['German', 'English'],
      jurisdictions: ['DE'],
      years_experience: 15,
      consultation_type: 'PAID',
      pricing_kind: 'FIXED',
      pricing_headline: 'Fixed-price consultation packages',
      consultation_rate_30_wei: wei(0.018),
      consultation_rate_60_wei: wei(0.034),
      hourly_rate_wei: wei(0.08),
      pricing_items: [
        { title: 'Initial Consultation', desc: '30-60 min review', price: wei(0.018), unit: 'session' },
      ],
      tags: ['Direct', 'Tech-friendly'],
      availability: { Tue: '17-21', Wed: '17-21', Thu: '17-21' },
    },
  },
  {
    index: 4,
    get walletAddress() { return addrAt(4); },
    displayName: 'Sofia Rossi',
    roles: ['lawyer'],
    disclosed_attrs: {
      lawyer: {
        given_name: 'Sofia',
        family_name: 'Rossi',
        jurisdiction: 'IT',
        bar_admission_date: '2016-06-22',
        bar_admission_number: 'Iscrizione N. A47912 — Albo Roma',
        valid_until: '2030-06-22',
      },
    },
    lawyerProfile: {
      slug: 'sofia-rossi',
      city: 'Rome',
      headline: 'Tax + IP counsel for creative professionals.',
      bio: 'Italian + EU tax planning, trademark and copyright protection across the design and e-commerce sectors. Nine years advising freelancers, design studios, and online sellers operating in Italy and across the single market.',
      specialties: ['Tax', 'IP'],
      languages: ['Italian', 'English'],
      jurisdictions: ['IT'],
      years_experience: 9,
      consultation_type: 'PAID',
      pricing_kind: 'HOURLY',
      pricing_headline: 'From 0.015 ETH per consultation',
      consultation_rate_30_wei: wei(0.015),
      consultation_rate_60_wei: wei(0.028),
      hourly_rate_wei: wei(0.07),
      pricing_items: [],
      tags: ['IT/EN'],
      availability: { Mon: '09-17', Tue: '09-17', Thu: '09-17' },
    },
  },
  {
    index: 5,
    get walletAddress() { return addrAt(5); },
    displayName: 'Eva Novák',
    roles: ['lawyer'],
    disclosed_attrs: {
      lawyer: {
        given_name: 'Eva',
        family_name: 'Novák',
        jurisdiction: 'CZ',
        bar_admission_date: '2012-04-01',
        bar_admission_number: 'ČAK ev. č. 14302',
        valid_until: '2030-04-01',
      },
    },
    lawyerProfile: {
      slug: 'eva-novak',
      city: 'Prague',
      headline: 'Business formation & cross-border contracts.',
      bio: 'Thirteen years advising Czech startups on incorporation, partner agreements, and EU GDPR-aligned data processing terms. Frequent counsel to founders bridging the CZ market with broader EU operations.',
      specialties: ['Business', 'Estate'],
      languages: ['Czech', 'English', 'German'],
      jurisdictions: ['CZ'],
      years_experience: 13,
      consultation_type: 'PAID',
      pricing_kind: 'SUBSCRIPTION',
      pricing_headline: 'Monthly retainer plans available',
      consultation_rate_30_wei: wei(0.011),
      consultation_rate_60_wei: wei(0.020),
      hourly_rate_wei: wei(0.05),
      pricing_items: [
        { title: 'Standard retainer', desc: 'Up to 3h/mo', price: wei(0.15), unit: 'month' },
      ],
      tags: ['CZ/EN/DE'],
      availability: { Tue: '09-17', Thu: '09-17' },
    },
  },
  {
    index: 6,
    get walletAddress() { return addrAt(6); },
    displayName: 'Marta Sánchez',
    roles: ['client'],
    disclosed_attrs: {
      client: { country_of_residence: 'ES', age_equal_or_over_18: true },
    },
  },
];

export function getPersonaByIndex(index: number): Persona | undefined {
  return PERSONAS.find((p) => p.index === index);
}

export function getPersonaByAddress(address: string): Persona | undefined {
  const a = address.toLowerCase();
  return PERSONAS.find((p) => p.walletAddress.toLowerCase() === a);
}
