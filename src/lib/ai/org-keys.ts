import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";

/**
 * BYO-model key storage (slice C). Keys are encrypted app-side with
 * AES-256-GCM under APP_ENCRYPTION_KEY before touching the database, are
 * never displayed back once saved, and clearing reverts the tenant to the
 * platform key. If APP_ENCRYPTION_KEY is absent the feature is disabled —
 * we refuse to store secrets we can't encrypt.
 */

type Db = Pool | PoolClient;

function secret(): Buffer | null {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw || raw.length < 16) return null;
  return createHash("sha256").update(raw).digest();
}

export function byoModelAvailable(): boolean {
  return secret() != null;
}

function encrypt(plain: string): string {
  const key = secret();
  if (!key) throw new Error("BYO-model needs APP_ENCRYPTION_KEY configured on the server.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
}

function decrypt(blob: string): string | null {
  const key = secret();
  if (!key) return null;
  try {
    const buf = Buffer.from(blob, "base64");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export async function setOrgAnthropicKey(db: Db, orgId: string, apiKey: string): Promise<void> {
  const trimmed = apiKey.trim();
  if (!trimmed.startsWith("sk-ant-")) throw new Error("That doesn't look like an Anthropic API key.");
  await db.query(
    `insert into org_ai_settings (org_id, anthropic_key_enc, updated_at)
     values ($1, $2, now())
     on conflict (org_id) do update set anthropic_key_enc = $2, updated_at = now()`,
    [orgId, encrypt(trimmed)],
  );
  await db.query(
    `insert into audit_log (org_id, actor, event, detail) values ($1, 'operator', 'ai.key_set', '{}')`,
    [orgId],
  );
}

export async function clearOrgAnthropicKey(db: Db, orgId: string): Promise<void> {
  await db.query(`update org_ai_settings set anthropic_key_enc = null, updated_at = now() where org_id = $1`, [orgId]);
  await db.query(
    `insert into audit_log (org_id, actor, event, detail) values ($1, 'operator', 'ai.key_cleared', '{}')`,
    [orgId],
  );
}

export async function hasOrgAnthropicKey(db: Db, orgId: string): Promise<boolean> {
  const { rows } = await db.query<{ set: boolean }>(
    `select anthropic_key_enc is not null as set from org_ai_settings where org_id = $1`,
    [orgId],
  );
  return rows[0]?.set ?? false;
}

/** The tenant's own key when present and decryptable; null → platform key. */
export async function resolveOrgAnthropicKey(db: Db, orgId: string | null | undefined): Promise<string | null> {
  if (!orgId) return null;
  const { rows } = await db.query<{ anthropic_key_enc: string | null }>(
    `select anthropic_key_enc from org_ai_settings where org_id = $1`,
    [orgId],
  );
  if (!rows[0]?.anthropic_key_enc) return null;
  return decrypt(rows[0].anthropic_key_enc);
}
