// Whether to buffer + persist raw call audio to WAV files and expose the
// /recordings endpoints. Enabled only outside production (dev/test debugging).
// In production we never write raw audio to disk (privacy) — only transcripts persist.
export const RECORDINGS_ENABLED = process.env.NODE_ENV !== 'production';
