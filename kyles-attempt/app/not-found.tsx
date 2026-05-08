import Link from "next/link";
import { MarketingNav } from "@/components/layout/marketing-nav";
import { Footer } from "@/components/layout/footer";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <>
      <MarketingNav />
      <main className="mx-auto flex max-w-[600px] flex-col items-center px-6 py-32 text-center">
        <h1 className="font-display text-5xl text-navy-900">Page not found.</h1>
        <p className="mt-4 text-[15px] text-slate-500">
          The page you're looking for has moved or doesn't exist.
        </p>
        <Button asChild className="mt-8">
          <Link href="/">Back to home</Link>
        </Button>
      </main>
      <Footer />
    </>
  );
}
