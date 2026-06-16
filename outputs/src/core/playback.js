export function createPlaybackState(analysisResult) {
  const mistakes = analysisResult?.mistakes ?? [];
  const events = [
    ...(analysisResult?.notes ?? []).map((note) => ({ timeMs: note.timeMs, kind: "note", lane: note.lane })),
    ...(analysisResult?.keydowns ?? []).map((input) => ({ timeMs: input.timeMs, kind: "input", lane: input.lane })),
    ...mistakes.map((mistake) => ({ ...mistake, kind: "mistake" }))
  ].sort((a, b) => a.timeMs - b.timeMs || String(a.kind).localeCompare(String(b.kind)));

  const startMs = events[0]?.timeMs ?? 0;
  const endMs = events.at(-1)?.timeMs ?? 0;

  return {
    startMs,
    endMs,
    durationMs: Math.max(0, endMs - startMs),
    events,
    mistakes
  };
}

export function getPlaybackSnapshot(playbackState, currentTimeMs, lookbackMs = 450) {
  const activeMistakes = playbackState.mistakes.filter(
    (mistake) => mistake.timeMs <= currentTimeMs && mistake.timeMs >= currentTimeMs - lookbackMs
  );
  const nextMistake = playbackState.mistakes.find((mistake) => mistake.timeMs > currentTimeMs) ?? null;

  return {
    currentTimeMs,
    activeMistakes,
    nextMistake,
    progress: playbackState.durationMs === 0
      ? 1
      : clamp((currentTimeMs - playbackState.startMs) / playbackState.durationMs, 0, 1)
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
