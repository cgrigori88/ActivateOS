import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getPool } from "../src/db/client";
import { CANONICAL_TO_SCORING, SIGNAL_DEFS } from "../src/lib/signals/types";

/**
 * Seed the Channel Knowledge Base from knowledge/ into the database:
 * ontology nodes + edges, and play templates. Idempotent.
 */
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
    for (const node of ontology.nodes) {
      const { rows } = await client.query<{ id: string }>(
        `insert into taxonomy_nodes (slug, name)
         values ($1, $2)
         on conflict (slug) do update set name = excluded.name
         returning id`,
        [node.slug, node.name],
      );
      nodeIds.set(node.slug, rows[0].id);
    }
    for (const node of ontology.nodes) {
      if (!node.parent) continue;
      await client.query(`update taxonomy_nodes set parent_id = $1 where slug = $2`, [
        nodeIds.get(node.parent),
        node.slug,
      ]);
    }
    for (const edge of ontology.edges) {
      await client.query(
        `insert into taxonomy_edges (from_node_id, to_node_id, edge_type, weight)
         values ($1, $2, $3, $4)
         on conflict (from_node_id, to_node_id, edge_type)
           do update set weight = excluded.weight`,
        [nodeIds.get(edge.from), nodeIds.get(edge.to), edge.type, edge.weight],
      );
    }

    const playsDir = join(process.cwd(), "knowledge", "plays");
    for (const file of readdirSync(playsDir).filter((f) => f.endsWith(".json"))) {
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
    console.log(`seeded ${ontology.nodes.length} taxonomy nodes, ${ontology.edges.length} edges`);

    // Versioned signal configuration (DIRECTIVE §12): the registry is the
    // source of truth; the DB copy is what admin/config tooling edits.
    let configs = 0;
    for (const [signalType, def] of Object.entries(SIGNAL_DEFS)) {
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
    console.log(`seeded ${configs} signal configs`);
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
