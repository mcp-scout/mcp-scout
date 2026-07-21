import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // test/ and bench/ deal with loosely-typed MCP SDK call results (CallToolResult's
    // shape varies by what a downstream server returns) — src/ holds itself to no
    // `any` at all, but enforcing that same bar here isn't worth the churn.
    files: ["test/**", "bench/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
);
