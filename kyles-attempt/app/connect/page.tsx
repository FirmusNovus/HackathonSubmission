import { AuthShell } from "@/components/layout/auth-shell";
import { ConnectFlow } from "./connect-flow";

// Demo controls (mock identity picker, fake EUDI shortcut) are visible in
// real dev OR when the Playwright webServer flips ENABLE_MOCK_AUTH on. Same
// guard as /dev/sign-in so the two stay in lockstep.
const showDemoControls =
  process.env.NODE_ENV !== "production" || process.env.ENABLE_MOCK_AUTH === "true";

export default function ConnectPage() {
  return (
    <AuthShell escapeHref="/">
      <ConnectFlow showDemoControls={showDemoControls} />
    </AuthShell>
  );
}
