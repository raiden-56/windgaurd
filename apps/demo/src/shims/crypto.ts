import { Buffer } from 'buffer';

export function randomBytes(size: number) {
  const bytes = new Uint8Array(size);
  globalThis.crypto.getRandomValues(bytes);
  return Buffer.from(bytes);
}
export function randomUUID() {
  return globalThis.crypto.randomUUID();
}
export const webcrypto = globalThis.crypto;
export default { randomBytes, randomUUID, webcrypto };
