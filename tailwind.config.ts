import type { Config } from "tailwindcss";

/** Wrap a CSS custom property so Tailwind can apply opacity modifiers. */
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: {
          DEFAULT: token("canvas-base"),
          deep: token("canvas-deep"),
          raised: token("canvas-raised"),
        },
        ink: {
          strong: token("ink-strong"),
          body: token("ink-body"),
          muted: token("ink-muted"),
          faint: token("ink-faint"),
          inverse: token("ink-inverse"),
        },
        brand: {
          DEFAULT: token("brand"),
          bright: token("brand-bright"),
          deep: token("brand-deep"),
        },
        cyanAccent: token("accent-cyan"),
        violetAccent: token("accent-violet"),
        ok: { DEFAULT: token("ok"), deep: token("ok-deep") },
        warn: { DEFAULT: token("warn"), deep: token("warn-deep") },
        danger: { DEFAULT: token("danger"), deep: token("danger-deep") },
        info: token("info"),

        /*
         * Legacy aliases. The previous light theme used `surface-*` and
         * `line-*`; mapping them onto the new tokens means every existing page
         * renders correctly on the dark canvas without a rewrite, and any
         * stragglers degrade to a sensible glass surface rather than to white.
         */
        surface: {
          page: token("canvas-base"),
          card: "rgb(255 255 255 / 0.045)",
          sunken: "rgb(255 255 255 / 0.03)",
          inverse: token("canvas-deep"),
        },
        line: {
          soft: "rgb(255 255 255 / 0.09)",
          strong: "rgb(255 255 255 / 0.16)",
        },
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
      boxShadow: {
        glass: "0 8px 32px rgb(2 6 18 / 0.55), 0 2px 8px rgb(2 6 18 / 0.4)",
        lift: "0 20px 48px rgb(2 6 18 / 0.7), 0 4px 12px rgb(2 6 18 / 0.5)",
        "glow-brand": "0 0 32px -6px rgb(var(--brand) / 0.55)",
        "glow-ok": "0 0 28px -6px rgb(var(--ok) / 0.5)",
        "glow-warn": "0 0 28px -6px rgb(var(--warn) / 0.5)",
        "glow-danger": "0 0 28px -6px rgb(var(--danger) / 0.5)",
      },
      borderRadius: {
        card: "0.875rem",
        panel: "1.25rem",
      },
      backdropBlur: {
        glass: "20px",
      },
      transitionTimingFunction: {
        spring: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
