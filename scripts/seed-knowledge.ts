import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getPool } from "../src/db/client";
import { CANONICAL_TO_SCORING, SIGNAL_DEFS } from "../src/lib/signals/types";

/**
 * Seed the Channel Knowledge Base from knowledge/ into the database:
 * ontology nodes + edges, and play templates. Idempotent.
 */
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
        `insert into play_templates (slug, version, name, taxonomy_node_id, definition)
         values ($1, $2, $3, $4, $5)
         on conflict (slug, version) do update
           set name = excluded.name,
               taxonomy_node_id = excluded.taxonomy_node_id,
               definition = excluded.definition`,
        [play.slug, play.version, play.name, nodeIds.get(play.taxonomy_node) ?? null, play],
      );
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
