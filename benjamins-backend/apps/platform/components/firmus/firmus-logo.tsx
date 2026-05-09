import { cn } from "@/lib/utils";

interface FirmusLogoProps {
  size?: number;
  light?: boolean;
  className?: string;
  label?: string;
}

export function FirmusLogoMark({ size = 28, light = false }: FirmusLogoProps) {
  const navy = light ? "#E8EDF4" : "#0A1F44";
  const teal = "#14B8A6";
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <circle cx="6" cy="8" r="2.5" fill={teal} />
      <circle cx="6" cy="24" r="2.5" fill={navy} />
      <circle cx="26" cy="8" r="2.5" fill={navy} />
      <circle cx="26" cy="24" r="2.5" fill={teal} />
      <path
        d="M6 8 L6 24 L26 8 L26 24"
        stroke={navy}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function FirmusLogo({ size = 22, light = false, className, label = "Lex Nova" }: FirmusLogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <FirmusLogoMark size={size + 6} light={light} />
      <span
        className="font-display"
        style={{
          fontWeight: 500,
          fontSize: size,
          letterSpacing: "0.3px",
          color: light ? "#E8EDF4" : "#0A1F44",
          lineHeight: 1,
        }}
      >
        {label}
      </span>
    </span>
  );
}
