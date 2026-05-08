// Owner spec: 001-verified-legal-engagement.
// Helpers for the two EAS schema UIDs.

import { SCHEMA_LAWYER, SCHEMA_CLIENT } from './contracts';

export { SCHEMA_LAWYER, SCHEMA_CLIENT };

export type AttestedRole = 'client' | 'lawyer';

export function schemaIdForRole(role: AttestedRole): `0x${string}` {
  return role === 'lawyer' ? SCHEMA_LAWYER : SCHEMA_CLIENT;
}
