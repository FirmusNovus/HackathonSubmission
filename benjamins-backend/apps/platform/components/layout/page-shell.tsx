import { cn } from "@/lib/utils";

/** Centered, padded page container used by every non-landing page. */
export function PageShell({
  children,
  className,
  width = "narrow",
}: {
  children: React.ReactNode;
  className?: string;
  width?: "narrow" | "wide" | "full";
}) {
  const widthClass =
    width === "full" ? "max-w-[1180px]" : width === "wide" ? "max-w-5xl" : "max-w-3xl";
  return (
    <div className={cn("mx-auto px-6 py-12 lg:px-12", widthClass, className)}>{children}</div>
  );
}

interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
}

export function PageHeader({ eyebrow, title, description }: PageHeaderProps) {
  return (
    <header className="mb-10">
      {eyebrow && (
        <span className="text-[12px] font-medium uppercase tracking-[0.14em] text-teal-600">
          {eyebrow}
        </span>
      )}
      <h1 className="font-display mt-2 text-[40px] leading-[1.05] text-navy-900 sm:text-5xl">
        {title}
      </h1>
      {description && (
        <p className="mt-4 max-w-prose text-[15px] leading-relaxed text-slate-500">
          {description}
        </p>
      )}
    </header>
  );
}
