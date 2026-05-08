// Owner spec: 001-verified-legal-engagement.

import { requireLawyer } from '@/lib/auth/require-role';
import { LawyerChrome } from './lawyer-chrome';

export default async function LawyerLayout({ children }: { children: React.ReactNode }) {
  const session = await requireLawyer();
  return <LawyerChrome address={session.address}>{children}</LawyerChrome>;
}
