import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LEN = 32;
const IV_LEN = 16;
const TAG_LEN = 16;

function getDerivedKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error('ENCRYPTION_KEY env var is not set');
  // Accept a 64-char hex string or derive from arbitrary string
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  return scryptSync(raw, 'coki-agents-salt', KEY_LEN);
}

/**
 * Encrypts a plaintext string and returns a base64-encoded ciphertext.
 * Format: iv (16 bytes) + authTag (16 bytes) + ciphertext
 */
export function encrypt(plaintext: string): string {
  const key = getDerivedKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

/**
 * Decrypts a base64-encoded ciphertext produced by `encrypt()`.
 */
export function decrypt(ciphertext: string): string {
  const key = getDerivedKey();
  const buf = Buffer.from(ciphertext, 'base64');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const encrypted = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

/**
 * Safely decrypt a credential value without throwing.
 *
 * Handles three cases:
 * 1. Non-string (e.g. JSONB already parsed as an object) → cast to string directly
 * 2. Plain string stored before encryption was added → return as-is
 * 3. Encrypted base64 string → decrypt and return
 */
export function safeDecrypt(value: unknown): string {
  if (typeof value !== 'string') {
    return value as string;
  }
  try {
    return decrypt(value);
  } catch {
    return value;
  }
}
