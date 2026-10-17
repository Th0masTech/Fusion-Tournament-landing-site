// Netlify build step: copy the static site into dist/ so server code, the database
// migrations and node_modules are never published as public files.
import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";

const SKIP = new Set(["dist", "netlify", "node_modules", "scripts", "package.json", "package-lock.json", "netlify.toml", "README.md"]);
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");
for (const name of readdirSync(".")) {
  if (SKIP.has(name) || name.startsWith(".")) continue;
  cpSync(name, `dist/${name}`, { recursive: true });
}
console.log("Copied the site into dist/");
