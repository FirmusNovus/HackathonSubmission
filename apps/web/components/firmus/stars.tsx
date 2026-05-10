/** Star rating in teal, per design spec (never yellow). */
export function Stars({ value, size = 13 }: { value: number; size?: number }) {
  return (
    <span
      className="inline-flex items-center gap-1 font-medium text-teal-500"
      style={{ fontSize: size }}
    >
      <span aria-hidden style={{ fontSize: size + 1, lineHeight: 1 }}>
        ★
      </span>
      <span>{value.toFixed(1)}</span>
    </span>
  );
}
