// Whether to buffer + persist raw call audio to WAV files and expose the
// /recordings endpoints. Enabled only outside production (dev/test debugging).
// In production we never write raw audio to disk (privacy) — only transcripts persist.
//
// IMPORTANT: read lazily (function, not a module-load constant). `.env` is loaded by
// dotenv at runtime AFTER this module is first imported, so a top-level const would
// capture NODE_ENV before it is set. Call this at request/runtime instead.
export function recordingsEnabled(): boolean {
  return process.env.NODE_ENV !== 'production';
}
