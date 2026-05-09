import { requireLawyerRoleOnly } from "@/lib/auth/session";

// F2: layout-level gate is role-only. Per-page gates decide whether the
// SCHEMA_LAWYER capability is required:
//   - dashboard, profile/edit, requests/, invoices/new       → requireLawyer()
//     (need capability — these surfaces represent the lawyer to clients)
//   - consultation/[bookingId], messages                     → requireLawyerForExistingBooking()
//     (role-only — mirrors the contract semantic that revoking a capability
//     does NOT touch existing engagements)
export default async function LawyerLayout({ children }: { children: React.ReactNode }) {
  await requireLawyerRoleOnly();
  return <>{children}</>;
}
