import { Lock, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";

type Stage = "idle" | "funded" | "released";

interface Props {
  stage?: Stage;
  className?: string;
}

/**
 * "You → Smart Contract → Lawyer" visual. Active stage gets the teal accent;
 * subsequent stages stay slate.
 */
export function EscrowStatusIndicator({ stage = "funded", className }: Props) {
  const youOn = stage !== "idle";
  const contractOn = stage !== "idle";
  const lawyerOn = stage === "released";

  return (
    <div
      className={cn(
        "flex items-stretch gap-0 rounded-xl border border-slate-100 bg-white-0 p-4",
        className,
      )}
      role="img"
      aria-label="Escrow flow: client funds the smart contract, which releases to the lawyer on completion."
    >
      <Node label="You" sub="Client wallet" on={youOn} />
      <Connector on={youOn && contractOn} />
      <Node label="Smart contract" sub="Funds held in escrow" on={contractOn} icon={<Lock className="h-4 w-4" aria-hidden />} highlight />
      <Connector on={lawyerOn} />
      <Node label="Lawyer" sub="On consultation complete" on={lawyerOn} />
    </div>
  );
}

function Node({
  label,
  sub,
  on,
  highlight,
  icon,
}: {
  label: string;
  sub: string;
  on: boolean;
  highlight?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center text-center">
      <div
        className={cn(
          "flex h-10 w-10 items-center justify-center rounded-full border-2 transition-colors",
          highlight && on ? "border-teal-500 bg-teal-50 text-teal-600" : on ? "border-navy-900 bg-navy-900/5 text-navy-900" : "border-slate-100 text-slate-300",
        )}
      >
        {icon ?? <span className="text-[13px] font-semibold">{label[0]}</span>}
      </div>
      <div className={cn("mt-2 text-[12px] font-medium", on ? "text-navy-900" : "text-slate-300")}>{label}</div>
      <div className="text-[11px] text-slate-500">{sub}</div>
    </div>
  );
}

function Connector({ on }: { on: boolean }) {
  return (
    <div className="flex flex-1 items-center justify-center pt-5">
      <ArrowRight className={cn("h-4 w-4 transition-colors", on ? "text-teal-500" : "text-slate-200")} aria-hidden />
    </div>
  );
}
