import { Check } from "lucide-react";
import { PricingKind } from "@/lib/db/enums";
import { cn } from "@/lib/utils/cn";

// Server component. Filters are a real HTML form with `method=GET action=/lawyers`,
// auto-submitted on every change via a tiny vanilla-JS listener. Works regardless
// of React hydration state.

const PRACTICE_AREAS = [
  "Family",
  "Estate",
  "Property",
  "Real Estate",
  "Employment",
  "Labor",
  "Immigration",
  "Business",
  "Corporate",
  "Tax",
  "IP",
  "Trademark",
  "GDPR",
  "EU Law",
];

const LANGS = ["English", "French", "German", "Spanish", "Italian", "Swedish", "Polish", "Dutch", "Czech", "Danish"];

const PRICING_OPTIONS: Array<{ value: PricingKind; label: string }> = [
  { value: "HOURLY", label: "Hourly" },
  { value: "FIXED", label: "Fixed packages" },
  { value: "SUBSCRIPTION", label: "Subscription" },
  { value: "SUCCESS", label: "No win, no fee" },
];

interface Props {
  activePractice: string[];
  activeLangs: string[];
  activePricing: PricingKind[];
  q: string;
}

export function DirectoryFilters({ activePractice, activeLangs, activePricing, q }: Props) {
  return (
    <form id="firmus-directory-filters" action="/lawyers" method="get">
      {q && <input type="hidden" name="q" defaultValue={q} />}
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(){var f=document.getElementById('firmus-directory-filters');if(!f)return;f.addEventListener('change',function(){f.requestSubmit();});})();`,
        }}
      />

      <FilterSection title="Practice area">
        <ul className="flex flex-col gap-2.5">
          {PRACTICE_AREAS.map((p) => (
            <li key={p}>
              <CheckLabel name="practice" value={p} checked={activePractice.includes(p)}>
                {p}
              </CheckLabel>
            </li>
          ))}
        </ul>
      </FilterSection>

      <Divider />

      <FilterSection title="Language">
        <div className="flex flex-wrap gap-1.5">
          {LANGS.map((l) => (
            <ChipCheck key={l} name="lang" value={l} checked={activeLangs.includes(l)}>
              {l.slice(0, 2).toUpperCase()}
            </ChipCheck>
          ))}
        </div>
      </FilterSection>

      <Divider />

      <FilterSection title="Pricing model">
        <ul className="flex flex-col gap-2.5">
          {PRICING_OPTIONS.map((opt) => (
            <li key={opt.value}>
              <CheckLabel name="pricing" value={opt.value} checked={activePricing.includes(opt.value)}>
                {opt.label}
              </CheckLabel>
            </li>
          ))}
        </ul>
      </FilterSection>

      <noscript>
        <button type="submit" className="mt-4 w-full rounded-md bg-teal-500 px-3 py-2 text-[13px] font-medium text-white">
          Apply filters
        </button>
      </noscript>
    </form>
  );
}

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-3 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">{title}</legend>
      {children}
    </fieldset>
  );
}

function Divider() {
  return <hr className="my-6 border-t border-slate-100" />;
}

function CheckLabel({
  name,
  value,
  checked,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-[14px] text-slate-700">
      <input
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={checked}
        className="peer sr-only"
        aria-label={`${name} ${value}`}
      />
      <span
        aria-hidden
        className={cn(
          "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] border bg-white-0 transition-colors",
          checked ? "border-teal-500 bg-teal-500" : "border-slate-200",
          "peer-checked:border-teal-500 peer-checked:bg-teal-500",
          "peer-focus-visible:ring-2 peer-focus-visible:ring-teal-500",
        )}
      >
        <Check
          className={cn("h-3 w-3 text-white", checked ? "" : "peer-checked:opacity-100 opacity-0")}
          strokeWidth={3}
        />
      </span>
      {children}
    </label>
  );
}

function ChipCheck({
  name,
  value,
  checked,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  children: React.ReactNode;
}) {
  return (
    <label
      className={cn(
        "inline-flex h-8 cursor-pointer items-center rounded-full border px-3.5 text-[13px] font-medium transition-colors",
        checked ? "border-navy-900 bg-navy-900 text-white" : "border-slate-100 bg-white-0 text-slate-700 hover:border-slate-300",
      )}
    >
      <input type="checkbox" name={name} value={value} defaultChecked={checked} className="sr-only" />
      {children}
    </label>
  );
}
