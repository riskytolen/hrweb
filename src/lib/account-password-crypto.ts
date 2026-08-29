/**
 * AES-256-GCM encryption/decryption for account passwords.
 *
 * Server-only module. Never import from client code.
 *
 * Environment variables:
 *   ACCOUNT_PASSWORD_ENCRYPTION_KEY_V1 — 64-char hex string (32 bytes) for AES-256
 *   ACCOUNT_PASSWORD_KEY_VERSION       — integer, defaults to 1
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getKey(version?: number): Buffer {
  const v = version ?? 1;
  const envKey = process.env.ACCOUNT_PASSWORD_ENCRYPTION_KEY_V1;
  if (!envKey || envKey.length < 64) {
    throw new Error(
      "ACCOUNT_PASSWORD_ENCRYPTION_KEY_V1 not configured. " +
        "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  const hexVersion = v.toString(16).padStart(4, "0");
  const versionKey = Buffer.from(envKey, "hex");
  // XOR with version number for key rotation support
  const xored = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) {
    xored[i] = versionKey[i] ^ ((hexVersion.charCodeAt(i % 4) << (i % 4)) & 0xff);
  }
  return xored;
}

export interface EncryptedPayload {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
  keyVersion: number;
}

export function encryptPassword(
  plaintext: string,
  additionalData?: string,
  keyVersion?: number
): EncryptedPayload {
  const version = keyVersion ?? parseInt(process.env.ACCOUNT_PASSWORD_KEY_VERSION ?? "1", 10);
  const key = getKey(version);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  if (additionalData) {
    cipher.setAAD(Buffer.from(additionalData, "utf8"));
  }

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return { ciphertext: encrypted, iv, tag, keyVersion: version };
}

export function decryptPassword(
  ciphertext: Buffer,
  iv: Buffer,
  tag: Buffer,
  keyVersion: number,
  additionalData?: string
): string {
  const key = getKey(keyVersion);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  if (additionalData) {
    decipher.setAAD(Buffer.from(additionalData, "utf8"));
  }

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}
