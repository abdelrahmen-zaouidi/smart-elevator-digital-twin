import next from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  ...next,
  {
    // Vendored shadcn/ui primitives + scaffold hooks are generated library code,
    // not ours to lint or rewrite.
    ignores: [
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
      "components/ui/**",
      "hooks/use-mobile.ts",
    ],
  },
  {
    // The React-Compiler-era hook rules below are designed for apps that run the
    // React Compiler. In this hand-written codebase they flag many CORRECT
    // patterns — connection-setup effects, fetch-on-mount loading flags,
    // responsive listeners, blessed lazy ref init (`if (!ref.current) …`), and
    // latest-value refs read by timers. They are kept as visible warnings, not
    // build-failing errors. Genuine violations (e.g. the unconditional ref write
    // previously in useDitto) are fixed in code, never silenced.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      "@next/next/no-img-element": "warn",
    },
  },
];

export default eslintConfig;
