import { requireClient } from "@/lib/auth/session";

// All /client/* routes require an authenticated client. Each page renders its own
// AppTopBar so views like the consultation room can flip into dark mode.
export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  await requireClient();
  return <>{children}</>;
}
