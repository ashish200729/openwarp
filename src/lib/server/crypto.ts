import "server-only";
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";

// Bank details and similar secrets are sealed before they reach the database. OPENWARP_DATA_KEY can be set separately from
// the session secret so that sessions can be rotated without losing sealed data.
function key(purpose: string) {
  const secret = process.env.OPENWARP_DATA_KEY || process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("Set OPENWARP_DATA_KEY to at least 32 characters.");
  return Buffer.from(hkdfSync("sha256", secret, "openwarp", purpose, 32));
}

export function seal(value: string, context: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key("seal"), nonce);
  cipher.setAAD(Buffer.from(context));
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([1]), nonce, cipher.getAuthTag(), body]);
}

export function unseal(sealed: Buffer, context: string) {
  if (sealed[0] !== 1) throw new Error("Unknown sealed format.");
  const decipher = createDecipheriv("aes-256-gcm", key("seal"), sealed.subarray(1, 13));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(sealed.subarray(13, 29));
  return Buffer.concat([decipher.update(sealed.subarray(29)), decipher.final()]).toString("utf8");
}

export function keyedHash(value: string, purpose: string) {
  return createHmac("sha256", key(purpose)).update(value).digest("hex");
}
