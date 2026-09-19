import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/generated/**",
      "**/dist/**",
      // Plan 01's Global Constraints: "apps/web is a new addition alongside
      // apps/relay and apps/harness ... Nothing in this plan should modify
      // those two." They predate this plan (a companion-app spike) and are
      // out of scope for this lint gate.
      "apps/relay/**",
      "apps/harness/**",
      "scripts/echo-relay-server.mjs",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "prisma",
          property: "$queryRawUnsafe",
          message:
            "Raw unsafe queries are banned. Use $queryRaw with a tagged template.",
        },
        {
          object: "prisma",
          property: "$executeRawUnsafe",
          message:
            "Raw unsafe queries are banned. Use $executeRaw with a tagged template.",
        },
        {
          object: "Math",
          property: "random",
          message:
            "Math.random is not cryptographically secure. Use node:crypto randomBytes/randomInt for anything security-bearing.",
        },
      ],
      "react/no-danger": "off",
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: "dangerouslySetInnerHTML is banned — render text, not HTML.",
        },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
);
