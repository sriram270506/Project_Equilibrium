import type { Config } from "tailwindcss";

/** Wrap a CSS custom property so Tailwind can apply opacity modifiers. */
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

/*
 * The "Ledger" palette. See app/globals.css for why this is paper and ink
 * rather than dark glass.
 *
 * Every colour here is a token reference, never a literal. The previous config
 * carried a set of `surface-*` aliases pointing at hardcoded white-at-low-alpha
 * values, which is how a theme change turns into an invisible-text bug: those
 * aliases kept working after the canvas flipped, and produced white on white.
 * Everything now resolves through a variable that a single palette swap moves.
 */
const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        /* Stock */
        paper: {
          DEFAULT: token("paper-sheet"),
          canvas: token("paper-canvas"),
          sheet: token("paper-sheet"),
          sunken: token("paper-sunken"),
          tint: token("paper-tint"),
          "tint-strong": token("paper-tint-strong"),
        },

        /* Printed rules */
        rule: {
          DEFAULT: token("rule"),
          strong: token("rule-strong"),
        },

        /* Ink */
        ink: {
          DEFAULT: token("ink-body"),
          strong: token("ink-strong"),
          body: token("ink-body"),
          muted: token("ink-muted"),
          faint: token("ink-faint"),
          inverse: token("ink-inverse"),
        },

        /* Razorpay */
        brand: {
          DEFAULT: token("brand"),
          bright: token("brand-bright"),
          deep: token("brand-deep"),
          ink: token("brand-ink"),
        },

        /* Ledger ink for status */
        ok: { DEFAULT: token("ok"), deep: token("ok-deep") },
        warn: { DEFAULT: token("warn"), deep: token("warn-deep") },
        danger: { DEFAULT: token("danger"), deep: token("danger-deep") },
        info: token("info"),

        cyanAccent: token("accent-cyan"),
        violetAccent: token("accent-violet"),

        /*
         * Compatibility aliases for markup written against the old dark
         * system. They now resolve to paper values, so an untouched page reads
         * correctly instead of rendering white on white.
         */
        canvas: {
          DEFAULT: token("paper-canvas"),
          deep: token("brand-deep"),
          raised: token("paper-sheet"),
        },
        surface: {
          page: token("paper-canvas"),
          card: token("paper-sheet"),
          sunken: token("paper-sunken"),
          inverse: token("brand-deep"),
        },
        line: {
          soft: token("rule"),
          strong: token("rule-strong"),
        },
      },

      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Georgia", "serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },

      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },

      boxShadow: {
        sheet: "var(--shadow-sheet)",
        raised: "var(--shadow-raised)",
        lift: "var(--shadow-lift)",
        press: "var(--shadow-press)",
        /* Old names, remapped. Paper does not glow. */
        glass: "var(--shadow-sheet)",
        "glow-brand": "var(--shadow-raised)",
        "glow-ok": "var(--shadow-raised)",
        "glow-warn": "var(--shadow-raised)",
        "glow-danger": "var(--shadow-raised)",
      },

      borderRadius: {
        /* Paper is cut, not moulded. */
        card: "3px",
        panel: "4px",
      },

      transitionTimingFunction: {
        spring: "cubic-bezier(0.2, 0.8, 0.3, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
