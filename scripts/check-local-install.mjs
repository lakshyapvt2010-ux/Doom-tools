/** Verify unpublished packages outside the monorepo's workspace links. */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const project = mkdtempSync(join(tmpdir(), "agentic-consumer-"));
cpSync(join(root, "templates/custom-tool"), project, { recursive: true });
const vendor = join(project, "vendor");
mkdirSync(vendor);
for (const name of ["core", "security", "runtime"]) {
  const staging = join(project, `pack-${name}`);
  mkdirSync(staging);
  execFileSync("pnpm", ["pack", "--pack-destination", staging], { cwd: join(root, "packages", name), stdio: "pipe" });
  const archive = readdirSync(staging).find(file => file.endsWith(".tgz"));
  if (!archive) throw new Error(`No package produced for ${name}`);
  renameSync(join(staging, archive), join(vendor, `${name}.tgz`));
}
// Direct local resolutions prevent pnpm's packed workspace versions from
// being mistaken for a public registry release. No package registry is changed.
const manifestPath = join(project, "package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.overrides = Object.fromEntries(["core", "security", "runtime"].map(name => [`@agentic-tools/${name}`, `file:./vendor/${name}.tgz`]));
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
for (const args of [["install", "--ignore-scripts", "--no-audit", "--no-fund"], ["run", "build"], ["start"]]) {
  execFileSync("npm", args, { cwd: project, stdio: "inherit", timeout: 120000 });
}
console.log(`Independent consumer verification passed: ${project}`);
