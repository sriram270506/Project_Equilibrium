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
        surface: {
          page: token("surface-page"),
          card: token("surface-card"),
          sunken: token("surface-sunken"),
          inverse: token("surface-inverse"),
        },
        ink: {
          strong: token("ink-strong"),
          body: token("ink-body"),
          muted: token("ink-muted"),
          inverse: token("ink-inverse"),
        },
        line: {
          soft: token("line-soft"),
          strong: token("line-strong"),
        },
        brand: {
          ink: token("brand-ink"),
          DEFAULT: token("brand"),
          strong: token("brand-strong"),
          wash: token("brand-wash"),
        },
        ok: { DEFAULT: token("ok"), wash: token("ok-wash") },
        warn: { DEFAULT: token("warn"), wash: token("warn-wash") },
        danger: { DEFAULT: token("danger"), wash: token("danger-wash") },
        info: { DEFAULT: token("info"), wash: token("info-wash") },
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
      boxShadow: {
        card: "0 1px 2px rgb(12 18 38 / 0.04), 0 1px 3px rgb(12 18 38 / 0.06)",
        lift: "0 4px 12px rgb(12 18 38 / 0.08), 0 1px 3px rgb(12 18 38 / 0.06)",
      },
      borderRadius: {
        card: "0.625rem",
      },
    },
  },
  plugins: [],
};

export default config;
