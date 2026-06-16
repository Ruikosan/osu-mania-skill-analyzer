import { MISTAKE_TYPES } from "../i18n/messages.js";

export function parseCsv(text) {
  const rows = splitCsv(text);
  if (rows.length === 0) {
    return { events: [], errors: [] };
  }

  const header = rows[0].map((cell) => cell.trim());
  const indexes = {
    time: header.indexOf("time_ms"),
    lane: header.indexOf("lane"),
    eventType: header.indexOf("event_type")
  };

  if (indexes.time === -1 || indexes.lane === -1 || indexes.eventType === -1) {
    return { events: [], errors: ["Missing required headers: time_ms,lane,event_type"] };
  }

  const errors = [];
  const events = [];

  rows.slice(1).forEach((row, rowIndex) => {
    if (row.every((cell) => cell.trim() === "")) return;

    const timeMs = Number(row[indexes.time]);
    const lane = Number(row[indexes.lane]);
    const eventType = String(row[indexes.eventType] ?? "").trim().toLowerCase();
    const line = rowIndex + 2;

    if (!Number.isFinite(timeMs)) {
      errors.push(`Line ${line}: invalid time_ms`);
      return;
    }

    if (!Number.isInteger(lane) || lane < 1) {
      errors.push(`Line ${line}: invalid lane`);
      return;
    }

    if (!["note", "keydown", "keyup"].includes(eventType)) {
      errors.push(`Line ${line}: invalid event_type`);
      return;
    }

    events.push({
      id: `${line}-${events.length}`,
      timeMs,
      lane,
      eventType,
      sourceLine: line
    });
  });

  events.sort((a, b) => a.timeMs - b.timeMs || a.lane - b.lane);
  return { events, errors };
}

export function analyzeEvents(events, settings) {
  const notes = events
    .filter((event) => event.eventType === "note" && event.lane <= settings.laneCount)
    .map((event, index) => ({ ...event, noteIndex: index, matched: false }));
  const keydowns = events
    .filter((event) => event.eventType === "keydown" && event.lane <= settings.laneCount)
    .map((event, index) => ({ ...event, inputIndex: index, matched: false }));
  const keyups = events
    .filter((event) => event.eventType === "keyup" && event.lane <= settings.laneCount)
    .map((event, index) => ({ ...event, inputIndex: index, matched: false }));

  const mistakes = [];
  const hits = [];

  for (let lane = 1; lane <= settings.laneCount; lane += 1) {
    const laneNotes = notes.filter((note) => note.lane === lane).sort(byTime);
    const laneInputs = keydowns.filter((input) => input.lane === lane).sort(byTime);
    const laneKeyups = keyups.filter((input) => input.lane === lane).sort(byTime);

    matchHits(laneNotes, laneInputs, settings.timingWindowMs, hits);
    matchHoldEnds(laneNotes, laneKeyups, mistakes, settings);
    matchTimingMistakes(laneNotes, laneInputs, mistakes, settings);
    addRemainingMisses(laneNotes, mistakes, settings);
    addRemainingExtras(laneInputs, mistakes, settings);
  }

  mistakes.sort((a, b) => a.timeMs - b.timeMs || a.lane - b.lane);
  hits.sort((a, b) => a.note.timeMs - b.note.timeMs || a.note.lane - b.note.lane);

  return {
    notes,
    keydowns,
    keyups,
    hits,
    mistakes,
    summary: summarize(mistakes, hits, notes, keydowns, settings),
    debug: buildAnalysisDebug(notes, keydowns, hits, mistakes, settings)
  };
}

export function buildAdvice(summary, settings, language, translate, getFingerLabel) {
  if (summary.totalMistakes === 0) {
    return [translate("noMistakes")];
  }

  const advice = [];
  const dominantType = getDominantEntry(summary.byType);

  if (dominantType && dominantType.count / summary.totalMistakes >= 0.35) {
    advice.push(translate("commonTypeAdvice")[dominantType.id] ?? `${translate(dominantType.id)}: ${dominantType.count}`);
  }

  const dominantFinger = getDominantNested(summary.byFingerType);
  if (dominantFinger && dominantFinger.count >= 2) {
    const fingerName = getFingerLabel(dominantFinger.id, language);
    const template = translate("fingerAdvice")[dominantFinger.type] ?? `${translate(dominantFinger.type)}: {finger}`;
    advice.push(template.replace("{finger}", fingerName.toLowerCase?.() ?? fingerName));
  }

  const laneEntry = getDominantEntry(summary.byLane);
  if (laneEntry && laneEntry.count >= 2 && advice.length < 3) {
    const keyName = settings.keyBindings[laneEntry.id - 1] ?? `Lane ${laneEntry.id}`;
    advice.push(`${translate("laneLabel")} ${laneEntry.id} / ${translate("key")} ${keyName}: ${laneEntry.count}`);
  }

  if (advice.length === 0) {
    advice.push(translate("balancedAdvice"));
  }

  return [...new Set(advice)].slice(0, 3);
}

function matchHits(laneNotes, laneInputs, timingWindowMs, hits) {
  laneNotes.forEach((note) => {
    const candidates = laneInputs
      .filter((input) => !input.matched && Math.abs(input.timeMs - note.timeMs) <= timingWindowMs)
      .sort((a, b) => Math.abs(a.timeMs - note.timeMs) - Math.abs(b.timeMs - note.timeMs));

    const input = candidates[0];
    if (!input) return;

    note.matched = true;
    input.matched = true;
    note.inputTimeMs = input.timeMs;
    hits.push({
      note,
      input,
      deltaMs: input.timeMs - note.timeMs
    });
  });
}

function matchTimingMistakes(laneNotes, laneInputs, mistakes, settings) {
  laneInputs
    .filter((input) => !input.matched)
    .forEach((input) => {
      const note = laneNotes
        .filter((candidate) => !candidate.matched)
        .sort((a, b) => Math.abs(input.timeMs - a.timeMs) - Math.abs(input.timeMs - b.timeMs))[0];

      if (!note) return;

      const deltaMs = input.timeMs - note.timeMs;
      const type = deltaMs < 0 ? "early" : "late";
      input.matched = true;
      note.matched = true;
      note.inputTimeMs = input.timeMs;
      mistakes.push(createMistake(type, note, input, deltaMs, settings));
    });
}

function matchHoldEnds(laneNotes, laneKeyups, mistakes, settings) {
  laneNotes
    .filter((note) => isHoldNote(note) && note.matched && Number.isFinite(note.endTimeMs))
    .forEach((note) => {
      const release = laneKeyups
        .filter((input) => !input.matched && input.timeMs >= note.inputTimeMs)
        .sort((a, b) => Math.abs(a.timeMs - note.endTimeMs) - Math.abs(b.timeMs - note.endTimeMs))[0];

      if (!release) {
        mistakes.push(createMistake("lnReleaseLate", note, null, null, settings, { endTimeMs: note.endTimeMs }));
        return;
      }

      const deltaMs = release.timeMs - note.endTimeMs;
      release.matched = true;

      if (Math.abs(deltaMs) <= settings.timingWindowMs) {
        note.holdEndMatched = true;
        note.releaseTimeMs = release.timeMs;
        note.releaseDeltaMs = deltaMs;
        return;
      }

      const type =
        deltaMs < -settings.timingWindowMs * 2
          ? "lnHoldBreak"
          : deltaMs < -settings.timingWindowMs
            ? "lnReleaseEarly"
            : "lnReleaseLate";
      mistakes.push(createMistake(type, note, release, deltaMs, settings, { endTimeMs: note.endTimeMs }));
    });
}

function addRemainingMisses(laneNotes, mistakes, settings) {
  laneNotes
    .filter((note) => !note.matched)
    .forEach((note) => {
      note.matched = true;
      mistakes.push(createMistake(isHoldNote(note) ? "lnStartMiss" : "missed", note, null, null, settings));
    });
}

function addRemainingExtras(laneInputs, mistakes, settings) {
  laneInputs
    .filter((input) => !input.matched)
    .forEach((input) => {
      input.matched = true;
      mistakes.push(createMistake("extra", null, input, null, settings));
    });
}

function createMistake(type, note, input, deltaMs, settings, extra = {}) {
  const lane = note?.lane ?? input.lane;
  const key = settings.keyBindings[lane - 1] ?? `Lane ${lane}`;
  const finger = settings.fingerMap[lane - 1] ?? "";

  return {
    id: `${type}-${lane}-${note?.id ?? "no-note"}-${input?.id ?? "no-input"}`,
    type,
    lane,
    key,
    finger,
    timeMs: note?.timeMs ?? input.timeMs,
    noteTimeMs: note?.timeMs ?? null,
    endTimeMs: extra.endTimeMs ?? note?.endTimeMs ?? null,
    inputTimeMs: input?.timeMs ?? null,
    deltaMs,
    noteType: note?.noteType ?? "note"
  };
}

function isHoldNote(note) {
  return note?.noteType === "hold" || note?.type === "hold";
}

function summarize(mistakes, hits, notes, keydowns, settings) {
  const byType = MISTAKE_TYPES.map((type) => ({
    id: type,
    count: mistakes.filter((mistake) => mistake.type === type).length
  }));
  const getTypeCount = (type) => byType.find((entry) => entry.id === type)?.count ?? 0;
  const analyzerMissCount =
    getTypeCount("missed") +
    getTypeCount("lnStartMiss") +
    getTypeCount("lnReleaseEarly") +
    getTypeCount("lnReleaseLate") +
    getTypeCount("lnHoldBreak");

  return {
    totalMistakes: mistakes.length,
    analyzerMissCount,
    hitCount: hits.length,
    noteCount: notes.length,
    inputCount: keydowns.length,
    byType,
    byLane: groupById(mistakes, (mistake) => mistake.lane, settings.laneCount),
    byKey: groupById(mistakes, (mistake) => mistake.key),
    byFinger: groupById(mistakes, (mistake) => mistake.finger || "unknown"),
    byFingerType: groupNested(mistakes, (mistake) => mistake.finger || "unknown", (mistake) => mistake.type),
    lnBreakdown: {
      tapNoteMiss: getTypeCount("missed"),
      lnStartMiss: getTypeCount("lnStartMiss"),
      lnEndMiss: getTypeCount("lnReleaseEarly") + getTypeCount("lnReleaseLate"),
      lnHoldBreak: getTypeCount("lnHoldBreak")
    }
  };
}

function groupById(items, getId, fixedLength = 0) {
  const map = new Map();
  if (fixedLength) {
    for (let lane = 1; lane <= fixedLength; lane += 1) {
      map.set(lane, 0);
    }
  }

  items.forEach((item) => {
    const id = getId(item);
    map.set(id, (map.get(id) ?? 0) + 1);
  });

  return Array.from(map, ([id, count]) => ({ id, count })).sort((a, b) => {
    if (typeof a.id === "number" && typeof b.id === "number") return a.id - b.id;
    return String(a.id).localeCompare(String(b.id));
  });
}

function groupNested(items, getId, getType) {
  const output = {};
  items.forEach((item) => {
    const id = getId(item);
    const type = getType(item);
    output[id] ??= {};
    output[id][type] = (output[id][type] ?? 0) + 1;
  });
  return output;
}

function getDominantEntry(entries) {
  return [...entries].sort((a, b) => b.count - a.count)[0] ?? null;
}

function getDominantNested(nested) {
  let best = null;
  Object.entries(nested).forEach(([id, byType]) => {
    Object.entries(byType).forEach(([type, count]) => {
      if (!best || count > best.count) {
        best = { id, type, count };
      }
    });
  });
  return best;
}

function byTime(a, b) {
  return a.timeMs - b.timeMs;
}

function buildAnalysisDebug(notes, keydowns, hits, mistakes, settings) {
  const hitDeltas = hits.map((hit) => hit.deltaMs).filter(Number.isFinite);
  const laneDeltaStats = [];

  for (let lane = 1; lane <= settings.laneCount; lane += 1) {
    const laneDeltas = hits.filter((hit) => hit.note.lane === lane).map((hit) => hit.deltaMs);
    laneDeltaStats.push({
      lane,
      key: settings.keyBindings[lane - 1] ?? `Lane ${lane}`,
      hitCount: laneDeltas.length,
      averageDeltaMs: roundStat(mean(laneDeltas)),
      medianDeltaMs: roundStat(median(laneDeltas))
    });
  }

  const firstMissedNotes = mistakes
    .filter((mistake) => mistake.type === "missed")
    .slice(0, 20)
    .map((mistake) => ({
      timeMs: mistake.noteTimeMs,
      lane: mistake.lane,
      key: mistake.key,
      nearestInput: findNearestInput(keydowns, mistake.lane, mistake.noteTimeMs)
    }));

  return {
    firstNotes: notes.slice(0, 20).map(toDebugEvent),
    firstInputs: keydowns.slice(0, 20).map(toDebugEvent),
    firstHits: hits.slice(0, 20).map((hit) => ({
      noteTimeMs: hit.note.timeMs,
      inputTimeMs: hit.input.timeMs,
      deltaMs: hit.deltaMs,
      lane: hit.note.lane,
      key: settings.keyBindings[hit.note.lane - 1] ?? `Lane ${hit.note.lane}`
    })),
    firstMissedNotes,
    hitDeltaSamples: hitDeltas.slice(0, 80),
    averageDeltaMs: roundStat(mean(hitDeltas)),
    medianDeltaMs: roundStat(median(hitDeltas)),
    laneDeltaStats,
    laneMapping: settings.keyBindings.map((key, index) => ({
      bitIndex: index,
      bitValue: 1 << index,
      lane: index + 1,
      key,
      reversedLane: settings.laneCount - index
    })),
    totals: {
      notes: notes.length,
      tapNotes: notes.filter((note) => !isHoldNote(note)).length,
      holdNotes: notes.filter(isHoldNote).length,
      keydowns: keydowns.length,
      hits: hits.length,
      mistakes: mistakes.length
    },
    lnBreakdown: summarizeLnDebug(mistakes)
  };
}

function summarizeLnDebug(mistakes) {
  return {
    tapNoteMiss: mistakes.filter((mistake) => mistake.type === "missed").length,
    lnStartMiss: mistakes.filter((mistake) => mistake.type === "lnStartMiss").length,
    lnEndMiss: mistakes.filter((mistake) => ["lnReleaseEarly", "lnReleaseLate"].includes(mistake.type)).length,
    lnReleaseEarly: mistakes.filter((mistake) => mistake.type === "lnReleaseEarly").length,
    lnReleaseLate: mistakes.filter((mistake) => mistake.type === "lnReleaseLate").length,
    lnHoldBreak: mistakes.filter((mistake) => mistake.type === "lnHoldBreak").length
  };
}

function toDebugEvent(event) {
  return {
    timeMs: event.timeMs,
    lane: event.lane,
    eventType: event.eventType,
    id: event.id
  };
}

function findNearestInput(keydowns, lane, timeMs) {
  const input = keydowns
    .filter((candidate) => candidate.lane === lane)
    .sort((a, b) => Math.abs(a.timeMs - timeMs) - Math.abs(b.timeMs - timeMs))[0];

  if (!input) return null;
  return {
    timeMs: input.timeMs,
    deltaMs: input.timeMs - timeMs,
    lane: input.lane
  };
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function roundStat(value) {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
}

function splitCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      cell += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((csvRow) => csvRow.some((csvCell) => csvCell.trim() !== ""));
}
