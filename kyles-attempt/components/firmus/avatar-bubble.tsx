import { EBSIBadge } from "./ebsi-badge";

const GRADIENTS = [
  ["#1A3666", "#0A1F44"],
  ["#2C5F5D", "#14B8A6"],
  ["#3D2C5C", "#5B4587"],
  ["#5C3D2C", "#9C7E3F"],
  ["#2C3E50", "#5B6B7C"],
  ["#1A4C56", "#0E9488"],
] as const;

interface AvatarBubbleProps {
  name: string;
  size?: number;
  verified?: boolean;
  sealSize?: number;
}

export function AvatarBubble({ name, size = 48, verified, sealSize }: AvatarBubbleProps) {
  const initials =
    name
      .split(/\s+/)
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("") || "?";
  const idx = (name.charCodeAt(0) + (name.charCodeAt(1) || 0)) % GRADIENTS.length;
  const [a, b] = GRADIENTS[idx];
  const ss = sealSize ?? Math.round(size * 0.34);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div
        aria-hidden
        className="font-display flex items-center justify-center rounded-full text-white"
        style={{
          width: size,
          height: size,
          background: `linear-gradient(135deg, ${a}, ${b})`,
          fontWeight: 500,
          fontSize: Math.round(size * 0.36),
        }}
      >
        {initials}
      </div>
      {verified && (
        <span
          className="absolute -bottom-0.5 -right-0.5 rounded-full bg-white p-px shadow-[0_1px_3px_rgba(10,31,68,0.2)]"
          style={{ width: ss, height: ss }}
        >
          <EBSIBadge variant="seal" size={ss - 2} />
        </span>
      )}
    </div>
  );
}
