'use client';
// Owner spec: 001-verified-legal-engagement.

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

export function LogoutButton() {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={async () => {
        await fetch('/api/auth/siwe/logout', { method: 'POST' });
        router.push('/');
        router.refresh();
      }}
    >
      Log out
    </Button>
  );
}
