import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * Backup-at-rest encryption (Pilot OR-2). AES-256-GCM (authenticated) so a backup file
 * is confidential AND tamper-evident at rest and in transit to an offsite destination.
 * The key comes from `BACKUP_ENCRYPTION_KEY` — a 64-char hex string (used directly) or
 * any passphrase (stretched with scrypt). Envelope: magic(8) | iv(12) | tag(16) | ct.
 * When no key is configured the caller writes the plaintext gzip (unchanged behavior);
 * for a real pilot, encryption + an offsite copy are prerequisites (docs/OPERATIONS.md).
 */

const MAGIC = "POSAENC1";
const SALT = "pursuitos-backup-v1";

function keyFrom(secret: string): Buffer {
  return secret.length === 64 && /^[0-9a-f]+$/i.test(secret) ? Buffer.from(secret, "hex") : scryptSync(secret, SALT, 32);
}

export function encryptBackup(plaintext: Buffer, secret: string): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return Buffer.concat([Buffer.from(MAGIC), iv, c.getAuthTag(), ct]);
}

export function isEncrypted(blob: Buffer): boolean {
  return blob.subarray(0, MAGIC.length).toString() === MAGIC;
}

export function decryptBackup(blob: Buffer, secret: string): Buffer {
  if (!isEncrypted(blob)) throw new Error("not an encrypted PursuitOS backup");
  const iv = blob.subarray(8, 20), tag = blob.subarray(20, 36), ct = blob.subarray(36);
  const d = createDecipheriv("aes-256-gcm", keyFrom(secret), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}
