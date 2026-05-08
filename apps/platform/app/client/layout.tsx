// Owner spec: 001-verified-legal-engagement.

import { requireClient } from '@/lib/auth/require-role';
import { ClientChrome } from './client-chrome';

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const session = await requireClient();
  return <ClientChrome address={session.address}>{children}</ClientChrome>;
}
