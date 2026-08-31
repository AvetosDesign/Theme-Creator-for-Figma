/**
 * Portable, non-cryptographic content hash for asset-dedup purposes
 * (`loadBundle.ts`'s `dedupeAssetsByContent`). Replaces `node:crypto`'s
 * `createHash("sha256")`, which is unavailable in the environment this
 * module needs to run in once Phase 9 ports Stage 2's disk-I/O boundary
 * to run inside the Figma plugin sandbox — that sandbox doesn't even
 * provide `TextEncoder` (see FigmaToCode's own
 * `packages/backend/src/zipGenerator.ts`/`designBundleUtils.ts`, which
 * both feature-detect it), so `node:crypto` is definitely not available
 * either.
 *
 * D63's own doc comment is explicit that this is a secondary, opportunistic
 * dedup pass, not a security- or correctness-critical mechanism — collapsing
 * two *different* assets onto the same generated filename because of a hash
 * collision would be a real (if extremely unlikely) bug, but nothing here
 * depends on cryptographic collision-resistance the way, say, a content-
 * addressed store used for integrity verification would. A well-distributed
 * 64-bit non-cryptographic hash is more than sufficient for "did the Figma
 * export happen to include the same image bytes twice."
 *
 * FNV-1a chosen specifically because it operates byte-by-byte directly on a
 * `Uint8Array` with no intermediate string/encoding step at all — the exact
 * property that makes it portable to an environment with no `TextEncoder`.
 */

// FNV-1a 64-bit constants (offset basis and prime), per the published
// FNV spec. Computed with BigInt to avoid the 32-bit overflow a plain
// `number` would hit after only a handful of bytes.
const FNV_OFFSET_BASIS_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

export const hashBytes = (bytes: Uint8Array): string => {
  let hash = FNV_OFFSET_BASIS_64;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= BigInt(bytes[i]);
    hash = (hash * FNV_PRIME_64) & MASK_64;
  }
  return hash.toString(16).padStart(16, "0");
};
