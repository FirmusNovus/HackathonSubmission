import { expect, test, type Page } from "@playwright/test";
import { devSignIn, reseedDatabase, SEEDED } from "./_helpers";

test.beforeAll(reseedDatabase);

/**
 * Catch-all: walk the DOM of every key page, find every <button> and <a> that's
 * neither aria-disabled nor inside a disabled fieldset, and assert each one has
 * SOMETHING that wires it up:
 *   - <a href="..."> with a non-empty href, OR
 *   - <button type="submit"> inside a <form>, OR
 *   - a registered onclick / React handler (presence of a fiber with an onClick prop), OR
 *   - aria attributes that mark it interactive (aria-controls, aria-haspopup, role=tab/menuitem),
 *   - aria-expanded / data-state.
 *
 * If none of those is true, the element is reported. The list of routes is
 * exhaustive enough to cover the 12 product views.
 */

const PUBLIC_ROUTES = ["/", "/lawyers", "/connect"];

async function findUnwiredButtons(page: Page) {
  return await page.evaluate(() => {
    type Finding = { tag: string; text: string; reason: string; outerHTML: string };
    const findings: Finding[] = [];
    const candidates = Array.from(document.querySelectorAll<HTMLElement>("a, button, [role=button]"));
    for (const el of candidates) {
      // Skip invisible
      const rect = el.getBoundingClientRect();
      const visible = rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== "hidden";
      if (!visible) continue;

      // Skip aria-hidden / sr-only-only ancestors
      if (el.closest("[aria-hidden=true]")) continue;
      if (el.matches('[disabled], [aria-disabled="true"]')) continue;
      if (el.closest('fieldset[disabled]')) continue;

      const tag = el.tagName.toLowerCase();
      const text = (el.textContent ?? "").trim().slice(0, 60) || el.getAttribute("aria-label") || "";

      // 1) Anchors with hrefs are wired
      if (tag === "a") {
        const href = el.getAttribute("href");
        if (href && href !== "#") continue;
      }

      // 2) Submit buttons inside forms are wired
      if (tag === "button" && (el as HTMLButtonElement).type === "submit") {
        if (el.closest("form")) continue;
      }

      // 3) Has aria-controls or aria-haspopup or role=tab/menuitem
      if (
        el.hasAttribute("aria-controls") ||
        el.hasAttribute("aria-haspopup") ||
        el.hasAttribute("aria-expanded") ||
        ["tab", "menuitem", "switch", "checkbox", "radio"].includes(el.getAttribute("role") ?? "")
      )
        continue;

      // 4) React handler check — inspect every fiber-related key
      const reactKeys = Object.keys(el).filter((k) => k.startsWith("__reactProps$") || k.startsWith("__reactFiber$"));
      let hasReactHandler = false;
      for (const key of reactKeys) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const node = (el as any)[key];
        const candidates = [node, node?.memoizedProps, node?.pendingProps, node?.return?.memoizedProps];
        for (const c of candidates) {
          if (c && (c.onClick || c.onMouseDown || c.onPointerDown || c.onSubmit || c.onChange || c.onKeyDown)) {
            hasReactHandler = true;
            break;
          }
        }
        if (hasReactHandler) break;
      }
      if (hasReactHandler) continue;

      // 5) Native onclick attribute
      if ((el as HTMLElement).onclick) continue;

      findings.push({
        tag,
        text,
        reason: tag === "a" ? "anchor without href" : "button without onClick / submit / aria affordance",
        outerHTML: el.outerHTML.slice(0, 220),
      });
    }
    return findings;
  });
}

async function sweep(page: Page, route: string, label: string) {
  await page.goto(route);
  await page.waitForLoadState("domcontentloaded");
  // Wait until ALL visible buttons/anchors carry a __reactProps$ key. Without
  // this, hydration races make sweeps flaky in dev mode.
  await page
    .waitForFunction(
      () => {
        const all = Array.from(
          document.querySelectorAll<HTMLElement>("button, a, [role=button]"),
        ).filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
        if (!all.length) return false;
        return all.every((el) => Object.keys(el).some((k) => k.startsWith("__reactProps$")));
      },
      undefined,
      { timeout: 10_000 },
    )
    .catch(() => {
      /* fall through — sweep will surface anything still unwired */
    });
  await page.waitForTimeout(500);
  const findings = await findUnwiredButtons(page);
  expect(findings, `Unwired buttons on ${label} (${route}):\n${JSON.stringify(findings, null, 2)}`).toEqual([]);
}

test.describe("Dead-button sweep", () => {
  test("public routes have no orphan buttons", async ({ page }) => {
    for (const r of PUBLIC_ROUTES) await sweep(page, r, r);
  });

  test("lawyer profile detail has no orphan buttons", async ({ page }) => {
    await page.goto("/lawyers");
    const href = await page.locator("a[href^='/lawyers/']").first().getAttribute("href");
    expect(href).toBeTruthy();
    await sweep(page, href!, "lawyer profile");
  });

  test("client routes have no orphan buttons", async ({ page }) => {
    await devSignIn(page, { wallet: SEEDED.client1, role: "client" });
    await sweep(page, "/client/home", "client home");
    await sweep(page, "/client/home?cat=Business", "client home (Business)");
    await sweep(page, "/client/messages", "client messages");
  });

  test("lawyer routes have no orphan buttons", async ({ page }) => {
    await devSignIn(page, { wallet: SEEDED.lawyerMaria, role: "lawyer" });
    await sweep(page, "/lawyer/dashboard", "lawyer dashboard");
    await sweep(page, "/lawyer/requests", "lawyer requests list");
    await sweep(page, "/lawyer/profile/edit", "lawyer profile editor");
    await sweep(page, "/lawyer/messages", "lawyer messages");
  });
});
