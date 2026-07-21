import { readFileSync } from "node:fs";

// Single source of truth for the gateway version — read from package.json at
// runtime so it never drifts from the published version. `../package.json`
// resolves correctly both in dev (src/version.ts) and in the built package
// (dist/version.js), and npm always ships package.json.
const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
) as { version: string };

export const VERSION: string = pkg.version;
