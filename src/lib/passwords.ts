import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

const iterations = 120_000;
const keyLength = 32;
const digest = "sha256";

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(password, salt, iterations, keyLength, digest).toString("hex");
  return `pbkdf2$${iterations}$${salt}$${hash}`;
}

export function verifyPassword(password: string, storedHash: string) {
  const [kind, iterationText, salt, hash] = storedHash.split("$");
  if (kind !== "pbkdf2" || !iterationText || !salt || !hash) return false;
  const parsedIterations = Number(iterationText);
  if (!Number.isFinite(parsedIterations) || parsedIterations < 1) return false;

  const expected = Buffer.from(hash, "hex");
  const actual = pbkdf2Sync(password, salt, parsedIterations, expected.length, digest);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export function hashToken(token: string) {
  return pbkdf2Sync(token, "geo-content-session", 1, 32, "sha256").toString("hex");
}
