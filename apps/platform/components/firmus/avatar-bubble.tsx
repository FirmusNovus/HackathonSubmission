// Owner spec: 001-verified-legal-engagement.

import { cn } from '@/lib/utils';

const SIZE_PX = { 32: 32, 56: 56, 64: 64, 80: 80, 96: 96 } as const;

interface Props {
  name: string;
  imageUrl?: string | null;
  size?: keyof typeof SIZE_PX;
  verified?: boolean;
  className?: string;
}

export function AvatarBubble({ name, imageUrl, size = 64, verified = true, className }: Props) {
  const px = SIZE_PX[size];
  const initials = initialsOf(name);
  return (
    <div
      className={cn(
        'inline-flex items-center justify-center overflow-hidden rounded-full bg-slate-50 text-navy-900 font-medium',
        verified && 'ring-2 ring-gold-500',
        className,
      )}
      style={{ width: px, height: px, fontSize: Math.max(11, Math.round(px * 0.4)) }}
    >
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt={name} className="h-full w-full object-cover" />
      ) : (
        <span aria-hidden>{initials}</span>
      )}
      <span className="sr-only">{name}</span>
    </div>
  );
}

function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}
