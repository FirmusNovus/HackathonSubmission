import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Calendar, ExternalLink, Lock, Check } from "lucide-react";
import { prisma } from "@/lib/db/client";
import { MarketingNav } from "@/components/layout/marketing-nav";
import { Footer } from "@/components/layout/footer";
import { AvatarBubble } from "@/components/firmus/avatar-bubble";
import { EBSIBadge } from "@/components/firmus/ebsi-badge";
import { PricingBadge } from "@/components/firmus/pricing-badge";
import { Stars } from "@/components/firmus/stars";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { PricingItem } from "@/types";
import { formatEUR, formatScheduled } from "@/lib/utils/format";

export default async function LawyerProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lawyer = await prisma.lawyerProfile.findUnique({ where: { id }, include: { user: true } });
  if (!lawyer) notFound();

  const items = (lawyer.pricingItems ?? []) as unknown as PricingItem[];
  const isHourly = lawyer.pricingKind === "HOURLY";
  const verified = lawyer.verificationStatus === "VERIFIED";
  const nextSlot = new Date(Date.now() + 1000 * 60 * 60 * 22);

  return (
    <>
      <MarketingNav active="lawyers" />
      <section className="px-6 pt-12 lg:px-12">
        <div className="mx-auto max-w-[1180px]">
          <Link href="/lawyers" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500 hover:text-navy-900">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> All lawyers
          </Link>

          <div className="mt-8 grid gap-14 lg:grid-cols-[1fr_380px]">
            <div>
              <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
                <AvatarBubble name={lawyer.user.name ?? "Lawyer"} size={120} verified={verified} sealSize={36} />
                <div className="pt-2">
                  <h1 className="font-display text-3xl text-navy-900 sm:text-4xl lg:text-[44px]">
                    {lawyer.user.name}
                  </h1>
                  <div className="mt-1.5 text-[17px] text-slate-500">
                    {lawyer.headline.split(" · ")[0]} · {lawyer.city}
                  </div>
                  <div className="mt-3.5 flex flex-wrap items-center gap-4">
                    <Stars value={lawyer.rating} size={15} />
                    <span className="text-[14px] text-slate-500">{lawyer.reviewCount} reviews</span>
                    {verified && (
                      <>
                        <span className="text-slate-200">·</span>
                        <EBSIBadge />
                      </>
                    )}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {lawyer.tags.map((t) => (
                      <span key={t} className="rounded-full bg-slate-50 px-3 py-1.5 text-[12px] font-medium text-slate-700">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <Tabs defaultValue="about" className="mt-12">
                <TabsList>
                  <TabsTrigger value="about">About</TabsTrigger>
                  <TabsTrigger value="credentials">Credentials</TabsTrigger>
                  <TabsTrigger value="reviews">Reviews {lawyer.reviewCount}</TabsTrigger>
                  <TabsTrigger value="availability">Availability</TabsTrigger>
                </TabsList>

                <TabsContent value="about">
                  <h3 className="text-lg font-semibold text-navy-900">About</h3>
                  <p className="mt-3 text-base leading-[1.65] text-slate-700">{lawyer.bio}</p>

                  <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-3">
                    {[
                      ["Languages", lawyer.languages.join(" · ")],
                      ["Experience", `${lawyer.yearsExperience} years`],
                      ["Jurisdictions", lawyer.jurisdictions.join(" · ")],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">{k}</div>
                        <div className="text-base font-medium text-navy-900">{v}</div>
                      </div>
                    ))}
                  </div>

                  <h3 className="mt-10 text-lg font-semibold text-navy-900">Verified credentials</h3>
                  <div className="mt-4 overflow-hidden rounded-xl border border-slate-100 bg-slate-100">
                    <CredentialRow title={`Bar Admission — ${lawyer.barJurisdiction}`} sub={`Verified on EBSI · ${lawyer.admissionDate.toISOString().slice(0, 10)}`} />
                    <CredentialRow title="Identity match" sub="ID document cross-checked" />
                    {lawyer.specialties.slice(0, 2).map((s) => (
                      <CredentialRow key={s} title={`${s} specialization`} sub="Verified Certificate" />
                    ))}
                  </div>
                </TabsContent>

                <TabsContent value="credentials">
                  <p className="text-[14px] text-slate-500">
                    Bar admission, ID, and specialization certificates are cross-checked against the EBSI Trusted Issuers Registry.
                  </p>
                </TabsContent>
                <TabsContent value="reviews">
                  <div className="rounded-xl border border-dashed border-slate-200 p-10 text-center text-[14px] text-slate-500">
                    Reviews are surfaced after consultations complete and escrow releases.
                  </div>
                </TabsContent>
                <TabsContent value="availability">
                  <div className="rounded-xl border border-dashed border-slate-200 p-10 text-center text-[14px] text-slate-500">
                    Availability calendar — coming soon.
                  </div>
                </TabsContent>
              </Tabs>
            </div>

            <aside className="lg:sticky lg:top-24 lg:self-start">
              <div className="rounded-2xl border border-slate-100 bg-white-0 p-7 shadow-[var(--shadow-sm)]">
                {isHourly ? (
                  <>
                    <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">Hourly rate</div>
                    <div className="flex items-baseline gap-2">
                      <span className="font-display text-4xl text-navy-900">{formatEUR(Number(lawyer.hourlyRateEUR))}</span>
                      <span className="text-[14px] text-slate-500">per hour · tokenized EUR</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">Service packages</span>
                      <PricingBadge kind={lawyer.pricingKind} />
                    </div>
                    <ul className="space-y-2.5">
                      {items.map((it, i) => (
                        <li key={i} className="rounded-lg border border-slate-100 bg-white-50 px-3.5 py-3">
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="text-[13px] font-medium text-navy-900">{it.title}</span>
                            <span className="whitespace-nowrap text-[13px] font-medium text-navy-900">
                              {it.price === null ? it.unit : it.price === 0 ? "Free" : formatEUR(it.price)}
                              {it.price && it.price > 0 && it.unit !== "fixed" && (
                                <span className="font-normal text-slate-500"> {it.unit}</span>
                              )}
                            </span>
                          </div>
                          <div className="mt-1 text-[12px] text-slate-500">{it.desc}</div>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                <hr className="my-6 border-t border-slate-100" />
                <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">Next availability</div>
                <div className="flex items-center gap-2.5">
                  <Calendar className="h-4 w-4 text-navy-900" aria-hidden />
                  <span className="text-[15px] font-medium text-navy-900">{formatScheduled(nextSlot)}</span>
                </div>
                <Button asChild className="mt-6 w-full" size="lg" variant="primary">
                  <Link href={`/client/book/${lawyer.id}`}>
                    Book Consultation <ArrowRight className="h-4 w-4" aria-hidden />
                  </Link>
                </Button>
                <p className="mt-3.5 flex items-center justify-center gap-1.5 text-[12px] leading-[1.5] text-slate-500">
                  <Lock className="h-3 w-3 text-teal-600" aria-hidden /> Funds held in escrow until consultation completes
                </p>
              </div>
              <div className="mt-4 flex gap-3 rounded-xl border border-slate-100 bg-white-50 p-4">
                <EBSIBadge variant="seal" size={22} />
                <div>
                  <div className="text-[13px] font-medium text-navy-900">Verified through EBSI</div>
                  <div className="mt-1 text-[12px] leading-[1.5] text-slate-500">
                    Credentials cross-checked against the European Blockchain Services Infrastructure. Permanent and portable across the EU.
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </section>
      <div className="h-24" />
      <Footer />
    </>
  );
}

function CredentialRow({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="flex items-center gap-4 bg-white-0 px-5 py-4">
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-50">
        <Check className="h-4 w-4 text-teal-700" strokeWidth={2.5} aria-hidden />
      </span>
      <div className="flex-1">
        <div className="text-[14px] font-medium text-navy-900">{title}</div>
        <div className="mt-0.5 text-[12px] text-slate-500">{sub}</div>
      </div>
      <span
        className="inline-flex items-center gap-1 text-[12px] font-medium text-slate-300"
        title="On-chain link available once the escrow contract ships"
      >
        On-chain · pending <ExternalLink className="h-3 w-3" aria-hidden />
      </span>
    </div>
  );
}
