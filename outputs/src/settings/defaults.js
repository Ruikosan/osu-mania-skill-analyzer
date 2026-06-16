export const SUPPORTED_LANE_COUNTS = [4, 6, 7, 8];

export const FINGER_OPTIONS = [
  { id: "leftPinky", ja: "左小指", en: "Left pinky" },
  { id: "leftRing", ja: "左薬指", en: "Left ring" },
  { id: "leftMiddle", ja: "左中指", en: "Left middle" },
  { id: "leftIndex", ja: "左人差し指", en: "Left index" },
  { id: "leftThumb", ja: "左親指", en: "Left thumb" },
  { id: "thumb", ja: "親指", en: "Thumb" },
  { id: "rightThumb", ja: "右親指", en: "Right thumb" },
  { id: "rightIndex", ja: "右人差し指", en: "Right index" },
  { id: "rightMiddle", ja: "右中指", en: "Right middle" },
  { id: "rightRing", ja: "右薬指", en: "Right ring" },
  { id: "rightPinky", ja: "右小指", en: "Right pinky" },
  { id: "custom", ja: "カスタム", en: "Custom" }
];

export const DEFAULT_PRESETS = {
  4: {
    keyBindings: ["D", "F", "J", "K"],
    fingerMap: ["leftMiddle", "leftIndex", "rightIndex", "rightMiddle"]
  },
  6: {
    keyBindings: ["S", "D", "F", "J", "K", "L"],
    fingerMap: ["leftRing", "leftMiddle", "leftIndex", "rightIndex", "rightMiddle", "rightRing"]
  },
  7: {
    keyBindings: ["A", "S", "D", "Space", "J", "K", "L"],
    fingerMap: ["leftRing", "leftMiddle", "leftIndex", "thumb", "rightIndex", "rightMiddle", "rightRing"]
  },
  8: {
    keyBindings: ["A", "S", "D", "F", "J", "K", "L", ";"],
    fingerMap: ["leftPinky", "leftRing", "leftMiddle", "leftIndex", "rightIndex", "rightMiddle", "rightRing", "rightPinky"]
  }
};

export const DEFAULT_SETTINGS = {
  laneCount: 4,
  keyBindings: [...DEFAULT_PRESETS[4].keyBindings],
  fingerMap: [...DEFAULT_PRESETS[4].fingerMap],
  language: "ja",
  timingWindowMs: 50,
  preNoteIgnoreMarginMs: 200,
  postNoteIgnoreMarginMs: 500
};

export function normalizeSettings(rawSettings = {}) {
  const laneCount = SUPPORTED_LANE_COUNTS.includes(Number(rawSettings.laneCount))
    ? Number(rawSettings.laneCount)
    : DEFAULT_SETTINGS.laneCount;
  const preset = DEFAULT_PRESETS[laneCount];
  const keyBindings = normalizeList(rawSettings.keyBindings, preset.keyBindings, laneCount);
  const fingerMap = normalizeList(rawSettings.fingerMap, preset.fingerMap, laneCount);
  const timingWindowMs = clampNumber(rawSettings.timingWindowMs, 10, 250, DEFAULT_SETTINGS.timingWindowMs);
  const preNoteIgnoreMarginMs = clampNumber(rawSettings.preNoteIgnoreMarginMs, 0, 5000, DEFAULT_SETTINGS.preNoteIgnoreMarginMs);
  const postNoteIgnoreMarginMs = clampNumber(rawSettings.postNoteIgnoreMarginMs, 0, 10000, DEFAULT_SETTINGS.postNoteIgnoreMarginMs);
  const language = rawSettings.language === "en" ? "en" : "ja";

  return {
    laneCount,
    keyBindings,
    fingerMap,
    language,
    timingWindowMs,
    preNoteIgnoreMarginMs,
    postNoteIgnoreMarginMs
  };
}

export function settingsForLaneCount(currentSettings, laneCount) {
  const preset = DEFAULT_PRESETS[laneCount] ?? DEFAULT_PRESETS[DEFAULT_SETTINGS.laneCount];
  return normalizeSettings({
    ...currentSettings,
    laneCount,
    keyBindings: preset.keyBindings,
    fingerMap: preset.fingerMap
  });
}

export function presetForLaneCount(currentSettings) {
  const preset = DEFAULT_PRESETS[currentSettings.laneCount] ?? DEFAULT_PRESETS[DEFAULT_SETTINGS.laneCount];
  return normalizeSettings({
    ...currentSettings,
    keyBindings: preset.keyBindings,
    fingerMap: preset.fingerMap
  });
}

export function getFingerLabel(fingerId, language) {
  const option = FINGER_OPTIONS.find((item) => item.id === fingerId);
  return option ? option[language] : fingerId;
}

function normalizeList(value, fallback, length) {
  const source = Array.isArray(value) ? value : [];
  return Array.from({ length }, (_, index) => {
    const item = source[index];
    const fallbackItem = fallback[index] ?? `Lane ${index + 1}`;
    return typeof item === "string" && item.trim() ? item.trim() : fallbackItem;
  });
}

function clampNumber(value, min, max, fallback) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numberValue)));
}
