// Owner spec: 001-verified-legal-engagement.

import { notFound } from 'next/navigation';
import { requireClient } from '@/lib/auth/require-role';
import { getDb } from '@/lib/db/client';
import { getEngagement } from '@/lib/db/engagements';
import { ConsultationRoom } from '@/components/firmus/consultation-room';

export const dynamic = 'force-dynamic';

export default async function ClientConsultation({ params }: { params: { engagementId: string } }) {
  const session = await requireClient();
  const engagementId = Number(params.engagementId);
  const e = getEngagement(engagementId);
  if (!e || e.client_address !== session.address.toLowerCase()) notFound();
  const c = getDb().prepare(`SELECT * FROM consultations WHERE engagement_id = ?`).get(engagementId) as
    | { id: number; practice_area: string; duration_minutes: number; consultation_kind: 'FREE' | 'PAID'; consultation_fee_wei: string; status: string }
    | undefined;
  if (!c) notFound();

  return (
    <ConsultationRoom
      engagementId={engagementId}
      consultationId={c.id}
      role="client"
      selfAddress={session.address}
      peerAddress={e.lawyer_address}
      practiceArea={c.practice_area}
      durationMinutes={c.duration_minutes}
      consultationKind={c.consultation_kind}
      consultationFeeWei={c.consultation_fee_wei}
      status={c.status}
    />
  );
}
