"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";

/**
 * Server already determined the right role from the chain — this just pushes
 * it into the JWT via the next-auth "update" trigger and navigates onward.
 * We use window.location (not router.replace) so the new cookie is the one
 * read by the next page's middleware, not a stale RSC payload.
 */
export function SyncRoleClient({ desiredRole, to }: { desiredRole: "CLIENT" | "LAWYER"; to: string }) {
  const { update } = useSession();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    (async () => {
      try {
        await update({ role: desiredRole });
      } catch {
        // If update fails, the next-page middleware will bounce back here and
        // we'll loop. Better to send the user somewhere safe to break out.
        window.location.href = "/api/auth/signout?callbackUrl=/";
        return;
      }
      window.location.href = to;
    })();
  }, [update, desiredRole, to]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-white-50">
      <div className="text-center text-[14px] text-slate-500">
        <span aria-hidden className="mx-auto mb-3 block h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-teal-500" />
        Syncing your session…
      </div>
    </div>
  );
}
