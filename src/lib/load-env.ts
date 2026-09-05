/**
 * Environment loading for standalone CLI scripts.
 *
 * Next.js loads `.env` then `.env.local`, with `.env.local` winning and never
 * committed. The CLI scripts in `scripts/` had neither: Prisma happens to read
 * `.env` on its own, which made `DATABASE_URL` work and hid the fact that
 * nothing else was being loaded at all. Putting real credentials in
 * `.env.local` — the file the framework and every convention says to use —
 * left `npm run razorpay:check` reporting "no credentials found" while the
 * credentials sat right there.
 *
 * This reproduces the framework's precedence so the same file works from both
 * the app and the terminal. No dependency: dotenv is not installed, and a
 * twenty-line parser is a smaller commitment than a package for this.
 *
 * Existing process environment always wins, so `RAZORPAY_MODE=mock npm run …`
 * still overrides the file, as it does under Next.js.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";

/** Files in precedence order, lowest first. Later files override earlier. */
const FILES = [".env", ".env.local"];

function parse(contents: string): Record<string, string> {
  const out: Record<string, string> = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = line.slice(eq + 1).trim();

    // Strip a single matching pair of surrounding quotes, and only then.
    // Stripping unconditionally would corrupt a secret that legitimately
    // begins or ends with a quote character.
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }

    out[key] = value;
  }

  return out;
}

/**
 * Load `.env` then `.env.local` into `process.env`.
 *
 * Returns the names of the keys it set — names only. The values are
 * deliberately not returned or logged: this function exists to handle secrets,
 * and a convenience return of what it loaded is how a secret ends up in a
 * console transcript.
 */
export function loadEnv(cwd: string = process.cwd()): string[] {
  const applied: string[] = [];

  /*
   * Snapshot the REAL environment before touching anything.
   *
   * Checking `process.env[key] !== undefined` inside the loop looks right and
   * is wrong: once `.env` has been applied every key is defined, so
   * `.env.local` could never override it and the precedence would be exactly
   * backwards. Only keys that were set before this function ran are protected.
   */
  const preexisting = new Set(Object.keys(process.env));

  for (const file of FILES) {
    const path = join(cwd, file);
    if (!existsSync(path)) continue;

    const values = parse(readFileSync(path, "utf8"));
    for (const [key, value] of Object.entries(values)) {
      // A real environment variable beats any file, matching Next.js.
      if (preexisting.has(key)) continue;
      process.env[key] = value;
      if (!applied.includes(key)) applied.push(key);
    }
  }

  return applied;
}
