// SD-JWT VC parsing helpers.
// Owner spec: 001-verified-legal-engagement.

import { decodeJwt, decodeProtectedHeader } from 'jose';

export interface SdJwtParts {
  jws: string;
  disclosures: string[];
  kbJwt?: string;
}

export interface ParsedSdJwt {
  parts: SdJwtParts;
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  disclosed: Record<string, unknown>;
}

export function splitSdJwt(serialized: string): SdJwtParts {
  const segments = serialized.split('~');
  if (segments.length < 1) throw new Error('sd-jwt: invalid serialization');
  const jws = segments[0]!;
  // The last segment may be a key-binding JWT. SD-JWT serialization always ends
  // with a `~`, so the array's last element is empty unless KB is present.
  const last = segments[segments.length - 1];
  const hasKb = last && last.length > 0;
  const kbJwt = hasKb ? last : undefined;
  const disclosures = segments.slice(1, hasKb ? segments.length - 1 : segments.length).filter(Boolean);
  return { jws, disclosures, kbJwt };
}

export function parseSdJwt(serialized: string): ParsedSdJwt {
  const parts = splitSdJwt(serialized);
  const header = decodeProtectedHeader(parts.jws) as Record<string, unknown>;
  const payload = decodeJwt(parts.jws) as Record<string, unknown>;
  const disclosed = applyDisclosures(payload, parts.disclosures);
  return { parts, header, payload, disclosed };
}

function applyDisclosures(
  payload: Record<string, unknown>,
  disclosures: string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = JSON.parse(JSON.stringify(payload));
  for (const d of disclosures) {
    try {
      const decoded = JSON.parse(Buffer.from(d, 'base64url').toString('utf-8')) as unknown[];
      // Disclosure shape: [salt, key, value] for object claims, [salt, value] for arrays.
      if (decoded.length === 3) {
        const [, key, value] = decoded as [string, string, unknown];
        result[key] = value;
      }
    } catch {
      // Ignore malformed disclosures — verification step will catch real issues.
    }
  }
  return result;
}
