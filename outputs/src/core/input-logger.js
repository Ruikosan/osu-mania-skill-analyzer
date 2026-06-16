export function createInputLoggerState() {
  return {
    isRecording: false,
    startedAtMs: 0,
    events: [],
    pressedKeys: new Set()
  };
}

export function startInputLogger(logger, nowMs = performance.now()) {
  logger.isRecording = true;
  logger.startedAtMs = nowMs;
  logger.events = [];
  logger.pressedKeys = new Set();
  return logger;
}

export function stopInputLogger(logger) {
  logger.isRecording = false;
  logger.pressedKeys.clear();
  return logger;
}

export function clearInputLogger(logger) {
  logger.events = [];
  logger.pressedKeys.clear();
  return logger;
}

export function recordKeyboardEvent(logger, keyboardEvent, settings, nowMs = performance.now()) {
  if (!logger.isRecording) return null;

  const keyName = normalizeKeyboardKey(keyboardEvent);
  const lane = getLaneForKey(keyName, settings.keyBindings);
  if (!lane) return null;

  const eventType = keyboardEvent.type === "keyup" ? "keyup" : "keydown";
  const pressedId = keyName.toLowerCase();

  if (eventType === "keydown") {
    if (keyboardEvent.repeat || logger.pressedKeys.has(pressedId)) return null;
    logger.pressedKeys.add(pressedId);
  } else {
    if (!logger.pressedKeys.has(pressedId)) return null;
    logger.pressedKeys.delete(pressedId);
  }

  const inputEvent = {
    id: `live-${logger.events.length}`,
    timeMs: Math.max(0, Math.round(nowMs - logger.startedAtMs)),
    lane,
    key: settings.keyBindings[lane - 1] ?? keyName,
    eventType,
    source: "live"
  };

  logger.events.push(inputEvent);
  return inputEvent;
}

export function inputEventsToCsv(events) {
  const rows = [["time_ms", "lane", "key", "event_type"]];
  events.forEach((event) => {
    rows.push([event.timeMs, event.lane, event.key, event.eventType]);
  });
  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n");
}

export function normalizeKeyboardKey(keyboardEvent) {
  if (keyboardEvent.code === "Space" || keyboardEvent.key === " ") return "Space";
  if (keyboardEvent.key && keyboardEvent.key.length === 1) return keyboardEvent.key.toUpperCase();
  return keyboardEvent.key ?? "";
}

function getLaneForKey(keyName, keyBindings) {
  const normalized = keyName.toLowerCase();
  const index = keyBindings.findIndex((binding) => binding.toLowerCase() === normalized);
  return index === -1 ? null : index + 1;
}

function escapeCsvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
