export function parseReplayFrameText(frameText) {
  return String(frameText)
    .split(",")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk, index) => parseReplayFrame(chunk, index))
    .filter(Boolean)
    .reduce(
      (state, frame) => {
        if (frame.deltaMs < 0) {
          state.frames.push({ ...frame, timeMs: state.currentTimeMs, isSentinel: true });
          return state;
        }

        state.currentTimeMs += frame.deltaMs;
        state.frames.push({ ...frame, timeMs: state.currentTimeMs, isSentinel: false });
        return state;
      },
      { currentTimeMs: 0, frames: [] }
    ).frames;
}

export function replayFramesToManiaInputEvents(frames, laneCount) {
  return replayFramesToManiaInputEventsWithDebug(frames, laneCount).events;
}

export function replayFramesToManiaInputEventsWithDebug(frames, laneCount) {
  const events = [];
  let previousMask = 0;
  const maskSource = chooseManiaMaskSource(frames, laneCount);

  frames
    .filter((frame) => !frame.isSentinel)
    .forEach((frame, frameIndex) => {
      const currentMask = getFrameMask(frame, maskSource.source);

      for (let laneIndex = 0; laneIndex < laneCount; laneIndex += 1) {
        const bit = 1 << laneIndex;
        const wasPressed = (previousMask & bit) !== 0;
        const isPressed = (currentMask & bit) !== 0;

        if (wasPressed === isPressed) continue;

        events.push({
          id: `replay-${frameIndex}-${laneIndex}`,
          timeMs: frame.timeMs,
          lane: laneIndex + 1,
          eventType: isPressed ? "keydown" : "keyup",
          source: "osr"
        });
      }

      previousMask = currentMask;
    });

  return {
    events,
    debug: {
      bitmaskSource: maskSource.source,
      bitmaskReason: maskSource.reason,
      keyChangeCount: events.length,
      maskStats: maskSource.stats
    }
  };
}

export function decodeReplayFramesToEvents(frameText, settings) {
  const frames = parseReplayFrameText(frameText);
  const converted = replayFramesToManiaInputEventsWithDebug(frames, settings.laneCount);
  return {
    frames,
    events: converted.events,
    debug: {
      frameTextLength: String(frameText).length,
      frameTextPreview: String(frameText).slice(0, 500),
      rawFrameChunkCount: countRawFrameChunks(frameText),
      parsedFrameCount: frames.length,
      parsedFrameSamples: frames.slice(0, 12).map((frame) => ({
        deltaMs: frame.deltaMs,
        timeMs: frame.timeMs,
        x: frame.x,
        y: frame.y,
        keys: frame.keys,
        isSentinel: frame.isSentinel
      })),
      ...converted.debug
    }
  };
}

function parseReplayFrame(chunk, index) {
  const parts = chunk.split("|");
  if (parts.length < 4) return null;

  const deltaMs = Number(parts[0]);
  const x = Number(parts[1]);
  const y = Number(parts[2]);
  const keys = Number(parts[3]);

  if (![deltaMs, x, y, keys].every(Number.isFinite)) return null;

  return {
    id: `frame-${index}`,
    deltaMs,
    x,
    y,
    keys
  };
}

function chooseManiaMaskSource(frames, laneCount) {
  const activeFrames = frames.filter((frame) => !frame.isSentinel);
  const candidates = ["keys", "x", "y"].map((source) => ({
    source,
    stats: getMaskStats(activeFrames, source, laneCount)
  }));

  const keysCandidate = candidates.find((candidate) => candidate.source === "keys");
  if (keysCandidate.stats.changeCount > 0) {
    return {
      source: "keys",
      reason: "The replay keys field contains key changes.",
      stats: Object.fromEntries(candidates.map((candidate) => [candidate.source, candidate.stats]))
    };
  }

  const fallback = candidates
    .filter((candidate) => candidate.source !== "keys")
    .sort((a, b) => b.stats.changeCount - a.stats.changeCount || b.stats.nonZeroCount - a.stats.nonZeroCount)[0];

  if (fallback?.stats.changeCount > 0) {
    return {
      source: fallback.source,
      reason: `The replay keys field has no changes; using ${fallback.source} because it contains changing mania-style bitmasks.`,
      stats: Object.fromEntries(candidates.map((candidate) => [candidate.source, candidate.stats]))
    };
  }

  return {
    source: "keys",
    reason: "No candidate field contained key changes.",
    stats: Object.fromEntries(candidates.map((candidate) => [candidate.source, candidate.stats]))
  };
}

function getMaskStats(frames, source, laneCount) {
  let previousMask = 0;
  let changeCount = 0;
  let nonZeroCount = 0;
  const uniqueMasks = new Set();
  const sampleMasks = [];
  const maxAllowedMask = (1 << laneCount) - 1;

  frames.forEach((frame) => {
    const mask = getFrameMask(frame, source);
    uniqueMasks.add(mask);
    if (mask !== 0) nonZeroCount += 1;
    if (mask !== previousMask) changeCount += 1;
    if (sampleMasks.length < 16 && !sampleMasks.includes(mask)) sampleMasks.push(mask);
    previousMask = mask;
  });

  return {
    frameCount: frames.length,
    changeCount,
    nonZeroCount,
    uniqueMaskCount: uniqueMasks.size,
    sampleMasks,
    withinLaneMaskCount: [...uniqueMasks].filter((mask) => mask >= 0 && mask <= maxAllowedMask).length
  };
}

function getFrameMask(frame, source) {
  const value = source === "x" ? frame.x : source === "y" ? frame.y : frame.keys;
  return Math.max(0, Math.trunc(Number(value) || 0));
}

function countRawFrameChunks(frameText) {
  return String(frameText)
    .split(",")
    .map((chunk) => chunk.trim())
    .filter(Boolean).length;
}
