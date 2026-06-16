export function parseOsuManiaBeatmap(text, fallbackLaneCount = 4) {
  const sections = splitSections(text);
  const general = parseKeyValueSection(sections.General ?? []);
  const metadata = parseKeyValueSection(sections.Metadata ?? []);
  const difficulty = parseKeyValueSection(sections.Difficulty ?? []);
  const laneCount = Number(difficulty.CircleSize) || fallbackLaneCount;
  const audioLeadInMs = parseOptionalNumber(general.AudioLeadIn, 0);
  const previewTimeMs = parseOptionalNumber(general.PreviewTime, null);
  const hitObjects = (sections.HitObjects ?? [])
    .map((line, index) => parseHitObject(line, index, laneCount))
    .filter(Boolean)
    .sort((a, b) => a.timeMs - b.timeMs || a.lane - b.lane);

  return {
    laneCount,
    audioLeadInMs,
    previewTimeMs,
    title: metadata.TitleUnicode || metadata.Title || "",
    artist: metadata.ArtistUnicode || metadata.Artist || "",
    version: metadata.Version || "",
    creator: metadata.Creator || "",
    notes: hitObjects,
    tapNoteCount: hitObjects.filter((note) => note.type === "note").length,
    holdNoteCount: hitObjects.filter((note) => note.type === "hold").length,
    events: hitObjects.map((note) => ({
      id: note.id,
      timeMs: note.timeMs,
      lane: note.lane,
      eventType: "note",
      noteType: note.type,
      endTimeMs: note.endTimeMs ?? null,
      source: "beatmap"
    }))
  };
}

function parseOptionalNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function splitSections(text) {
  const sections = {};
  let currentSection = null;

  text.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("//")) return;

    const sectionMatch = line.match(/^\[(.+)]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      sections[currentSection] = [];
      return;
    }

    if (currentSection) {
      sections[currentSection].push(line);
    }
  });

  return sections;
}

function parseKeyValueSection(lines) {
  return Object.fromEntries(
    lines
      .map((line) => line.split(":"))
      .filter((parts) => parts.length >= 2)
      .map(([key, ...valueParts]) => [key.trim(), valueParts.join(":").trim()])
  );
}

function parseHitObject(line, index, laneCount) {
  const parts = line.split(",");
  if (parts.length < 5) return null;

  const x = Number(parts[0]);
  const timeMs = Number(parts[2]);
  const type = Number(parts[3]);
  const isHitCircle = (type & 1) > 0;
  const isHold = (type & 128) > 0;
  const endTimeMs = isHold ? parseHoldEndTime(parts[5]) : null;

  if (!Number.isFinite(x) || !Number.isFinite(timeMs)) return null;

  const lane = Math.min(laneCount, Math.max(1, Math.floor((x * laneCount) / 512) + 1));

  return {
    id: `beatmap-${index}`,
    timeMs,
    endTimeMs,
    lane,
    type: isHold ? "hold" : isHitCircle ? "note" : "unknown",
    raw: line
  };
}

function parseHoldEndTime(objectParams) {
  const endTime = Number(String(objectParams ?? "").split(":")[0]);
  return Number.isFinite(endTime) ? endTime : null;
}
