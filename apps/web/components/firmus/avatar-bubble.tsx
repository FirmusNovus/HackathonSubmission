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
  const safeName = name ?? "";
  const initials =
    safeName
      .split(/\s+/)
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("") || "?";
  // Empty / single-char names produce NaN under the original modulo trick and
  // fall through to GRADIENTS[NaN] = undefined → destructuring throws.
  const c0 = safeName.charCodeAt(0);
  const c1 = safeName.charCodeAt(1);
  const seed = (Number.isFinite(c0) ? c0 : 0) + (Number.isFinite(c1) ? c1 : 0);
  const idx = seed % GRADIENTS.length;
  const [a, b] = GRADIENTS[idx] ?? GRADIENTS[0];
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
          className="absolute bottom-0 right-0 inline-flex items-center justify-center rounded-full bg-white p-px shadow-[0_1px_3px_rgba(10,31,68,0.2)]"
          style={{ width: ss, height: ss }}
        >
          <EBSIBadge variant="seal" size={ss - 2} />
        </span>
      )}
    </div>
  );
}
