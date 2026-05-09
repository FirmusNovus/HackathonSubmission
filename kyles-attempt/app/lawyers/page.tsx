import { Prisma, PricingKind, VerificationStatus } from "@prisma/client";
import { Search } from "lucide-react";
import { prisma } from "@/lib/db/client";
import { MarketingNav } from "@/components/layout/marketing-nav";
import { Footer } from "@/components/layout/footer";
import { LawyerCard } from "@/components/firmus/lawyer-card";
import { EmptyState } from "@/components/firmus/empty-state";
import { Input } from "@/components/ui/input";
import { DirectoryFilters } from "./directory-filters";

export const dynamic = "force-dynamic";

interface SP {
  q?: string;
  practice?: string | string[];
  lang?: string | string[];
  pricing?: string | string[];
}

function asArray(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

export default async function LawyerDirectoryPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const practice = asArray(sp.practice);
  const langs = asArray(sp.lang);
  const pricingKinds = asArray(sp.pricing).filter((k): k is PricingKind => k in PricingKind);

  const where: Prisma.LawyerProfileWhereInput = { verificationStatus: VerificationStatus.VERIFIED };
  if (practice.length) where.tags = { hasSome: practice };
  if (langs.length) where.languages = { hasSome: langs };
  if (pricingKinds.length) where.pricingKind = { in: pricingKinds };
  if (q)
    where.OR = [
      { headline: { contains: q, mode: "insensitive" } },
      { bio: { contains: q, mode: "insensitive" } },
      { user: { name: { contains: q, mode: "insensitive" } } },
    ];

  const lawyers = await prisma.lawyerProfile.findMany({
    where,
    include: { user: true },
    orderBy: [{ rating: "desc" }, { reviewCount: "desc" }],
  });

  return (
    <>
      <MarketingNav active="lawyers" />
      <section className="border-b border-slate-100 px-6 pb-6 pt-14 lg:px-12">
        <div className="mx-auto max-w-[1280px]">
          <h1 className="font-display text-4xl text-navy-900 sm:text-5xl lg:text-[56px]">Find your lawyer.</h1>
          <p className="mt-3 max-w-[580px] text-[17px] text-slate-500">
            614 EBSI-verified lawyers across 27 EU jurisdictions. All credentials on-chain.
          </p>
          <form className="mt-7 max-w-[720px]">
            <label htmlFor="search" className="sr-only">
              Search lawyers
            </label>
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" aria-hidden />
              <Input
                id="search"
                name="q"
                defaultValue={q}
                placeholder="Describe your legal issue or search by name."
                className="h-14 pl-11 text-base"
              />
            </div>
          </form>
        </div>
      </section>

      <section className="px-6 pb-20 pt-8 lg:px-12">
        <div className="mx-auto grid max-w-[1280px] gap-10 lg:grid-cols-[260px_1fr]">
          <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
            <DirectoryFilters
              activePractice={practice}
              activeLangs={langs}
              activePricing={pricingKinds}
              q={q}
            />
          </aside>

          <main>
            <div className="mb-6 flex items-center justify-between">
              <span className="text-[14px] text-slate-500">
                <strong className="font-semibold text-navy-900">{lawyers.length} lawyers</strong> match your filters
              </span>
            </div>
            {lawyers.length === 0 ? (
              <EmptyState
                title="No lawyers match those filters."
                body="Try widening the practice areas or removing a language filter."
                ctaLabel="Clear filters"
                ctaHref="/lawyers"
              />
            ) : (
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                {lawyers.map((l) => (
                  <LawyerCard key={l.id} lawyer={l} />
                ))}
              </div>
            )}
          </main>
        </div>
      </section>
      <Footer />
    </>
  );
}
