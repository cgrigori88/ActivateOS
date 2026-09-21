import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getPool } from "../src/db/client";
import { CANONICAL_TO_SCORING, SIGNAL_DEFS } from "../src/lib/signals/types";

/**
 * Seed the Channel Knowledge Base from knowledge/ into the database: ontology nodes + edges, play
 * templates, and signal configuration. Idempotent.
 *
 * ── SCOPES ──────────────────────────────────────────────────────────────────────────────────────
 *
 *   npx tsx scripts/seed-knowledge.ts                        every scope (unchanged default)
 *   npx tsx scripts/seed-knowledge.ts --scope taxonomy,templates
 *
 * Scoping exists because activation is not the same act as authorship. The 74 signal configs are
 * canonical source material with ZERO consumers in `src/` today and no thin-P9 or P2 dependency, so
 * activating them alongside the motion templates would put rows into a serving database for no
 * current reason. They stay in source, available deliberately later.
 *
 * ONE IMPLEMENTATION, NOT TWO. A second "pilot seed" script would drift from this one the first
 * time a template changed. A scope flag cannot drift, and the default remains everything — so no
 * existing caller changes behaviour.
 */
const SCOPES = ["taxonomy", "templates", "signals"] as const;
type Scope = (typeof SCOPES)[number];

function requestedScopes(argv: string[]): Set<Scope> {
  const at = argv.indexOf("--scope");
  if (at < 0) return new Set(SCOPES);
  const asked = (argv[at + 1] ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const bad = asked.filter((x) => !(SCOPES as readonly string[]).includes(x));
  if (bad.length || asked.length === 0) {
    throw new Error(`unknown seed scope(s): ${bad.join(", ") || "(none given)"} — valid scopes are ${SCOPES.join(", ")}`);
  }
  // TEMPLATES DEPEND ON TAXONOMY: a template resolves its node by slug, so seeding templates alone
  // would silently attach them to a null node rather than failing. The dependency is declared here
  // rather than left to the caller to remember.
  const set = new Set(asked as Scope[]);
  if (set.has("templates")) set.add("taxonomy");
  return set;
}
/**
 * A stable rendering of a JSON value, for comparing stored content against a file.
 *
 * PostgreSQL stores `jsonb` with its own key order, so a round-trip does not preserve the order the
 * file was written in — comparing `JSON.stringify` output directly reports every identical rerun as
 * a mismatch. Sorting keys at every level makes the comparison about CONTENT, which is the thing
 * the immutability rule is actually protecting.
 */
function canonical(v: unknown): string {
  const walk = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === "object") {
      return Object.fromEntries(Object.keys(x as Record<string, unknown>).sort()
        .map((k) => [k, walk((x as Record<string, unknown>)[k])]));
    }
    return x;
  };
  return JSON.stringify(walk(v));
}

async function main() {
  const scopes = requestedScopes(process.argv);
  console.log(`seed scope: ${[...scopes].sort().join(", ")}`);
  const pool = getPool();
  const client = await pool.connect();
  try {
    const ontology = JSON.parse(
      readFileSync(join(process.cwd(), "knowledge", "ontology", "core.json"), "utf8"),
    ) as {
      nodes: { slug: string; name: string; parent: string | null }[];
      edges: { from: string; to: string; type: string; weight: number }[];
    };

    await client.query("begin");

    const nodeIds = new Map<string, string>();
    for (const node of (scopes.has("taxonomy") ? ontology.nodes : [])) {
      const { rows } = await client.query<{ id: string }>(
        `insert into taxonomy_nodes (slug, name)
         values ($1, $2)
         on conflict (slug) do update set name = excluded.name
         returning id`,
        [node.slug, node.name],
      );
      nodeIds.set(node.slug, rows[0].id);
    }
    for (const node of (scopes.has("taxonomy") ? ontology.nodes : [])) {
      if (!node.parent) continue;
      await client.query(`update taxonomy_nodes set parent_id = $1 where slug = $2`, [
        nodeIds.get(node.parent),
        node.slug,
      ]);
    }
    for (const edge of (scopes.has("taxonomy") ? ontology.edges : [])) {
      await client.query(
        `insert into taxonomy_edges (from_node_id, to_node_id, edge_type, weight)
         values ($1, $2, $3, $4)
         on conflict (from_node_id, to_node_id, edge_type)
           do update set weight = excluded.weight`,
        [nodeIds.get(edge.from), nodeIds.get(edge.to), edge.type, edge.weight],
      );
    }

    const playsDir = join(process.cwd(), "knowledge", "plays");
    for (const file of (scopes.has("templates") ? readdirSync(playsDir).filter((f) => f.endsWith(".json")) : [])) {
      const play = JSON.parse(readFileSync(join(playsDir, file), "utf8")) as {
        slug: string;
        version: number;
        name: string;
        taxonomy_node: string;
      };
      await client.query(
        /**
         * A PUBLISHED VERSION IS IMMUTABLE, so this cannot be an upsert.
         *
         * It was `do update set definition = excluded.definition`, which meant editing a play file
         * and re-seeding silently rewrote the meaning of a version that motion history already
         * points at. `do nothing` makes an identical rerun idempotent; the check below turns a
         * CONTENT MISMATCH into a loud failure instead of a silent overwrite. A semantic change is
         * a new version row — which is cheap, and is the only thing that keeps a recorded
         * application interpretable.
         */
        `insert into play_templates (slug, version, name, taxonomy_node_id, definition)
         values ($1, $2, $3, $4, $5)
         on conflict (slug, version) do nothing`,
        [play.slug, play.version, play.name, nodeIds.get(play.taxonomy_node) ?? null, play],
      );
      const { rows: stored } = await client.query<{ name: string; definition: unknown }>(
        `select name, definition from play_templates where slug = $1 and version = $2`,
        [play.slug, play.version]);
      if (stored[0] && canonical(stored[0].definition) !== canonical(play)) {
        throw new Error(
          `play ${play.slug} v${play.version} is already published with different content — ` +
          `publish a new version rather than editing a version motion history points at`);
      }
      console.log(`seeded play ${play.slug} v${play.version}`);
    }

    await client.query("commit");
    console.log(scopes.has("taxonomy")
      ? `seeded ${ontology.nodes.length} taxonomy nodes, ${ontology.edges.length} edges`
      : "taxonomy SKIPPED — not in scope");

    // Versioned signal configuration (DIRECTIVE §12): the registry is the
    // source of truth; the DB copy is what admin/config tooling edits.
    let configs = 0;
    for (const [signalType, def] of (scopes.has("signals") ? Object.entries(SIGNAL_DEFS) : [])) {
      const family = def.canonical ?? def.family;
      await client.query(
        `insert into signal_configs (signal_type, family, default_half_life_days)
         values ($1, $2, $3)
         on conflict (signal_type) do update
           set family = excluded.family,
               default_half_life_days = excluded.default_half_life_days,
               updated_at = now()`,
        [signalType, family, def.halfLifeDays],
      );
      configs++;
    }
    void CANONICAL_TO_SCORING; // mapping lives in code; referenced for clarity
    console.log(scopes.has("signals")
      ? `seeded ${configs} signal configs`
      : "signal configs SKIPPED — not in scope (canonical source retained, activation deferred)");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
