/**
 * Centralised lookup for environment variables that the user can configure
 * under multiple aliases.
 *
 * The X-Node netlify clone introduced `FAL_KEY` (used by
 * `/api/xnode/run`), while the existing image/model API routes look up
 * `FAL_API_KEY`. Both refer to the same fal.ai server-side key, so we
 * accept either alias.
 *
 * Reads happen at call time (not module load) so test setups using
 * `process.env.FAL_API_KEY = ...` continue to work.
 */
export function getFalKey(): string | null {
  return process.env.FAL_KEY ?? process.env.FAL_API_KEY ?? null;
}

export function hasFalKey(): boolean {
  return Boolean(process.env.FAL_KEY ?? process.env.FAL_API_KEY);
}
