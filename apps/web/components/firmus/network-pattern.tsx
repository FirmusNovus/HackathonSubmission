/** Low-opacity teal node pattern used as the hero / onboarding card background. */
export function NetworkPattern({ opacity = 0.5 }: { opacity?: number }) {
  return (
    <div
      aria-hidden
      className="firmus-pattern-drift pointer-events-none absolute inset-0"
      style={{
        opacity,
        backgroundImage: `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`,
        backgroundSize: "200px 200px",
      }}
    />
  );
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
<g stroke="#14B8A6" stroke-width="0.6" stroke-opacity="0.18" fill="#14B8A6" fill-opacity="0.12">
  <circle cx="20" cy="20" r="2"/>
  <circle cx="100" cy="40" r="1.6"/>
  <circle cx="180" cy="20" r="2"/>
  <circle cx="60" cy="100" r="1.8"/>
  <circle cx="140" cy="100" r="2.2"/>
  <circle cx="20" cy="180" r="2"/>
  <circle cx="100" cy="160" r="1.6"/>
  <circle cx="180" cy="180" r="2"/>
  <line x1="20" y1="20" x2="100" y2="40"/>
  <line x1="100" y1="40" x2="180" y2="20"/>
  <line x1="20" y1="20" x2="60" y2="100"/>
  <line x1="180" y1="20" x2="140" y2="100"/>
  <line x1="60" y1="100" x2="140" y2="100"/>
  <line x1="60" y1="100" x2="20" y2="180"/>
  <line x1="140" y1="100" x2="180" y2="180"/>
  <line x1="20" y1="180" x2="100" y2="160"/>
  <line x1="100" y1="160" x2="180" y2="180"/>
</g>
</svg>`;
