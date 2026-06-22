import type { BluehourSnapshot } from "../../domain/types";

const BACKUP_VERSION = 1;
const PBKDF2_ITERATIONS = 210_000;

export interface EncryptedBackupEnvelope {
  version: number;
  exportedAt: string;
  kdf: "PBKDF2-SHA-256";
  iterations: number;
  salt: string;
  nonce: string;
  ciphertext: string;
}

export async function encryptBackup(snapshot: BluehourSnapshot, passphrase: string): Promise<EncryptedBackupEnvelope> {
  if (passphrase.length < 8) {
    throw new Error("Backup passphrase must be at least 8 characters");
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const payload = new TextEncoder().encode(
    JSON.stringify({
      schemaVersion: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      snapshot
    })
  );
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: toBufferSource(nonce) }, key, payload);

  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    kdf: "PBKDF2-SHA-256",
    iterations: PBKDF2_ITERATIONS,
    salt: toBase64(salt),
    nonce: toBase64(nonce),
    ciphertext: toBase64(new Uint8Array(ciphertext))
  };
}

export async function decryptBackup(envelope: EncryptedBackupEnvelope, passphrase: string): Promise<BluehourSnapshot> {
  if (envelope.version !== BACKUP_VERSION) {
    throw new Error(`Unsupported backup version ${envelope.version}`);
  }

  const salt = fromBase64(envelope.salt);
  const nonce = fromBase64(envelope.nonce);
  const ciphertext = fromBase64(envelope.ciphertext);
  const key = await deriveKey(passphrase, salt);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: toBufferSource(nonce) }, key, toBufferSource(ciphertext));
  const decoded = JSON.parse(new TextDecoder().decode(plaintext)) as { snapshot: BluehourSnapshot };
  return decoded.snapshot;
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: toBufferSource(salt),
      iterations: PBKDF2_ITERATIONS
    },
    material,
    {
      name: "AES-GCM",
      length: 256
    },
    false,
    ["encrypt", "decrypt"]
  );
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function toBufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}
