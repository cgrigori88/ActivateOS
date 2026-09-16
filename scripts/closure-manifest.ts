import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/**
 * Frozen-closure manifest builder (D-G8-2A bounded sweep).
 *
 * WHY. The D-G8-2A criterion — "every ordering site reachable from the certified surface that affects
 * membership, a pick, or a value shown" — has no bounded file set, and five audit rounds each reached
 * root files the previous round had never examined (24 -> 6 -> 7 -> 9 -> 44). A convergence claim is only
 * reproducible against a CLOSURE THAT IS FROZEN FIRST: the same file list, the same scanner, before and
 * after the fixes.
 *
 * WHAT. The transitive closure of module imports starting from every file under `src/app` (the App Router
 * surface: pages, layouts, route handlers, server actions and their co-located components). Only modules
 * under `src/` are members; node_modules and type-only external packages are not part of the product
 * surface being certified.
 *
 * DETERMINISM. Directory reads are sorted, the frontier is processed in sorted order, and the emitted
 * manifest is a sorted, de-duplicated list of repo-relative POSIX paths with a trailing newline. The digest
 * is SHA-256 over those exact bytes, so it can be recomputed by anyone.
 *
 *   npx tsx scripts/closure-manifest.ts --out docs/vnext/D-G8-2A-CLOSURE-MANIFEST.txt
 *   npx tsx scripts/closure-manifest.ts --verify docs/vnext/D-G8-2A-CLOSURE-MANIFEST.txt
 *
 * `--verify` recomputes the closure and compares it to a frozen manifest. A mismatch after editing means a
 * fix pulled in a dependency outside the frozen closure: the closure was invalid, and the rule is to STOP
 * and report rather than silently expand it.
 */

export const MANIFEST_BUILDER_VERSION = "1.0.0";

/** Roots: the rendered/served surface. Everything reachable from here can affect what a user sees. */
export const ROOT_DIR = "src/app";
/** Members must live here — the product's own modules. */
export const MEMBER_PREFIX = "src/";
/** Import specifiers are resolved by trying these, in order. */
const EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx"];
/** Files that are themselves scanned for imports. */
const SOURCE_RX = /\.(ts|tsx)$/;

const repoRoot = process.cwd();
const posix = (p: string) => p.split("\\").join("/");

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try { entries = readdirSync(dir).sort(); } catch { return out; }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) out.push(...walk(full));
    else if (SOURCE_RX.test(name)) out.push(full);
  }
  return out;
}

/**
 * Import specifiers, including `export … from`, bare side-effect imports and dynamic `import()`.
 * Deliberately textual: it over-collects rather than under-collects, which is the safe direction for a
 * closure that must not miss a reachable module.
 */
function specifiersOf(src: string): string[] {
  const out: string[] = [];
  const patterns = [
    /\bimport\s+[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bexport\s+[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const rx of patterns) for (const m of src.matchAll(rx)) out.push(m[1]);
  return out;
}

/** Resolve a specifier to a repo-relative member path, or null when it is not a member of the closure. */
function resolveMember(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = resolve(repoRoot, "src", spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null; // bare package specifier — not a product module
  for (const ext of EXTENSIONS) {
    const cand = base + ext;
    try {
      const st = statSync(cand);
      if (st.isFile() && SOURCE_RX.test(cand)) return posix(relative(repoRoot, cand));
    } catch { /* keep trying */ }
  }
  return null;
}

export function buildClosure(): string[] {
  const roots = walk(resolve(repoRoot, ROOT_DIR)).map((f) => posix(relative(repoRoot, f))).sort();
  const seen = new Set<string>(roots);
  const frontier = [...roots];
  while (frontier.length) {
    const file = frontier.shift()!;
    let src: string;
    try { src = readFileSync(resolve(repoRoot, file), "utf8"); } catch { continue; }
    for (const spec of specifiersOf(src).sort()) {
      const member = resolveMember(resolve(repoRoot, file), spec);
      if (!member || !member.startsWith(MEMBER_PREFIX) || seen.has(member)) continue;
      seen.add(member);
      frontier.push(member);
    }
  }
  return [...seen].sort();
}

export function manifestText(files: string[]): string {
  return files.join("\n") + "\n";
}

export function digestOf(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function main(): void {
  const argv = process.argv;
  const outAt = argv.indexOf("--out");
  const verifyAt = argv.indexOf("--verify");
  const files = buildClosure();
  const text = manifestText(files);
  const digest = digestOf(text);
  const appFiles = files.filter((f) => f.startsWith("src/app/")).length;

  console.log(`[closure-manifest] builder ${MANIFEST_BUILDER_VERSION} · roots ${ROOT_DIR} · members ${MEMBER_PREFIX}`);
  console.log(`  files: ${files.length}  (src/app ${appFiles} · other ${files.length - appFiles})`);
  console.log(`  sha256: ${digest}`);

  if (verifyAt >= 0) {
    const path = argv[verifyAt + 1];
    const frozen = readFileSync(resolve(repoRoot, path), "utf8");
    const frozenDigest = digestOf(frozen);
    if (frozenDigest === digest) {
      console.log(`  VERIFY PASS — the computed closure equals the frozen manifest (${path})`);
      process.exitCode = 0;
      return;
    }
    const frozenSet = new Set(frozen.split("\n").filter(Boolean));
    const added = files.filter((f) => !frozenSet.has(f));
    const removed = [...frozenSet].filter((f) => !files.includes(f));
    console.log(`  VERIFY FAIL — frozen ${frozenDigest} != computed ${digest}`);
    if (added.length) console.log(`  ADDED (outside the frozen closure): ${added.join(", ")}`);
    if (removed.length) console.log(`  REMOVED: ${removed.join(", ")}`);
    console.log("  The frozen closure was invalid. STOP and report — do not silently expand it.");
    process.exitCode = 1;
    return;
  }

  if (outAt >= 0) {
    const path = argv[outAt + 1];
    writeFileSync(resolve(repoRoot, path), text, "utf8");
    console.log(`  written: ${path}`);
  }
}

main();
