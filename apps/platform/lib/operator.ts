// Owner spec: 001-verified-legal-engagement.
// Operator-key loader. Refuses to start in production with the demo anvil[0]
// key. Used by the verifier (writes EAS attestations) and dev-bypass.

import { operatorWalletClient } from '@/lib/chain/client';
export { operatorWalletClient };
export const operatorAddress = (): string => {
  const c = operatorWalletClient();
  return c.account.address.toLowerCase();
};
