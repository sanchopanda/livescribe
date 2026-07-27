const DEFAULT_BASE = 'https://openrouter.ai/api/v1';
export function getOpenRouterKey(): string | undefined {
  return process.env.OPENROUTER_API_KEY || undefined;
}
export function isLlmConfigured(): boolean {
  return Boolean(getOpenRouterKey());
}
export function getBaseUrl(): string {
  return process.env.OPENROUTER_BASE_URL || DEFAULT_BASE;
}
export function getDetailedModel(): string {
  return process.env.LLM_MODEL_DETAILED || 'anthropic/claude-sonnet-4.5';
}
export function getLiveModel(): string {
  return process.env.LLM_MODEL_LIVE || 'anthropic/claude-haiku-4.5';
}
