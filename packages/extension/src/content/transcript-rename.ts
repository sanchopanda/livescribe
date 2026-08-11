/**
 * Rewrite the label of replicas already shown. Returns the input array untouched when nothing
 * matches, so callers can skip a re-render.
 */
export function renameReplicaSpeaker<T extends { speaker: string }>(
  replicas: readonly T[],
  previousSpeaker: string,
  nextSpeaker: string,
): T[] {
  const from = previousSpeaker.trim();
  const to = nextSpeaker.trim();
  if (!from || !to || from === to) return replicas as T[];
  if (!replicas.some((replica) => replica.speaker === from)) return replicas as T[];

  return replicas.map((replica) =>
    replica.speaker === from ? { ...replica, speaker: to } : replica,
  );
}
