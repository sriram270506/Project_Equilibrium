import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, sep } from "path";

/**
 * Every internal link must point at a route that exists.
 *
 * A dead `href` is invisible in review, invisible in typecheck, and only shows
 * up when someone clicks it — which, in a demo being recorded, is the worst
 * possible time to find out. This walks the app directory for real routes and
 * every component for links, then compares the two.
 */

const APP_DIR = join(process.cwd(), "app");
const SEARCH_DIRS = [APP_DIR, join(process.cwd(), "src", "components")];

/** Collect files matching an extension, recursively. */
function walk(dir: string, match: (f: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      out.push(...walk(full, match));
    } else if (match(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Turn app/dashboard/payments/[id]/page.tsx into /dashboard/payments/[id] */
function routeFromPageFile(file: string): string {
  const rel = relative(APP_DIR, file).split(sep).slice(0, -1).join("/");
  // Route groups like (dashboard) do not appear in the URL.
  const cleaned = rel
    .split("/")
    .filter((segment) => !(segment.startsWith("(") && segment.endsWith(")")))
    .join("/");
  return "/" + cleaned;
}

/** Does a concrete link match a route pattern, allowing for [id] segments? */
function matchesRoute(link: string, route: string): boolean {
  const linkParts = link.split("/").filter(Boolean);
  const routeParts = route.split("/").filter(Boolean);
  if (linkParts.length !== routeParts.length) return false;

  return routeParts.every((part, i) => {
    if (part.startsWith("[") && part.endsWith("]")) return true;
    return part === linkParts[i];
  });
}

function collectRoutes(): string[] {
  return walk(APP_DIR, (f) => f === "page.tsx").map(routeFromPageFile);
}

function collectLinks(): Array<{ link: string; file: string }> {
  const found: Array<{ link: string; file: string }> = [];

  for (const dir of SEARCH_DIRS) {
    for (const file of walk(dir, (f) => f.endsWith(".tsx"))) {
      const source = readFileSync(file, "utf-8");

      // href="/..." and href={`/...`} and router.push("/...") / push(`/...`)
      const patterns = [
        /href="(\/[^"]*)"/g,
        /href=\{`(\/[^`]*)`\}/g,
        /router\.push\(["`](\/[^"`]*)["`]\)/g,
      ];

      for (const pattern of patterns) {
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(source)) !== null) {
          // Replace ${...} interpolations with a placeholder segment.
          const link = match[1].replace(/\$\{[^}]*\}/g, "PLACEHOLDER");
          if (link.startsWith("/api/")) continue; // API routes, not pages
          found.push({ link, file: relative(process.cwd(), file) });
        }
      }
    }
  }

  return found;
}

describe("Internal routing", () => {
  const routes = collectRoutes();
  const links = collectLinks();

  it("discovers the application's page routes", () => {
    expect(routes.length).toBeGreaterThan(5);
    expect(routes).toContain("/dashboard");
    expect(routes).toContain("/dashboard/opportunities/[id]");
    expect(routes).toContain("/dashboard/payments/[id]");
  });

  it("finds internal links to check", () => {
    expect(links.length).toBeGreaterThan(10);
  });

  it("every internal link resolves to a real route", () => {
    const broken = links.filter(
      ({ link }) => !routes.some((route) => matchesRoute(link, route))
    );

    expect(
      broken,
      `Dead links found:\n${broken
        .map((b) => `  ${b.link}  (in ${b.file})`)
        .join("\n")}`
    ).toEqual([]);
  });

  it("every dashboard workflow lives under /dashboard", () => {
    const dashboardRoutes = routes.filter((r) => r.startsWith("/dashboard"));
    // Only the landing page and the dashboard tree should exist.
    const strays = routes.filter(
      (r) => r !== "/" && !r.startsWith("/dashboard")
    );

    expect(dashboardRoutes.length).toBeGreaterThan(8);
    expect(strays, `Routes outside /dashboard: ${strays.join(", ")}`).toEqual([]);
  });
});
