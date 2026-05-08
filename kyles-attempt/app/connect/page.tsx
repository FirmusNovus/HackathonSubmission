import { AuthShell } from "@/components/layout/auth-shell";
import { ConnectFlow } from "./connect-flow";

export default function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  return (
    <AuthShell escapeHref="/">
      <ConnectFlowAsync searchParams={searchParams} />
    </AuthShell>
  );
}

async function ConnectFlowAsync({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const sp = await searchParams;
  const initialRole = sp.role === "lawyer" ? "lawyer" : "client";
  return <ConnectFlow initialRole={initialRole} />;
}
