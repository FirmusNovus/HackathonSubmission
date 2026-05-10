import { requireLawyer } from "@/lib/auth/session";

export default async function LawyerLayout({ children }: { children: React.ReactNode }) {
  await requireLawyer();
  return <>{children}</>;
}
