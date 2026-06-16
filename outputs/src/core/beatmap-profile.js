const DENSITY_WINDOW_MS = 1000;
const SHORT_INTERVAL_MIN_MS = 80;
const SHORT_INTERVAL_MAX_MS = 180;
const PATTERN_INTERVAL_MAX_MS = 220;

export function analyzeBeatmapFeatures(beatmap) {
  const notes = (beatmap.notes ?? [])
    .filter((note) => Number.isFinite(note.timeMs) && Number.isFinite(note.lane))
    .sort((a, b) => a.timeMs - b.timeMs || a.lane - b.lane);
  const totalNotes = notes.length;
  const tapNotes = notes.filter((note) => note.type === "note").length;
  const holdNotes = notes.filter((note) => note.type === "hold").length;
  const firstTimeMs = notes[0]?.timeMs ?? 0;
  const lastTimeMs = notes.reduce((max, note) => Math.max(max, note.endTimeMs ?? note.timeMs), firstTimeMs);
  const durationSec = Math.max((lastTimeMs - firstTimeMs) / 1000, 1);
  const laneCount = beatmap.laneCount ?? Math.max(...notes.map((note) => note.lane), 0);
  const laneCounts = countByLane(notes, laneCount);
  const handCounts = countByHand(notes, laneCount);
  const densityWindows = buildDensityWindows(notes, firstTimeMs, lastTimeMs);
  const maxDensitySection = densityWindows.reduce((best, section) => (section.nps > best.nps ? section : best), {
    startTimeMs: firstTimeMs,
    endTimeMs: firstTimeMs + DENSITY_WINDOW_MS,
    count: 0,
    nps: 0
  });
  const sameLaneStats = analyzeSameLaneRepeats(notes, laneCount);
  const patternStats = analyzeLanePatterns(notes);
  const chordStats = analyzeChords(notes);
  const sectionDensity = analyzeThirds(notes, firstTimeMs, lastTimeMs);
  const averageNps = totalNotes / durationSec;
  const peakNps = maxDensitySection.nps;
  const densityScore = clampScore((averageNps * 8) + (peakNps * 3));
  const leftHandDensity = handCounts.left / durationSec;
  const rightHandDensity = handCounts.right / durationSec;
  const leftHandBias = ratioDiff(handCounts.left, handCounts.right);
  const rightHandBias = ratioDiff(handCounts.right, handCounts.left);
  const sameLaneRepeatRate = ratio(sameLaneStats.repeatCount, Math.max(totalNotes - laneCount, 1));
  const jackScore = clampScore((sameLaneRepeatRate * 70) + (sameLaneStats.shortJackRate * 35) + (maxLaneBias(laneCounts, totalNotes) * 30));
  const trillScore = clampScore(patternStats.trillRate * 120);
  const staircaseScore = clampScore(patternStats.staircaseRate * 120);
  const chordRate = chordStats.chordNoteRate;
  const lateSectionDensity = sectionDensity.late.nps;
  const staminaScore = clampScore((ratio(lateSectionDensity, Math.max(averageNps, 0.1)) * 45) + (lateSectionDensity * 5));
  const lnRatio = ratio(holdNotes, totalNotes);
  const tapRatio = ratio(tapNotes, totalNotes);
  const profile = {
    totalNotes,
    tapNotes,
    holdNotes,
    lnRatio,
    tapRatio,
    totalDuration: durationSec,
    totalDurationMs: lastTimeMs - firstTimeMs,
    laneDensity: laneCounts.map((count, index) => ({
      lane: index + 1,
      notes: count,
      nps: count / durationSec,
      ratio: ratio(count, totalNotes)
    })),
    leftHandDensity,
    rightHandDensity,
    maxDensitySection,
    averageNps,
    peakNps,
    sameLaneRepeatRate,
    jackScore,
    trillScore,
    chordRate,
    staircaseScore,
    densityScore,
    staminaScore,
    leftHandBias,
    rightHandBias,
    lateSectionDensity,
    sectionDensity,
    difficultyTags: []
  };

  profile.difficultyTags = buildDifficultyTags(profile);
  return profile;
}

function countByLane(notes, laneCount) {
  const counts = Array.from({ length: laneCount }, () => 0);
  notes.forEach((note) => {
    if (note.lane >= 1 && note.lane <= laneCount) counts[note.lane - 1] += 1;
  });
  return counts;
}

function countByHand(notes, laneCount) {
  const centerLane = laneCount % 2 === 1 ? Math.ceil(laneCount / 2) : null;
  return notes.reduce(
    (counts, note) => {
      if (centerLane && note.lane === centerLane) counts.center += 1;
      else if (note.lane <= Math.floor(laneCount / 2)) counts.left += 1;
      else counts.right += 1;
      return counts;
    },
    { left: 0, center: 0, right: 0 }
  );
}

function buildDensityWindows(notes, firstTimeMs, lastTimeMs) {
  if (!notes.length) return [];
  const windows = [];
  for (let start = firstTimeMs; start <= lastTimeMs; start += DENSITY_WINDOW_MS) {
    const end = start + DENSITY_WINDOW_MS;
    const count = notes.filter((note) => note.timeMs >= start && note.timeMs < end).length;
    windows.push({
      startTimeMs: start,
      endTimeMs: end,
      count,
      nps: count / (DENSITY_WINDOW_MS / 1000)
    });
  }
  return windows;
}

function analyzeSameLaneRepeats(notes, laneCount) {
  let repeatCount = 0;
  let shortJackCount = 0;

  for (let lane = 1; lane <= laneCount; lane += 1) {
    const laneNotes = notes.filter((note) => note.lane === lane);
    for (let index = 1; index < laneNotes.length; index += 1) {
      const interval = laneNotes[index].timeMs - laneNotes[index - 1].timeMs;
      if (interval <= PATTERN_INTERVAL_MAX_MS) repeatCount += 1;
      if (interval >= SHORT_INTERVAL_MIN_MS && interval <= SHORT_INTERVAL_MAX_MS) shortJackCount += 1;
    }
  }

  return {
    repeatCount,
    shortJackCount,
    shortJackRate: ratio(shortJackCount, Math.max(notes.length, 1))
  };
}

function analyzeLanePatterns(notes) {
  let trillCount = 0;
  let staircaseCount = 0;

  for (let index = 2; index < notes.length; index += 1) {
    const a = notes[index - 2];
    const b = notes[index - 1];
    const c = notes[index];
    const intervalA = b.timeMs - a.timeMs;
    const intervalB = c.timeMs - b.timeMs;
    if (intervalA > PATTERN_INTERVAL_MAX_MS || intervalB > PATTERN_INTERVAL_MAX_MS) continue;

    if (a.lane === c.lane && a.lane !== b.lane) trillCount += 1;
    if ((a.lane < b.lane && b.lane < c.lane) || (a.lane > b.lane && b.lane > c.lane)) staircaseCount += 1;
  }

  return {
    trillCount,
    staircaseCount,
    trillRate: ratio(trillCount, Math.max(notes.length - 2, 1)),
    staircaseRate: ratio(staircaseCount, Math.max(notes.length - 2, 1))
  };
}

function analyzeChords(notes) {
  let chordNotes = 0;
  let index = 0;
  while (index < notes.length) {
    const groupStart = notes[index].timeMs;
    let groupSize = 1;
    while (index + groupSize < notes.length && Math.abs(notes[index + groupSize].timeMs - groupStart) <= 30) {
      groupSize += 1;
    }
    if (groupSize >= 2) chordNotes += groupSize;
    index += groupSize;
  }

  return {
    chordNotes,
    chordNoteRate: ratio(chordNotes, notes.length)
  };
}

function analyzeThirds(notes, firstTimeMs, lastTimeMs) {
  const duration = Math.max(lastTimeMs - firstTimeMs, 1);
  const sectionMs = duration / 3;
  const sections = [
    { id: "early", startTimeMs: firstTimeMs, endTimeMs: firstTimeMs + sectionMs },
    { id: "middle", startTimeMs: firstTimeMs + sectionMs, endTimeMs: firstTimeMs + sectionMs * 2 },
    { id: "late", startTimeMs: firstTimeMs + sectionMs * 2, endTimeMs: lastTimeMs }
  ];

  return Object.fromEntries(
    sections.map((section) => {
      const count = notes.filter((note) => note.timeMs >= section.startTimeMs && note.timeMs <= section.endTimeMs).length;
      const nps = count / Math.max((section.endTimeMs - section.startTimeMs) / 1000, 1);
      return [section.id, { ...section, count, nps }];
    })
  );
}

function buildDifficultyTags(profile) {
  const tags = [];
  if (profile.lnRatio >= 0.3) tags.push("ln_heavy");
  if (profile.jackScore >= 55) tags.push("jack_heavy");
  if (profile.chordRate >= 0.35) tags.push("chord_heavy");
  if (profile.leftHandBias >= 0.15) tags.push("left_hand_heavy");
  if (profile.rightHandBias >= 0.15) tags.push("right_hand_heavy");
  if (profile.averageNps >= 6 || profile.peakNps >= 12) tags.push("high_density");
  if (profile.lateSectionDensity >= profile.averageNps * 1.2 && profile.lateSectionDensity >= 5) tags.push("stamina", "late_density");
  if (profile.trillScore >= 50) tags.push("trill_heavy");
  if (profile.staircaseScore >= 45) tags.push("staircase_heavy");
  if (!tags.length) tags.push(profile.averageNps <= 3 ? "accuracy" : "balanced");
  return [...new Set(tags)];
}

function maxLaneBias(laneCounts, totalNotes) {
  if (!totalNotes) return 0;
  const average = totalNotes / Math.max(laneCounts.length, 1);
  const max = Math.max(...laneCounts, 0);
  return average > 0 ? Math.max(0, (max - average) / totalNotes) : 0;
}

function ratio(part, total) {
  return total > 0 ? part / total : 0;
}

function ratioDiff(a, b) {
  const total = a + b;
  return total > 0 ? (a - b) / total : 0;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}
