import {
  DEFAULT_SETTINGS,
  FINGER_OPTIONS,
  SUPPORTED_LANE_COUNTS,
  getFingerLabel,
  normalizeSettings,
  presetForLaneCount,
  settingsForLaneCount
} from "../settings/defaults.js";
import { analyzeEvents, buildAdvice, parseCsv } from "../core/analysis.js";
import { parseOsrMetadata, parseOsrReplay } from "../core/osr.js";
import { parseOsuManiaBeatmap } from "../core/beatmap.js";
import { analyzeBeatmapFeatures } from "../core/beatmap-profile.js";
import { buildPlayerProfile } from "../core/profile.js?v=v1-ui-cleanup";
import { createPlaybackState, getPlaybackSnapshot } from "../core/playback.js";
import { getReplayDecoderAdapter } from "../adapters/replay-decoder.js";
import {
  clearInputLogger,
  createInputLoggerState,
  inputEventsToCsv,
  recordKeyboardEvent,
  startInputLogger,
  stopInputLogger
} from "../core/input-logger.js";
import { t } from "../i18n/messages.js?v=v1-ui-cleanup";

const STORAGE_KEY = "mania-miss-analyzer-settings-v1";

const sampleCsv = `time_ms,lane,event_type
1000,1,note
998,1,keydown
1050,1,keyup
1200,2,note
1130,2,keydown
1190,2,keyup
1400,3,note
1485,3,keydown
1530,3,keyup
1600,4,note
1800,1,keydown
1840,1,keyup
2000,2,note
1998,2,keydown
2050,2,keyup`;

const state = {
  settings: loadSettings(),
  analysisResult: null,
  analysisMode: "none",
  analysisMessageKey: "noData",
  osrMissCount: null,
  osrMetadata: null,
  replayDebug: null,
  replayOffsetDebug: null,
  replayInputEvents: [],
  replayFrameCount: 0,
  beatmap: null,
  hasCsvInput: false,
  statusMessageKey: "",
  statusMessageText: "",
  playbackState: createPlaybackState(null),
  playbackTimeMs: 0,
  isPlaying: false,
  inputLogger: createInputLoggerState(),
  multiSets: Array.from({ length: 5 }, () => ({ osrFile: null, osuFile: null })),
  multiAnalysisRecords: [],
  playerProfile: null
};

let playbackTimerId = null;
let playbackStartedAt = 0;
let playbackStartTimeMs = 0;
let inputLogTimerId = null;

const elements = {
  languageButton: document.querySelector("#languageButton"),
  loadSampleButton: document.querySelector("#loadSampleButton"),
  resetSettingsButton: document.querySelector("#resetSettingsButton"),
  laneCountSelect: document.querySelector("#laneCountSelect"),
  timingWindowInput: document.querySelector("#timingWindowInput"),
  preNoteIgnoreMarginInput: document.querySelector("#preNoteIgnoreMarginInput"),
  postNoteIgnoreMarginInput: document.querySelector("#postNoteIgnoreMarginInput"),
  applyPresetButton: document.querySelector("#applyPresetButton"),
  bindingEditor: document.querySelector("#bindingEditor"),
  fingerEditor: document.querySelector("#fingerEditor"),
  csvFileInput: document.querySelector("#csvFileInput"),
  osrFileInput: document.querySelector("#osrFileInput"),
  beatmapFileInput: document.querySelector("#beatmapFileInput"),
  multiSetList: document.querySelector("#multiSetList"),
  multiAnalyzeButton: document.querySelector("#multiAnalyzeButton"),
  multiResetAllButton: document.querySelector("#multiResetAllButton"),
  multiStatus: document.querySelector("#multiStatus"),
  multiResults: document.querySelector("#multiResults"),
  playerProfile: document.querySelector("#playerProfile"),
  inputCaptureArea: document.querySelector("#inputCaptureArea"),
  inputLogStatus: document.querySelector("#inputLogStatus"),
  inputRecordButton: document.querySelector("#inputRecordButton"),
  inputClearButton: document.querySelector("#inputClearButton"),
  inputUseCsvButton: document.querySelector("#inputUseCsvButton"),
  inputExportButton: document.querySelector("#inputExportButton"),
  inputLogCount: document.querySelector("#inputLogCount"),
  inputLogTime: document.querySelector("#inputLogTime"),
  inputLogTable: document.querySelector("#inputLogTable"),
  osrMetadata: document.querySelector("#osrMetadata"),
  replayDebug: document.querySelector("#replayDebug"),
  analysisDebug: document.querySelector("#analysisDebug"),
  beatmapMetadata: document.querySelector("#beatmapMetadata"),
  csvTextArea: document.querySelector("#csvTextArea"),
  analyzeButton: document.querySelector("#analyzeButton"),
  singleResetButton: document.querySelector("#singleResetButton"),
  statusText: document.querySelector("#statusText"),
  summaryBadge: document.querySelector("#summaryBadge"),
  osrComparison: document.querySelector("#osrComparison"),
  totalMistakes: document.querySelector("#totalMistakes"),
  hitCount: document.querySelector("#hitCount"),
  noteCount: document.querySelector("#noteCount"),
  inputCount: document.querySelector("#inputCount"),
  typeBars: document.querySelector("#typeBars"),
  laneTable: document.querySelector("#laneTable"),
  keyTable: document.querySelector("#keyTable"),
  fingerTable: document.querySelector("#fingerTable"),
  timeline: document.querySelector("#timeline"),
  playbackButton: document.querySelector("#playbackButton"),
  playbackRange: document.querySelector("#playbackRange"),
  playbackCurrentTime: document.querySelector("#playbackCurrentTime"),
  playbackNextMistake: document.querySelector("#playbackNextMistake"),
  activeMistakes: document.querySelector("#activeMistakes"),
  adviceList: document.querySelector("#adviceList")
};

try {
  init();
  window.__maniaAppInitialized = true;
} catch (error) {
  window.__maniaAppInitError = {
    message: error.message,
    stack: error.stack
  };
  console.error("App initialization failed", error);
}

function init() {
  renderLaneOptions();
  bindEvents();
  render();
  setStatusKey("");
}

function bindEvents() {
  elements.languageButton.addEventListener("click", () => {
    updateSettings({ language: state.settings.language === "ja" ? "en" : "ja" });
  });

  elements.loadSampleButton.addEventListener("click", () => {
    elements.csvTextArea.value = sampleCsv;
    state.hasCsvInput = true;
    setStatusKey("");
    runAnalysis();
  });

  elements.resetSettingsButton.addEventListener("click", () => {
    state.settings = normalizeSettings(DEFAULT_SETTINGS);
    saveSettings();
    render();
    rerunAnalysisIfReady();
  });

  elements.laneCountSelect.addEventListener("change", (event) => {
    state.settings = settingsForLaneCount(state.settings, Number(event.target.value));
    saveSettings();
    render();
    rerunAnalysisIfReady();
  });

  elements.timingWindowInput.addEventListener("change", (event) => {
    updateSettings({ timingWindowMs: Number(event.target.value) });
    rerunAnalysisIfReady();
  });

  elements.preNoteIgnoreMarginInput.addEventListener("change", (event) => {
    updateSettings({ preNoteIgnoreMarginMs: Number(event.target.value) });
    rerunAnalysisIfReady();
  });

  elements.postNoteIgnoreMarginInput.addEventListener("change", (event) => {
    updateSettings({ postNoteIgnoreMarginMs: Number(event.target.value) });
    rerunAnalysisIfReady();
  });

  elements.applyPresetButton.addEventListener("click", () => {
    state.settings = presetForLaneCount(state.settings);
    saveSettings();
    render();
    rerunAnalysisIfReady();
  });

  elements.bindingEditor.addEventListener("input", (event) => {
    const index = Number(event.target.dataset.index);
    if (!Number.isInteger(index)) return;
    const keyBindings = [...state.settings.keyBindings];
    keyBindings[index] = event.target.value.trim() || `Lane ${index + 1}`;
    savePartialSettings({ keyBindings });
    rerunAnalysisIfReady();
  });
  elements.bindingEditor.addEventListener("change", renderFingerEditor);

  elements.fingerEditor.addEventListener("change", handleFingerChange);
  elements.fingerEditor.addEventListener("input", handleCustomFingerInput);

  elements.csvFileInput.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    elements.csvTextArea.value = await file.text();
    state.hasCsvInput = true;
    setStatusKey("fileLoaded");
    runAnalysis();
  });

  elements.csvTextArea.addEventListener("input", () => {
    state.hasCsvInput = elements.csvTextArea.value.trim().length > 0;
  });

  elements.osrFileInput.addEventListener("change", handleOsrFile);
  elements.beatmapFileInput.addEventListener("change", handleBeatmapFile);
  elements.multiSetList.addEventListener("change", handleMultiSetFileChange);
  elements.multiSetList.addEventListener("click", handleMultiSetResetClick);
  elements.multiAnalyzeButton.addEventListener("click", runMultiReplayAnalysis);
  elements.multiResetAllButton.addEventListener("click", resetAllMultiSets);
  elements.analyzeButton.addEventListener("click", runAnalysis);
  elements.singleResetButton.addEventListener("click", resetSingleAnalysis);
  elements.inputRecordButton.addEventListener("click", toggleInputRecording);
  elements.inputClearButton.addEventListener("click", clearRecordedInputs);
  elements.inputUseCsvButton.addEventListener("click", useInputLogAsCsv);
  elements.inputExportButton.addEventListener("click", exportInputLogCsv);
  document.addEventListener("keydown", handleInputLogKeyEvent);
  document.addEventListener("keyup", handleInputLogKeyEvent);
  elements.playbackButton.addEventListener("click", togglePlayback);
  elements.playbackRange.addEventListener("input", (event) => {
    stopPlayback();
    state.playbackTimeMs = Number(event.target.value);
    renderPlayback();
  });
}

function render() {
  document.documentElement.lang = state.settings.language;
  renderStaticText();
  renderSettings();
  renderInputLog();
  renderFileMetadata();
  renderMultiFileLabels();
  renderMultiAnalysis();
  renderResults();
  renderStatus();
}

function toggleInputRecording() {
  if (state.inputLogger.isRecording) {
    stopInputLogger(state.inputLogger);
    stopInputLogTimer();
    renderInputLog();
    setStatusKey("inputRecordingStopped");
    return;
  }

  startInputLogger(state.inputLogger);
  elements.inputCaptureArea.focus();
  startInputLogTimer();
  renderInputLog();
  setStatusKey("inputRecordingStarted");
}

function handleInputLogKeyEvent(event) {
  if (!state.inputLogger.isRecording) return;
  if (isEditableTarget(event.target) && event.target !== elements.inputCaptureArea) return;

  const recorded = recordKeyboardEvent(state.inputLogger, event, state.settings);
  if (!recorded) return;

  event.preventDefault();
  renderInputLog();
}

function clearRecordedInputs() {
  clearInputLogger(state.inputLogger);
  renderInputLog();
  setStatusKey("inputLogCleared");
}

function useInputLogAsCsv() {
  const csv = inputEventsToCsv(state.inputLogger.events);
  elements.csvTextArea.value = csv;
  state.hasCsvInput = state.inputLogger.events.length > 0;
  setStatusKey("inputLogCopiedToCsv");
  if (state.hasCsvInput) runAnalysis();
}

function exportInputLogCsv() {
  const csv = inputEventsToCsv(state.inputLogger.events);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `mania-input-log-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  setStatusKey("inputLogExported");
}

function renderInputLog() {
  const logger = state.inputLogger;
  const elapsedMs = logger.isRecording ? performance.now() - logger.startedAtMs : getLastInputTime(logger.events);
  elements.inputLogStatus.textContent = t(state.settings.language, logger.isRecording ? "recording" : "idle");
  elements.inputRecordButton.textContent = t(state.settings.language, logger.isRecording ? "stopRecording" : "startRecording");
  elements.inputLogCount.textContent = String(logger.events.length);
  elements.inputLogTime.textContent = formatTime(elapsedMs);
  elements.inputUseCsvButton.disabled = logger.events.length === 0;
  elements.inputExportButton.disabled = logger.events.length === 0;
  elements.inputClearButton.disabled = logger.events.length === 0 && !logger.isRecording;

  const recentEvents = logger.events.slice(-80).reverse();
  elements.inputLogTable.innerHTML = recentEvents.length
    ? recentEvents.map(renderInputLogRow).join("")
    : `<p class="empty-state">${t(state.settings.language, "noRecordedInputs")}</p>`;
}

function renderInputLogRow(event) {
  return `
    <div class="input-log-row">
      <strong>${formatTime(event.timeMs)}</strong>
      <span>${t(state.settings.language, "laneLabel")} ${event.lane}</span>
      <span>${escapeHtml(event.key)}</span>
      <span>${event.eventType}</span>
    </div>
  `;
}

function startInputLogTimer() {
  stopInputLogTimer();
  inputLogTimerId = window.setInterval(renderInputLog, 100);
}

function stopInputLogTimer() {
  if (inputLogTimerId !== null) {
    window.clearInterval(inputLogTimerId);
    inputLogTimerId = null;
  }
}

function getLastInputTime(events) {
  return events.length ? events[events.length - 1].timeMs : 0;
}

function isEditableTarget(target) {
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName) || target?.isContentEditable;
}

function renderStaticText() {
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t(state.settings.language, node.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-title]").forEach((node) => {
    node.title = t(state.settings.language, node.dataset.i18nTitle);
  });
  elements.languageButton.textContent = t(state.settings.language, "languageButton");
}

function renderLaneOptions() {
  elements.laneCountSelect.innerHTML = SUPPORTED_LANE_COUNTS.map(
    (laneCount) => `<option value="${laneCount}">${laneCount}K</option>`
  ).join("");
}

function renderSettings() {
  elements.laneCountSelect.value = String(state.settings.laneCount);
  elements.timingWindowInput.value = String(state.settings.timingWindowMs);
  elements.preNoteIgnoreMarginInput.value = String(state.settings.preNoteIgnoreMarginMs);
  elements.postNoteIgnoreMarginInput.value = String(state.settings.postNoteIgnoreMarginMs);
  renderBindingEditor();
  renderFingerEditor();
}

function renderBindingEditor() {
  elements.bindingEditor.innerHTML = state.settings.keyBindings
    .map(
      (keyName, index) => `
        <div class="lane-row">
          <label for="key-${index}">${t(state.settings.language, "laneLabel")} ${index + 1}</label>
          <input id="key-${index}" data-index="${index}" value="${escapeHtml(keyName)}" />
        </div>
      `
    )
    .join("");
}

function renderFingerEditor() {
  elements.fingerEditor.innerHTML = state.settings.fingerMap
    .map((fingerId, index) => {
      const isKnown = FINGER_OPTIONS.some((finger) => finger.id === fingerId);
      const selectValue = isKnown ? fingerId : "custom";
      const customInput = isKnown
        ? ""
        : `<input data-custom-index="${index}" value="${escapeHtml(fingerId)}" aria-label="${t(state.settings.language, "customFinger")}" />`;

      return `
        <div class="lane-row">
          <label for="finger-${index}">${state.settings.keyBindings[index] ?? index + 1}</label>
          <div class="finger-controls">
            <select id="finger-${index}" data-index="${index}">
              ${FINGER_OPTIONS.map(
                (finger) =>
                  `<option value="${finger.id}" ${finger.id === selectValue ? "selected" : ""}>${finger[state.settings.language]}</option>`
              ).join("")}
            </select>
            ${customInput}
          </div>
        </div>
      `;
    })
    .join("");
}

function runAnalysis() {
  const csvText = elements.csvTextArea.value.trim();
  const hasCsvText = csvText.length > 0;
  const hasReplayInput = state.replayInputEvents.length > 0;
  const hasBeatmap = Boolean(state.beatmap?.events?.length);

  state.hasCsvInput = hasCsvText;

  if (!hasCsvText && !hasReplayInput && !hasBeatmap) {
    clearAnalysis("noInputData");
    return;
  }

  if (!hasCsvText && hasBeatmap && !hasReplayInput) {
    clearAnalysis("replayInputMissing");
    return;
  }

  if (!hasCsvText && hasReplayInput && !hasBeatmap) {
    clearAnalysis("noInputData");
    return;
  }

  const parsed = hasCsvText ? parseCsv(csvText) : { events: [], errors: [] };
  if (parsed.errors.length) {
    state.analysisResult = null;
    renderResults();
    setStatusText(`${t(state.settings.language, "parseError")} ${parsed.errors[0]}`);
    return;
  }

  state.analysisMode = hasCsvText ? "csv" : "replay";
  const audioLeadInMs = getBeatmapAudioLeadInMs();
  const normalizedReplayEvents = !hasCsvText && hasReplayInput && hasBeatmap
    ? normalizeReplayTimesForBeatmap(state.replayInputEvents, audioLeadInMs)
    : state.replayInputEvents;
  const noteWindowEvents = hasBeatmap ? state.beatmap.events : parsed.events.filter((event) => event.eventType === "note");
  const csvWindow = hasCsvText
    ? filterCsvEventsToAnalysisWindow(parsed.events, noteWindowEvents, state.settings)
    : { events: parsed.events, debug: createEmptyAnalysisWindowDebug(noteWindowEvents, state.settings) };
  const rawReplayWindow = filterInputEventsToAnalysisWindow(state.replayInputEvents, noteWindowEvents, state.settings);
  const normalizedReplayWindow = filterInputEventsToAnalysisWindow(normalizedReplayEvents, noteWindowEvents, state.settings);
  const rawSourceEvents = buildAnalysisEvents(csvWindow.events, rawReplayWindow.events);
  const normalizedSourceEvents = buildAnalysisEvents(csvWindow.events, normalizedReplayWindow.events);
  const rawAnalysis = analyzeEvents(rawSourceEvents, state.settings);
  const audioLeadInAnalysis = normalizedReplayEvents === state.replayInputEvents
    ? rawAnalysis
    : analyzeEvents(normalizedSourceEvents, state.settings);

  if (!hasCsvText && hasReplayInput && hasBeatmap) {
    const rawOffsetDebug = findBestReplayOffset(state.beatmap.events, rawReplayWindow.events, state.settings);
    const calibration = findBestReplayCalibration(state.beatmap.events, normalizedReplayWindow.events, state.settings, state.osrMissCount);
    const effectiveSettings = { ...state.settings, timingWindowMs: calibration.best.timingWindowMs };
    const correctedReplayEvents = applyReplayOffset(normalizedReplayWindow.events, calibration.best.offsetMs);
    const correctedSourceEvents = buildAnalysisEvents(csvWindow.events, correctedReplayEvents);
    state.analysisResult = analyzeEvents(correctedSourceEvents, effectiveSettings);
    state.analysisResult.debug = {
      ...state.analysisResult.debug,
      replayOffset: {
        ...calibration,
        audioLeadInMs,
        rawBestOffsetMs: rawOffsetDebug.bestOffsetMs,
        audioLeadInAdjustedOffsetMs: calibration.best.offsetMs,
        normalizedBestOffsetMs: calibration.best.offsetMs,
        totalAppliedOffsetMs: calibration.best.offsetMs - audioLeadInMs,
        analysisWindow: normalizedReplayWindow.debug,
        rawAnalysisWindow: rawReplayWindow.debug,
        beforeAudioLeadInHitCount: rawAnalysis.summary.hitCount,
        beforeAudioLeadInAnalyzerMiss: rawAnalysis.summary.analyzerMissCount,
        afterAudioLeadInHitCount: audioLeadInAnalysis.summary.hitCount,
        afterAudioLeadInAnalyzerMiss: audioLeadInAnalysis.summary.analyzerMissCount,
        bestOffsetMs: calibration.best.offsetMs,
        bestTimingWindowMs: calibration.best.timingWindowMs,
        beforeHitCount: rawAnalysis.summary.hitCount,
        afterHitCount: state.analysisResult.summary.hitCount,
        beforeSummary: rawAnalysis.summary,
        afterAudioLeadInSummary: audioLeadInAnalysis.summary,
        afterSummary: state.analysisResult.summary
      }
    };
    state.replayOffsetDebug = state.analysisResult.debug.replayOffset;
  } else {
    state.analysisResult = rawAnalysis;
    state.analysisResult.debug = {
      ...state.analysisResult.debug,
      analysisWindow: hasCsvText ? csvWindow.debug : rawReplayWindow.debug
    };
    state.replayOffsetDebug = null;
  }

  state.analysisMessageKey = "";
  state.playbackState = createPlaybackState(state.analysisResult);
  state.playbackTimeMs = 0;
  renderResults();
  setStatusKey(hasCsvText ? "parsed" : "osrReplayLoaded");
}

async function runMultiReplayAnalysis() {
  const readySets = getReadyMultiSets();

  if (!readySets.length) {
    setMultiStatus(state.settings.language === "en"
      ? "Select at least one .osr and .osu pair for multi replay analysis."
      : ".osrと.osuのペアを1セット以上選択してください。");
    return;
  }

  setMultiStatus((state.settings.language === "en" ? "Analyzing" : "解析中") + "... 0 / " + readySets.length);
  elements.multiAnalyzeButton.disabled = true;

  const decoder = getReplayDecoderAdapter(window);
  const records = [];

  for (let index = 0; index < readySets.length; index += 1) {
    const set = readySets[index];
    const osrFile = set.osrFile;
    const beatmapFile = set.osuFile;
    try {
      const [osrBuffer, beatmapText] = await Promise.all([osrFile.arrayBuffer(), beatmapFile.text()]);
      const beatmap = {
        fileName: beatmapFile.name,
        ...parseOsuManiaBeatmap(beatmapText, state.settings.laneCount)
      };
      beatmap.profile = analyzeBeatmapFeatures(beatmap);
      const replay = await parseOsrReplay(osrBuffer, { ...state.settings, laneCount: beatmap.laneCount }, {
        decodeLzma: decoder.canDecodeOsrFrames ? decoder.decodeLzmaReplayFrames : undefined
      });
      const osrMissCount = Number.isFinite(replay.metadata?.hitCounts?.countMiss) ? replay.metadata.hitCounts.countMiss : null;
      const result = replay.events.length
        ? analyzeReplayPair(beatmap, replay.events, osrMissCount, { ...state.settings, laneCount: beatmap.laneCount })
        : null;

      records.push({
        id: "multi-" + set.index,
        index: set.index,
        osrFileName: osrFile.name,
        beatmapFileName: beatmapFile.name,
        songTitle: formatBeatmapTitle(beatmap),
        playerName: replay.metadata?.playerName ?? "-",
        osrMissCount,
        inputCount: replay.events.length,
        noteCount: beatmap.notes.length,
        beatmapProfile: beatmap.profile,
        result,
        errors: replay.errors ?? []
      });
    } catch (error) {
      records.push({
        id: "multi-" + set.index,
        index: set.index,
        osrFileName: osrFile.name,
        beatmapFileName: beatmapFile.name,
        songTitle: beatmapFile.name,
        playerName: "-",
        osrMissCount: null,
        inputCount: 0,
        noteCount: 0,
        beatmapProfile: null,
        result: null,
        errors: [error.message]
      });
    }

    setMultiStatus((state.settings.language === "en" ? "Analyzing" : "解析中") + "... " + (index + 1) + " / " + readySets.length);
  }

  state.multiAnalysisRecords = records;
  state.playerProfile = buildPlayerProfile(records);
  elements.multiAnalyzeButton.disabled = false;
  setMultiStatus((state.settings.language === "en" ? "Multi replay analysis complete" : "複数解析が完了しました") + ": " + records.filter((record) => record.result).length + " / " + records.length);
  renderMultiAnalysis();
}

function analyzeReplayPair(beatmap, replayInputEvents, osrMissCount, settings) {
  const audioLeadInMs = Number.isFinite(beatmap.audioLeadInMs) ? beatmap.audioLeadInMs : 0;
  const normalizedReplayEvents = normalizeReplayTimesForBeatmap(replayInputEvents, audioLeadInMs);
  const rawReplayWindow = filterInputEventsToAnalysisWindow(replayInputEvents, beatmap.events, settings);
  const normalizedReplayWindow = filterInputEventsToAnalysisWindow(normalizedReplayEvents, beatmap.events, settings);
  const rawSourceEvents = buildAnalysisEventsForBeatmap(beatmap.events, [], rawReplayWindow.events);
  const normalizedSourceEvents = buildAnalysisEventsForBeatmap(beatmap.events, [], normalizedReplayWindow.events);
  const rawAnalysis = analyzeEvents(rawSourceEvents, settings);
  const audioLeadInAnalysis = analyzeEvents(normalizedSourceEvents, settings);
  const rawOffsetDebug = findBestReplayOffset(beatmap.events, rawReplayWindow.events, settings);
  const calibration = findBestReplayCalibration(beatmap.events, normalizedReplayWindow.events, settings, osrMissCount);
  const effectiveSettings = { ...settings, timingWindowMs: calibration.best.timingWindowMs };
  const correctedReplayEvents = applyReplayOffset(normalizedReplayWindow.events, calibration.best.offsetMs);
  const correctedSourceEvents = buildAnalysisEventsForBeatmap(beatmap.events, [], correctedReplayEvents);
  const result = analyzeEvents(correctedSourceEvents, effectiveSettings);

  result.debug = {
    ...result.debug,
    replayOffset: {
      ...calibration,
      audioLeadInMs,
      rawBestOffsetMs: rawOffsetDebug.bestOffsetMs,
      normalizedBestOffsetMs: calibration.best.offsetMs,
      analysisWindow: normalizedReplayWindow.debug,
      rawAnalysisWindow: rawReplayWindow.debug,
      beforeAudioLeadInHitCount: rawAnalysis.summary.hitCount,
      beforeAudioLeadInAnalyzerMiss: rawAnalysis.summary.analyzerMissCount,
      afterAudioLeadInHitCount: audioLeadInAnalysis.summary.hitCount,
      afterAudioLeadInAnalyzerMiss: audioLeadInAnalysis.summary.analyzerMissCount,
      bestOffsetMs: calibration.best.offsetMs,
      bestTimingWindowMs: calibration.best.timingWindowMs,
      beforeSummary: rawAnalysis.summary,
      afterSummary: result.summary
    }
  };

  return result;
}

function buildAnalysisEventsForBeatmap(beatmapEvents, csvEvents, replayEvents) {
  const inputEvents = csvEvents.filter((event) => event.eventType !== "note");
  return [...beatmapEvents, ...inputEvents, ...replayEvents].sort((a, b) => a.timeMs - b.timeMs || a.lane - b.lane);
}

function handleMultiSetFileChange(event) {
  const index = Number(event.target.dataset.multiIndex);
  const kind = event.target.dataset.multiKind;
  if (!Number.isInteger(index) || index < 0 || index >= state.multiSets.length) return;
  if (!["osr", "osu"].includes(kind)) return;

  const file = event.target.files?.[0] ?? null;
  state.multiSets[index] = {
    ...state.multiSets[index],
    [kind === "osr" ? "osrFile" : "osuFile"]: file
  };
  state.multiAnalysisRecords = [];
  state.playerProfile = null;
  renderMultiFileLabels();
  renderMultiAnalysis();
}

function handleMultiSetResetClick(event) {
  const button = event.target.closest("[data-multi-reset-index]");
  if (!button) return;
  const index = Number(button.dataset.multiResetIndex);
  resetMultiSet(index);
}

function resetMultiSet(index) {
  if (!Number.isInteger(index) || index < 0 || index >= state.multiSets.length) return;
  state.multiSets[index] = { osrFile: null, osuFile: null };
  clearMultiSetInputs(index);
  clearMultiAnalysisResults();
  renderMultiFileLabels();
  renderMultiAnalysis();
}

function resetAllMultiSets() {
  state.multiSets = Array.from({ length: 5 }, () => ({ osrFile: null, osuFile: null }));
  elements.multiSetList.querySelectorAll("input[type='file']").forEach((input) => {
    input.value = "";
  });
  clearMultiAnalysisResults();
  setMultiStatus("");
  renderMultiFileLabels();
  renderMultiAnalysis();
}

function clearMultiSetInputs(index) {
  elements.multiSetList.querySelectorAll(`input[data-multi-index="${index}"]`).forEach((input) => {
    input.value = "";
  });
}

function clearMultiAnalysisResults() {
  state.multiAnalysisRecords = [];
  state.playerProfile = null;
}

function renderMultiFileLabels() {
  const noFileText = t(state.settings.language, "multiNoFileSelected");
  elements.multiSetList.querySelectorAll(".multi-file-name").forEach((node) => {
    const index = Number(node.dataset.multiIndex);
    const kind = node.dataset.multiKind;
    const file = state.multiSets[index]?.[kind === "osr" ? "osrFile" : "osuFile"];
    node.textContent = file?.name ?? noFileText;
  });
}

function getReadyMultiSets() {
  return state.multiSets
    .map((set, index) => ({ ...set, index }))
    .filter((set) => set.osrFile && set.osuFile);
}

function formatBeatmapTitle(beatmap) {
  const base = [beatmap.artist, beatmap.title].filter(Boolean).join(" - ");
  const version = beatmap.version ? ` [${beatmap.version}]` : "";
  return `${base || beatmap.fileName || "Unknown beatmap"}${version}`;
}

function buildAnalysisEvents(csvEvents, replayEvents = state.replayInputEvents ?? []) {
  if (!state.beatmap?.events?.length) {
    return [...csvEvents, ...replayEvents].sort((a, b) => a.timeMs - b.timeMs || a.lane - b.lane);
  }

  const inputEvents = csvEvents.filter((event) => event.eventType !== "note");
  return [...state.beatmap.events, ...inputEvents, ...replayEvents].sort((a, b) => a.timeMs - b.timeMs || a.lane - b.lane);
}

function getBeatmapAudioLeadInMs() {
  const audioLeadInMs = Number(state.beatmap?.audioLeadInMs);
  return Number.isFinite(audioLeadInMs) ? audioLeadInMs : 0;
}

function normalizeReplayTimesForBeatmap(events, audioLeadInMs) {
  if (!Number.isFinite(audioLeadInMs) || audioLeadInMs === 0) return events;

  return events.map((event) =>
    event.source === "osr"
      ? {
          ...event,
          rawTimeMs: event.rawTimeMs ?? event.timeMs,
          timeMs: event.timeMs - audioLeadInMs,
          appliedAudioLeadInMs: audioLeadInMs
        }
      : event
  );
}

function filterCsvEventsToAnalysisWindow(csvEvents, noteEvents, settings) {
  const csvNotes = csvEvents.filter((event) => event.eventType === "note");
  const csvInputs = csvEvents.filter((event) => event.eventType !== "note");
  const filtered = filterInputEventsToAnalysisWindow(csvInputs, noteEvents, settings);
  return {
    events: [...csvNotes, ...filtered.events].sort((a, b) => a.timeMs - b.timeMs || a.lane - b.lane),
    debug: filtered.debug
  };
}

function filterInputEventsToAnalysisWindow(inputEvents, noteEvents, settings) {
  const windowDebug = createEmptyAnalysisWindowDebug(noteEvents, settings);
  if (!Number.isFinite(windowDebug.analysisStartTimeMs) || !Number.isFinite(windowDebug.analysisEndTimeMs)) {
    return { events: inputEvents, debug: windowDebug };
  }

  const events = [];
  inputEvents.forEach((event) => {
    if (!["keydown", "keyup"].includes(event.eventType)) {
      events.push(event);
      return;
    }

    if (event.timeMs < windowDebug.analysisStartTimeMs) {
      windowDebug.excludedBeforeCount += 1;
      return;
    }

    if (event.timeMs > windowDebug.analysisEndTimeMs) {
      windowDebug.excludedAfterCount += 1;
      return;
    }

    events.push(event);
  });

  return {
    events,
    debug: {
      ...windowDebug,
      keptInputCount: events.filter((event) => ["keydown", "keyup"].includes(event.eventType)).length,
      originalInputCount: inputEvents.filter((event) => ["keydown", "keyup"].includes(event.eventType)).length
    }
  };
}

function createEmptyAnalysisWindowDebug(noteEvents, settings) {
  const noteTimes = noteEvents
    .filter((event) => event.eventType === "note")
    .map((event) => event.timeMs)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const firstNoteTimeMs = noteTimes[0] ?? null;
  const lastNoteTimeMs = noteTimes.at(-1) ?? null;
  const preNoteIgnoreMarginMs = settings.preNoteIgnoreMarginMs ?? 0;
  const postNoteIgnoreMarginMs = settings.postNoteIgnoreMarginMs ?? 0;

  return {
    firstNoteTimeMs,
    lastNoteTimeMs,
    preNoteIgnoreMarginMs,
    postNoteIgnoreMarginMs,
    analysisStartTimeMs: Number.isFinite(firstNoteTimeMs) ? firstNoteTimeMs - preNoteIgnoreMarginMs : null,
    analysisEndTimeMs: Number.isFinite(lastNoteTimeMs) ? lastNoteTimeMs + postNoteIgnoreMarginMs : null,
    excludedBeforeCount: 0,
    excludedAfterCount: 0,
    keptInputCount: 0,
    originalInputCount: 0
  };
}

function clearAnalysis(messageKey = "noData") {
  stopPlayback();
  state.analysisResult = null;
  state.replayOffsetDebug = null;
  state.analysisMode = "none";
  state.analysisMessageKey = messageKey;
  state.playbackState = createPlaybackState(null);
  state.playbackTimeMs = 0;
  renderResults();
  setStatusKey(messageKey);
}

function resetSingleAnalysis() {
  stopPlayback();
  if (state.inputLogger.isRecording) {
    stopInputLogger(state.inputLogger);
    stopInputLogTimer();
  }

  state.analysisResult = null;
  state.analysisMode = "none";
  state.analysisMessageKey = "noData";
  state.osrMissCount = null;
  state.osrMetadata = null;
  state.replayDebug = null;
  state.replayOffsetDebug = null;
  state.replayInputEvents = [];
  state.replayFrameCount = 0;
  state.beatmap = null;
  state.hasCsvInput = false;
  state.playbackState = createPlaybackState(null);
  state.playbackTimeMs = 0;
  state.isPlaying = false;

  elements.osrFileInput.value = "";
  elements.beatmapFileInput.value = "";
  elements.csvFileInput.value = "";
  elements.csvTextArea.value = "";

  renderFileMetadata();
  renderResults();
  renderInputLog();
  setStatusKey("singleAnalysisReset");
}

function rerunAnalysisIfReady() {
  if (elements.csvTextArea.value.trim() || state.replayInputEvents.length || state.beatmap?.events?.length) {
    runAnalysis();
    return;
  }

  clearAnalysis("");
}

function renderResults() {
  const result = state.analysisResult;
  if (!result) {
    elements.summaryBadge.textContent = "-";
    elements.totalMistakes.textContent = t(state.settings.language, "notAnalyzed");
    elements.hitCount.textContent = t(state.settings.language, "notAnalyzed");
    elements.noteCount.textContent = state.beatmap?.notes?.length ? String(state.beatmap.notes.length) : t(state.settings.language, "notAnalyzed");
    elements.inputCount.textContent = state.osrMetadata ? String(state.replayInputEvents.length) : t(state.settings.language, "notAnalyzed");
    renderEmptyResults();
    renderOsrComparison(null);
    renderAnalysisDebug();
    renderPlayback();
    return;
  }

  const { summary } = result;
  elements.summaryBadge.textContent = String(summary.totalMistakes);
  elements.totalMistakes.textContent = String(summary.totalMistakes);
  elements.hitCount.textContent = String(summary.hitCount);
  elements.noteCount.textContent = String(summary.noteCount);
  elements.inputCount.textContent = String(summary.inputCount);

  renderOsrComparison(result);
  renderTypeBars(summary);
  renderGroupedTable(elements.laneTable, summary.byLane, (entry) => `${t(state.settings.language, "laneLabel")} ${entry.id}`, (entry) => {
    const keyName = state.settings.keyBindings[entry.id - 1] ?? "";
    return `${t(state.settings.language, "key")}: ${keyName}`;
  });
  renderGroupedTable(elements.keyTable, summary.byKey, (entry) => entry.id, (entry) => {
    const lane = state.settings.keyBindings.indexOf(entry.id) + 1;
    return lane ? `${t(state.settings.language, "laneLabel")} ${lane}` : "";
  });
  renderGroupedTable(elements.fingerTable, summary.byFinger, (entry) => getFingerLabel(entry.id, state.settings.language), () => "");
  renderTimeline(result.mistakes);
  renderAdvice(summary);
  renderAnalysisDebug();
  renderPlayback();
}

function renderEmptyResults() {
  const message = state.analysisMessageKey ? t(state.settings.language, state.analysisMessageKey) : t(state.settings.language, "noData");
  const empty = `<p class="empty-state">${message}</p>`;
  elements.typeBars.innerHTML = empty;
  elements.laneTable.innerHTML = empty;
  elements.keyTable.innerHTML = empty;
  elements.fingerTable.innerHTML = empty;
  elements.timeline.innerHTML = empty;
  elements.activeMistakes.innerHTML = empty;
  elements.playbackNextMistake.textContent = "";
  elements.adviceList.innerHTML = "";
  renderOsrComparison(null);
}

function renderOsrComparison(result) {
  if (!result || state.analysisMode !== "replay") {
    elements.osrComparison.innerHTML = `<p class="empty-state">${t(state.settings.language, "noData")}</p>`;
    return;
  }

  const summary = result.summary;
  const osrMiss = state.osrMissCount;
  const analyzerMiss = summary.analyzerMissCount ?? getMistakeTypeCount(summary, "missed");
  const difference = Number.isFinite(osrMiss) ? analyzerMiss - osrMiss : null;
  const replayOffset = result.debug?.replayOffset ?? null;
  const analysisWindow = result.debug?.analysisWindow ?? replayOffset?.analysisWindow ?? null;
  const breakdown = getMissBreakdown(summary);
  const comments = buildCauseComments({ osrMiss, analyzerMiss, difference, breakdown, summary, replayOffset });

  elements.osrComparison.innerHTML = `
    <div class="comparison-grid">
      ${renderComparisonCard("OSR Miss", Number.isFinite(osrMiss) ? osrMiss : t(state.settings.language, "notAvailable"))}
      ${renderComparisonCard(t(state.settings.language, "analyzerMiss"), analyzerMiss)}
      ${renderComparisonCard(t(state.settings.language, "difference"), formatSignedNumber(difference))}
      ${renderComparisonCard(t(state.settings.language, "autoCorrection"), replayOffset ? t(state.settings.language, "autoCorrectionApplied") : "-")}
      ${renderComparisonCard(t(state.settings.language, "hitCount"), summary.hitCount)}
      ${renderComparisonCard("Excluded before", analysisWindow?.excludedBeforeCount ?? 0)}
      ${renderComparisonCard("Excluded after", analysisWindow?.excludedAfterCount ?? 0)}
    </div>
    <div>
      <h4>${t(state.settings.language, "missBreakdown")}</h4>
      <div class="breakdown-grid">
        ${renderBreakdownItem(t(state.settings.language, "tapNoteMiss"), breakdown.tapNoteMiss)}
        ${renderBreakdownItem(t(state.settings.language, "lnStartMiss"), breakdown.lnStartMiss)}
        ${renderBreakdownItem(t(state.settings.language, "lnReleaseEarly"), breakdown.lnReleaseEarly)}
        ${renderBreakdownItem(t(state.settings.language, "lnReleaseLate"), breakdown.lnReleaseLate)}
        ${renderBreakdownItem(t(state.settings.language, "lnHoldBreak"), breakdown.lnHoldBreak)}
        ${renderBreakdownItem(t(state.settings.language, "overhit"), breakdown.overhit)}
        ${renderBreakdownItem(t(state.settings.language, "early"), breakdown.early)}
        ${renderBreakdownItem(t(state.settings.language, "late"), breakdown.late)}
      </div>
    </div>
    <div>
      <h4>${t(state.settings.language, "causeComments")}</h4>
      <ul class="cause-list">${comments.map((comment) => `<li>${escapeHtml(comment)}</li>`).join("")}</ul>
    </div>
  `;
}

function renderComparisonCard(label, value) {
  return `
    <div class="comparison-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
    </div>
  `;
}

function renderBreakdownItem(label, value) {
  return `
    <div class="breakdown-item">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value ?? 0))}</strong>
    </div>
  `;
}

function renderTypeBars(summary) {
  const total = Math.max(summary.totalMistakes, 1);
  elements.typeBars.innerHTML = summary.byType
    .map((entry) => {
      const percent = Math.round((entry.count / total) * 100);
      return `
        <div class="bar-row">
          <span>${t(state.settings.language, entry.id)}</span>
          <span class="bar-track"><span class="bar-fill" style="width: ${percent}%"></span></span>
          <strong>${percent}%</strong>
        </div>
      `;
    })
    .join("");
}

function renderGroupedTable(container, entries, getLabel, getMeta) {
  if (!entries.length) {
    container.innerHTML = `<p class="empty-state">${t(state.settings.language, "noMistakes")}</p>`;
    return;
  }

  container.innerHTML = entries
    .map(
      (entry) => `
        <div class="table-row">
          <span>${escapeHtml(String(getLabel(entry)))}</span>
          <strong>${entry.count}</strong>
          <span class="subtle">${escapeHtml(String(getMeta(entry)))}</span>
        </div>
      `
    )
    .join("");
}

function renderTimeline(mistakes) {
  if (!mistakes.length) {
    elements.timeline.innerHTML = `<p class="empty-state">${t(state.settings.language, "noMistakes")}</p>`;
    return;
  }

  elements.timeline.innerHTML = mistakes
    .map((mistake) => {
      const offset = mistake.deltaMs === null ? "" : `${t(state.settings.language, "nearestDelta")}: ${mistake.deltaMs > 0 ? "+" : ""}${mistake.deltaMs}ms`;
      const noteTime = mistake.noteTimeMs === null ? "" : `${t(state.settings.language, "note")}: ${formatTime(mistake.noteTimeMs)}`;
      const inputTime = mistake.inputTimeMs === null ? "" : `${t(state.settings.language, "input")}: ${formatTime(mistake.inputTimeMs)}`;
      const finger = getFingerLabel(mistake.finger, state.settings.language);
      return `
        <div class="timeline-item" data-type="${mistake.type}">
          <span class="timeline-time">${formatTime(mistake.timeMs)}</span>
          <span class="timeline-detail">
            <strong>${t(state.settings.language, mistake.type)} - ${t(state.settings.language, "laneLabel")} ${mistake.lane}</strong>
            <span>${t(state.settings.language, "key")}: ${escapeHtml(mistake.key)} / ${t(state.settings.language, "finger")}: ${escapeHtml(finger)}</span>
            <span class="subtle">${[noteTime, inputTime, offset].filter(Boolean).join(" / ")}</span>
          </span>
        </div>
      `;
    })
    .join("");
}

function renderAdvice(summary) {
  const advice = buildAdvice(
    summary,
    state.settings,
    state.settings.language,
    (key) => t(state.settings.language, key),
    getFingerLabel
  );
  elements.adviceList.innerHTML = advice.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function renderMultiAnalysis() {
  const readyCount = getReadyMultiSets().length;

  if (!state.multiAnalysisRecords.length) {
    elements.multiResults.innerHTML = `<p class="empty-state">Not analyzed yet. Ready sets: ${readyCount} / 5</p>`;
    elements.playerProfile.innerHTML = `<p class="empty-state">Player Profile appears after multi replay analysis.</p>`;
    return;
  }

  elements.multiResults.innerHTML = state.multiAnalysisRecords.map(renderMultiRecord).join("");
  elements.playerProfile.innerHTML = renderPlayerProfile(state.playerProfile);
}

function renderMultiRecord(record) {
  if (!record.result) {
    return `
      <div class="multi-record error">
        <strong>Replay #${record.index + 1}: ${escapeHtml(record.osrFileName)}</strong>
        <span>${escapeHtml(record.beatmapFileName)}</span>
        <p>${escapeHtml(record.errors?.[0] ?? "Could not analyze this replay.")}</p>
      </div>
    `;
  }

  const analyzerMiss = record.result.summary.analyzerMissCount ?? 0;
  const difference = Number.isFinite(record.osrMissCount) ? analyzerMiss - record.osrMissCount : null;

  return `
    <div class="multi-record">
      <div>
        <strong>Replay #${record.index + 1}: ${escapeHtml(record.songTitle)}</strong>
        <span class="subtle">${escapeHtml(record.beatmapFileName)} / ${escapeHtml(record.playerName)}</span>
      </div>
      <div class="multi-record-metrics">
        <span>OSR Miss <strong>${Number.isFinite(record.osrMissCount) ? record.osrMissCount : "-"}</strong></span>
        <span>Analyzer <strong>${analyzerMiss}</strong></span>
        <span>Diff <strong>${formatSignedNumber(difference)}</strong></span>
        <span>Notes <strong>${record.noteCount}</strong></span>
        <span>Inputs <strong>${record.inputCount}</strong></span>
      </div>
      <div class="multi-detail-grid">
        <div><strong>Player Result</strong>${renderCompactEntries(record.result.summary.byLane, (entry) => `Lane ${entry.id}`)}</div>
        <div><strong>Finger mistakes</strong>${renderCompactEntries(record.result.summary.byFinger, (entry) => getFingerLabel(entry.id, state.settings.language))}</div>
        <div><strong>LN mistakes</strong>${renderLnBreakdown(record.result.summary)}</div>
      </div>
      <div class="beatmap-profile-card">
        <strong>Beatmap Profile</strong>
        ${renderBeatmapProfile(record.beatmapProfile)}
      </div>
    </div>
  `;
}

function renderPlayerProfile(profile) {
  if (!profile) return `<p class="empty-state">Player Profile appears after multi replay analysis.</p>`;
  const summaryText = getLocalizedProfileText(profile.summary);
  const labels = getProfileLabels();
  const rateRows = [
    [labels.leftHandErrorRate, formatNullablePercent(profile.leftHandErrorRate), labels.errorEventBasis],
    [labels.rightHandErrorRate, formatNullablePercent(profile.rightHandErrorRate), labels.errorEventBasis],
    [labels.lnErrorRate, formatNullablePercent(profile.lnErrorRate), labels.errorEventBasis],
    [labels.tapErrorRate, formatNullablePercent(profile.tapErrorRate), labels.errorEventBasis],
    [labels.jackErrorRate, formatNullablePercent(profile.jackErrorRate), labels.errorEventBasis],
    [labels.averageAnalyzerMiss, roundNumber(profile.averageAnalyzerMiss), labels.analyzerMissBasis]
  ];
  const playerTypeTags = (profile.playerTypes ?? profile.weaknessTypes ?? [])
    .map((type) => `<span class="profile-tag" title="${escapeHtml(getLocalizedProfileText(type.reason) || type.reason_en || type.reason_ja || "")}">${escapeHtml(formatWeaknessType(type.id))}</span>`)
    .join("");
  const typeReasons = (profile.playerTypes ?? [])
    .map((type) => `<span><strong>${escapeHtml(formatWeaknessType(type.id))}</strong>: ${escapeHtml(getLocalizedProfileText(type.reason) || type.reason_en || type.reason_ja || "")}</span>`)
    .join("");
  const strengthTop3 = renderProfileTopList(labels.strengthTop3, profile.strengthTop3, labels, labels.none);
  const challengeTop3 = renderProfileTopList(labels.challengeTop3, profile.challengeTop3, labels, labels.noClearChallenges);
  const fingerRows = profile.byFinger
    .map((entry) => `<span>${escapeHtml(getFingerLabel(entry.id, state.settings.language))}: <strong>${entry.count}</strong> <em>${formatNullablePercent(entry.rate)}</em></span>`)
    .join("");

  return `
    <div class="profile-summary">
      ${renderMetadataRows([
        [labels.analyzedReplays, profile.replayCount],
        [labels.osrMissTotal, Number.isFinite(profile.totalOsrMiss) ? profile.totalOsrMiss : labels.notAvailable],
        [labels.analyzerMissTotal, profile.totalAnalyzerMiss],
        [labels.difference, formatSignedNumber(profile.missDifference)],
        [labels.totalErrorEvents, profile.totalErrorEvents]
      ])}
      <div class="profile-comment">${escapeHtml(summaryText).replace(/\n/g, "<br>")}</div>
      <div class="profile-tags">${playerTypeTags}</div>
      <div class="profile-top-grid">
        ${strengthTop3}
        ${challengeTop3}
      </div>
      <div class="profile-definition-grid">
        <span><strong>${labels.totalErrorEvents}</strong>: ${labels.totalErrorEventsHelp}</span>
        <span><strong>${labels.analyzerMissTotal}</strong>: ${labels.analyzerMissHelp}</span>
        <span><strong>${labels.fingerErrorRate}</strong>: ${labels.fingerRateHelp}</span>
      </div>
      <div class="profile-stat-grid">${rateRows.map(([label, value, help]) => renderProfileStat(label, value, help)).join("")}</div>
      ${renderErrorBreakdown(profile.errorBreakdown, labels)}
      ${renderBeatmapExposure(profile.beatmapExposure, labels)}
      ${renderNormalizedSkillProfile(profile.normalizedSkillProfile, labels)}
      <div class="profile-mini-grid"><strong>${labels.playerTypeReasons}</strong>${typeReasons || `<span>${labels.none}</span>`}</div>
      <div class="profile-mini-grid"><strong>${labels.fingerErrorRate}</strong>${fingerRows || `<span>${labels.none}</span>`}</div>
      <details class="profile-debug-details">
        <summary>${labels.normalizedDetails}</summary>
        ${renderRawVsNormalized(profile, labels)}
        ${renderComparisonProfileJson(profile, labels)}
      </details>
    </div>
  `;
}

function renderProfileStat(label, value, help = "") {
  return `
    <div class="profile-stat">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
      ${help ? `<em>${escapeHtml(help)}</em>` : ""}
    </div>
  `;
}

function renderBeatmapExposure(exposure, labels) {
  if (!exposure) return "";
  const rows = [
    [labels.lnExposure, formatNullablePercent(exposure.lnExposure)],
    [labels.jackExposure, roundNumber(exposure.jackExposure * 100)],
    [labels.averageNps, roundNumber(exposure.averageNps)],
    [labels.peakNps, roundNumber(exposure.peakNps)],
    [labels.leftExposure, roundNumber(exposure.leftHandDensity)],
    [labels.rightExposure, roundNumber(exposure.rightHandDensity)]
  ];
  return `<div class="profile-mini-grid"><strong>${labels.beatmapExposure}</strong>${rows.map(([label, value]) => `<span>${escapeHtml(label)}: <strong>${escapeHtml(String(value))}</strong></span>`).join("")}</div>`;
}

function renderNormalizedSkillProfile(normalized, labels) {
  if (!normalized) return "";
  const rows = [
    [labels.lnAptitude, normalized.lnAptitude, normalized.normalizedLnWeakness],
    [labels.jackAptitude, normalized.jackAptitude, normalized.normalizedJackWeakness],
    [labels.leftAptitude, normalized.leftHandAptitude, normalized.normalizedLeftHandWeakness],
    [labels.rightAptitude, normalized.rightHandAptitude, normalized.normalizedRightHandWeakness],
    [labels.densityTolerance, normalized.densityTolerance, normalized.normalizedDensityWeakness],
    [labels.staminaTolerance, normalized.staminaTolerance, normalized.normalizedStaminaWeakness]
  ];
  return `<div class="profile-stat-grid"><div class="profile-section-title">${labels.normalizedSkillProfile}</div>${rows.map(([label, aptitude]) => renderProfileStat(label, formatAptitude(aptitude, labels))).join("")}</div>`;
}

function renderErrorBreakdown(errorBreakdown = [], labels) {
  const rows = errorBreakdown.map((entry) => `
    <span>
      ${escapeHtml(labels.errorBreakdown[entry.id] ?? entry.id)}:
      <strong>${entry.count}</strong>
      <em>${formatNullablePercent(entry.rate)}</em>
    </span>
  `);
  return `
    <div class="profile-mini-grid">
      <strong>${labels.analyzerBreakdown}</strong>
      ${rows.join("") || `<span>${labels.none}</span>`}
    </div>
  `;
}

function renderRawVsNormalized(profile, labels) {
  const exposure = profile.beatmapExposure;
  const normalized = profile.normalizedSkillProfile;
  if (!exposure || !normalized) return "";
  const rows = [
    [labels.lnErrorRate, formatNullablePercent(profile.lnErrorRate), labels.lnExposure, formatNullablePercent(exposure.lnExposure), labels.normalizedLn, roundNumber(normalized.normalizedLnWeakness)],
    [labels.jackErrorRate, formatNullablePercent(profile.jackErrorRate), labels.jackExposure, formatNullablePercent(exposure.jackExposure), labels.normalizedJack, roundNumber(normalized.normalizedJackWeakness)],
    [labels.leftHandErrorRate, formatNullablePercent(profile.leftHandErrorRate), labels.leftExposure, formatNullablePercent(exposure.leftHandExposure), labels.normalizedLeft, roundNumber(normalized.normalizedLeftHandWeakness)],
    [labels.rightHandErrorRate, formatNullablePercent(profile.rightHandErrorRate), labels.rightExposure, formatNullablePercent(exposure.rightHandExposure), labels.normalizedRight, roundNumber(normalized.normalizedRightHandWeakness)]
  ];
  const localizedComments = state.settings.language === "en"
    ? profile.normalizedComments?.en ?? profile.normalizedComments?.ja
    : profile.normalizedComments?.ja ?? profile.normalizedComments?.en;
  const comments = Array.isArray(localizedComments)
    ? localizedComments
    : String(localizedComments ?? "").split(/\n/).filter(Boolean);
  return `
    <div class="profile-mini-grid raw-normalized-grid">
      <strong>${labels.rawVsNormalized}</strong>
      ${rows.map(([rawLabel, rawValue, exposureLabel, exposureValue, normalizedLabel, normalizedValue]) => `<span>${escapeHtml(rawLabel)}: <strong>${escapeHtml(String(rawValue))}</strong> / ${escapeHtml(exposureLabel)}: <strong>${escapeHtml(String(exposureValue))}</strong> / ${escapeHtml(normalizedLabel)}: <strong>${escapeHtml(String(normalizedValue))}</strong></span>`).join("")}
      ${comments.map((comment) => `<span class="profile-comment-line">${escapeHtml(comment)}</span>`).join("")}
    </div>
  `;
}

function formatAptitude(value, labels) {
  if (!Number.isFinite(value)) return "-";
  const weakness = 1 / Math.max(value, 0.1);
  return formatGrade(gradeFromWeakness(weakness), labels);
}

function renderProfileTopList(title, entries = [], labels, emptyMessage) {
  const rows = entries.slice(0, 3).map((entry, index) => `
    <li>
      <span>${index + 1}. ${escapeHtml(getLocalizedProfileText({ ja: entry.label_ja, en: entry.label_en }))}</span>
      <strong>${escapeHtml(formatGrade(entry.grade, labels))}</strong>
    </li>
  `);
  return `
    <div class="profile-top-card">
      <strong>${escapeHtml(title)}</strong>
      <ol>${rows.join("") || `<li>${escapeHtml(emptyMessage)}</li>`}</ol>
    </div>
  `;
}

function formatGrade(grade, labels) {
  return `${grade}: ${labels.grades[grade] ?? grade}`;
}

function gradeFromWeakness(value) {
  if (!Number.isFinite(value)) return "B";
  if (value <= 0.55) return "S";
  if (value <= 0.8) return "A";
  if (value <= 1.15) return "B";
  if (value <= 1.45) return "C";
  return "D";
}

function renderComparisonProfileJson(profile, labels) {
  if (!profile.comparisonProfileJson) return "";
  return `
    <div class="profile-json-block">
      <strong>${escapeHtml(labels.profileJson)}</strong>
      <pre>${escapeHtml(JSON.stringify(profile.comparisonProfileJson, null, 2))}</pre>
    </div>
  `;
}

function formatWeaknessType(type) {
  const keyByType = {
    general: "profileGeneralType",
    balanced: "profileBalancedType",
    left_hand_weak: "profileLeftHandType",
    right_hand_weak: "profileRightHandType",
    jack_weak: "profileJackType",
    ln_weak: "profileLnType",
    stamina_weak: "profileStaminaType",
    accuracy_weak: "profileAccuracyType"
  };
  return t(state.settings.language, keyByType[type] ?? type);
}

function getProfileLabels() {
  return {
    analyzedReplays: t(state.settings.language, "profileAnalyzedReplays"),
    osrMissTotal: t(state.settings.language, "profileOsrMissTotal"),
    analyzerMissTotal: t(state.settings.language, "profileAnalyzerMissTotal"),
    averageAnalyzerMiss: t(state.settings.language, "profileAverageAnalyzerMiss"),
    difference: t(state.settings.language, "profileDifference"),
    totalErrorEvents: t(state.settings.language, "profileTotalErrorEvents"),
    totalErrorEventsHelp: t(state.settings.language, "profileTotalErrorEventsHelp"),
    analyzerMissHelp: t(state.settings.language, "profileAnalyzerMissHelp"),
    fingerErrorRate: t(state.settings.language, "profileFingerErrorRate"),
    fingerRateHelp: t(state.settings.language, "profileFingerRateHelp"),
    leftHandErrorRate: t(state.settings.language, "profileLeftHandErrorRate"),
    rightHandErrorRate: t(state.settings.language, "profileRightHandErrorRate"),
    lnErrorRate: t(state.settings.language, "profileLnErrorRate"),
    tapErrorRate: t(state.settings.language, "profileTapErrorRate"),
    jackErrorRate: t(state.settings.language, "profileJackErrorRate"),
    errorEventBasis: t(state.settings.language, "profileErrorEventBasis"),
    analyzerMissBasis: t(state.settings.language, "profileAnalyzerMissBasis"),
    playerTypeReasons: t(state.settings.language, "profilePlayerTypeReasons"),
    beatmapExposure: t(state.settings.language, "profileBeatmapExposure"),
    normalizedSkillProfile: t(state.settings.language, "profileNormalizedSkillProfile"),
    rawVsNormalized: t(state.settings.language, "profileRawVsNormalized"),
    lnExposure: t(state.settings.language, "profileLnExposure"),
    jackExposure: t(state.settings.language, "profileJackScore"),
    densityExposure: t(state.settings.language, "profileDensityExposure"),
    averageNps: t(state.settings.language, "profileAverageNps"),
    peakNps: t(state.settings.language, "profilePeakNps"),
    leftExposure: t(state.settings.language, "profileLeftExposure"),
    rightExposure: t(state.settings.language, "profileRightExposure"),
    lnAptitude: t(state.settings.language, "profileLnAptitude"),
    jackAptitude: t(state.settings.language, "profileJackAptitude"),
    leftAptitude: t(state.settings.language, "profileLeftAptitude"),
    rightAptitude: t(state.settings.language, "profileRightAptitude"),
    densityTolerance: t(state.settings.language, "profileDensityTolerance"),
    staminaTolerance: t(state.settings.language, "profileStaminaTolerance"),
    normalizedLn: t(state.settings.language, "profileNormalizedLn"),
    normalizedJack: t(state.settings.language, "profileNormalizedJack"),
    normalizedLeft: t(state.settings.language, "profileNormalizedLeft"),
    normalizedRight: t(state.settings.language, "profileNormalizedRight"),
    normalizedDensity: t(state.settings.language, "profileNormalizedDensity"),
    normalizedStamina: t(state.settings.language, "profileNormalizedStamina"),
    notAvailable: t(state.settings.language, "profileNotAvailable"),
    none: t(state.settings.language, "profileNone"),
    strong: t(state.settings.language, "profileStrong"),
    stable: t(state.settings.language, "profileStable"),
    watch: t(state.settings.language, "profileWatch"),
    strengthTop3: t(state.settings.language, "profileStrengthTop3"),
    challengeTop3: t(state.settings.language, "profileChallengeTop3"),
    normalizedDetails: t(state.settings.language, "profileNormalizedDetails"),
    profileJson: t(state.settings.language, "profileJson"),
    analyzerBreakdown: t(state.settings.language, "profileAnalyzerBreakdown"),
    noClearChallenges: t(state.settings.language, "profileNoClearChallenges"),
    grades: {
      S: t(state.settings.language, "profileGradeS"),
      A: t(state.settings.language, "profileGradeA"),
      B: t(state.settings.language, "profileGradeB"),
      C: t(state.settings.language, "profileGradeC"),
      D: t(state.settings.language, "profileGradeD")
    },
    errorBreakdown: {
      early: t(state.settings.language, "early"),
      late: t(state.settings.language, "late"),
      overhit: t(state.settings.language, "overhit"),
      tapMiss: t(state.settings.language, "tapNoteMiss"),
      lnStartMiss: t(state.settings.language, "lnStartMiss"),
      lnReleaseEarly: t(state.settings.language, "lnReleaseEarly"),
      lnReleaseLate: t(state.settings.language, "lnReleaseLate"),
      lnHoldBreak: t(state.settings.language, "lnHoldBreak")
    }
  };
}

function renderCompactEntries(entries, getLabel) {
  const visible = entries.filter((entry) => entry.count > 0).slice(0, 8);
  if (!visible.length) return `<p class="empty-state">None</p>`;
  return `<div class="compact-entry-list">${visible.map((entry) => `<span>${escapeHtml(getLabel(entry))}: <strong>${entry.count}</strong></span>`).join("")}</div>`;
}

function renderLnBreakdown(summary) {
  const ln = summary.lnBreakdown ?? {};
  const entries = [
    ["LN Start", ln.lnStartMiss ?? 0],
    ["Release", ln.lnEndMiss ?? 0],
    ["Hold Break", ln.lnHoldBreak ?? 0]
  ];
  return `<div class="compact-entry-list">${entries.map(([label, count]) => `<span>${label}: <strong>${count}</strong></span>`).join("")}</div>`;
}

function renderBeatmapProfile(profile) {
  if (!profile) return `<p class="empty-state">No beatmap profile.</p>`;

  return `
    <div class="beatmap-profile-grid">
      ${renderProfileStat("LN rate", formatNullablePercent(profile.lnRatio))}
      ${renderProfileStat("Jack Score", profile.jackScore)}
      ${renderProfileStat("Side bias", formatSideBiasClean(profile))}
      ${renderProfileStat("Average NPS", roundNumber(profile.averageNps))}
      ${renderProfileStat("Peak NPS", roundNumber(profile.peakNps))}
      ${renderProfileStat("Stamina Score", profile.staminaScore ?? "-")}
    </div>
  `;
}

function getLocalizedProfileText(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  return state.settings.language === "en" ? value.en ?? value.ja ?? "" : value.ja ?? value.en ?? "";
}

function formatSideBiasClean(profile) {
  const left = Number(profile.leftHandBias ?? 0);
  const right = Number(profile.rightHandBias ?? 0);
  if (left > 0.08) return state.settings.language === "en" ? `Left +${Math.round(left * 100)}%` : `左 +${Math.round(left * 100)}%`;
  if (right > 0.08) return state.settings.language === "en" ? `Right +${Math.round(right * 100)}%` : `右 +${Math.round(right * 100)}%`;
  return state.settings.language === "en" ? "Balanced" : "均等";
}

async function handleOsrFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  let statusMessage = { key: "" };
  state.replayDebug = null;

  try {
    const buffer = await file.arrayBuffer();
    const decoder = getReplayDecoderAdapter(window);
    const replay = await parseOsrReplay(buffer, state.settings, {
      decodeLzma: decoder.canDecodeOsrFrames ? decoder.decodeLzmaReplayFrames : undefined
    });
    const metadataFallback = replay.metadata ?? parseOsrMetadata(buffer).metadata;

    state.osrMetadata = {
      fileName: file.name,
      ...metadataFallback,
      decoderName: decoder.name,
      errors: replay.errors,
      warnings: replay.warnings
    };
    state.replayDebug = replay.debug ?? null;
    state.replayInputEvents = replay.events;
    state.replayFrameCount = replay.frames.length;
    state.osrMissCount = Number.isFinite(state.osrMetadata.hitCounts?.countMiss) ? state.osrMetadata.hitCounts.countMiss : null;

    if (replay.errors.length) {
      statusMessage = { text: replay.errors[0] };
    } else if (replay.events.length) {
      statusMessage = { key: "osrReplayLoaded" };
    } else {
      statusMessage = { key: "osrDecodePending" };
    }
  } catch (error) {
    state.osrMetadata = {
      fileName: file.name,
      errors: [error.message]
    };
    state.replayDebug = null;
    state.osrMissCount = null;
    state.replayInputEvents = [];
    state.replayFrameCount = 0;
    statusMessage = { text: error.message };
  }

  renderFileMetadata();
  if (state.beatmap?.events?.length || elements.csvTextArea.value.trim()) {
    runAnalysis();
  } else {
    clearAnalysis("");
  }
  setStatusMessage(statusMessage);
}

async function handleBeatmapFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  state.beatmap = {
    fileName: file.name,
    ...parseOsuManiaBeatmap(await file.text(), state.settings.laneCount)
  };
  state.beatmap.profile = analyzeBeatmapFeatures(state.beatmap);

  if (SUPPORTED_LANE_COUNTS.includes(state.beatmap.laneCount) && state.beatmap.laneCount !== state.settings.laneCount) {
    state.settings = settingsForLaneCount(state.settings, state.beatmap.laneCount);
    saveSettings();
    renderSettings();
  }

  setStatusKey("beatmapLoaded");
  renderFileMetadata();
  rerunAnalysisIfReady();
}

function renderFileMetadata() {
  elements.osrMetadata.innerHTML = state.osrMetadata
    ? renderMetadataRows([
        [t(state.settings.language, "player"), state.osrMetadata.playerName || "-"],
        [t(state.settings.language, "mode"), state.osrMetadata.modeName || "-"],
        [t(state.settings.language, "score"), state.osrMetadata.score ?? "-"],
        [t(state.settings.language, "maxCombo"), state.osrMetadata.maxCombo ?? "-"],
        [t(state.settings.language, "beatmapHash"), state.osrMetadata.beatmapHash || "-"],
        ["OSR 300", state.osrMetadata.hitCounts?.count300 ?? "-"],
        ["OSR 100", state.osrMetadata.hitCounts?.count100 ?? "-"],
        ["OSR 50", state.osrMetadata.hitCounts?.count50 ?? "-"],
        ["OSR Geki", state.osrMetadata.hitCounts?.countGeki ?? "-"],
        ["OSR Katu", state.osrMetadata.hitCounts?.countKatu ?? "-"],
        ["OSR Miss", state.osrMetadata.hitCounts?.countMiss ?? "-"],
        [t(state.settings.language, "osrInputEvents"), state.replayInputEvents.length],
        ["Decoder", state.osrMetadata.decoderName || "-"],
        ["Status", state.osrMetadata.errors?.[0] || (state.replayInputEvents.length ? t(state.settings.language, "osrReplayLoaded") : t(state.settings.language, "osrDecodePending"))]
      ])
    : `<p class="empty-state">${t(state.settings.language, "noData")}</p>`;

  elements.beatmapMetadata.innerHTML = state.beatmap
    ? renderMetadataRows([
        ["File", state.beatmap.fileName],
        [t(state.settings.language, "lanes"), `${state.beatmap.laneCount}K`],
        [t(state.settings.language, "notesLoaded"), state.beatmap.notes.length],
        ["Tap notes", state.beatmap.tapNoteCount ?? state.beatmap.notes.filter((note) => note.type === "note").length],
        ["LN / hold notes", state.beatmap.holdNoteCount ?? state.beatmap.notes.filter((note) => note.type === "hold").length],
        ["LN status", state.beatmap.holdNoteCount ? "Start time only; LN end timing is not judged yet." : "No LN detected."]
      ]) + `<div class="beatmap-profile-card"><strong>Beatmap Profile</strong>${renderBeatmapProfile(state.beatmap.profile)}</div>`
    : `<p class="empty-state">${t(state.settings.language, "noData")}</p>`;

  renderReplayDebug();
}

function renderReplayDebug() {
  const debug = state.replayDebug;
  if (!debug) {
    elements.replayDebug.innerHTML = `<p class="empty-state">${t(state.settings.language, "noData")}</p>`;
    return;
  }

  const maskStats = debug.maskStats ? JSON.stringify(debug.maskStats, null, 2) : "-";
  const frameSamples = debug.parsedFrameSamples ? JSON.stringify(debug.parsedFrameSamples, null, 2) : "-";

  elements.replayDebug.innerHTML = `
    ${renderMetadataRows([
      ["compressedReplayBytes.byteLength", debug.compressedReplayByteLength ?? 0],
      ["frameText.length", debug.frameTextLength ?? 0],
      ["frameText split count", debug.rawFrameChunkCount ?? 0],
      ["parsed frame count", debug.parsedFrameCount ?? 0],
      ["bitmask source", debug.bitmaskSource ?? "-"],
      ["bitmask reason", debug.bitmaskReason ?? "-"],
      ["key changes", debug.keyChangeCount ?? 0]
    ])}
    <div>
      <strong>frameText preview first 500 chars</strong>
      <pre class="debug-pre">${escapeHtml(debug.frameTextPreview ?? "")}</pre>
    </div>
    <div>
      <strong>parsed frame samples</strong>
      <pre class="debug-pre">${escapeHtml(frameSamples)}</pre>
    </div>
    <div>
      <strong>mask stats</strong>
      <pre class="debug-pre">${escapeHtml(maskStats)}</pre>
    </div>
  `;
}

function renderAnalysisDebug() {
  const debug = buildUiAnalysisDebug();
  if (!debug) {
    elements.analysisDebug.innerHTML = `<p class="empty-state">${t(state.settings.language, "noData")}</p>`;
    return;
  }

  elements.analysisDebug.innerHTML = `
    ${renderMetadataRows([
      ["first note time", formatNullableTime(debug.firstNoteTimeMs)],
      ["first input time", formatNullableTime(debug.firstInputTimeMs)],
      ["first input - first note", formatNullableDelta(debug.firstInputMinusFirstNoteMs)],
      ["analysis start time", formatNullableTime(debug.analysisStartTimeMs)],
      ["analysis end time", formatNullableTime(debug.analysisEndTimeMs)],
      ["pre-note ignore margin", formatNullableDelta(debug.preNoteIgnoreMarginMs)],
      ["post-note ignore margin", formatNullableDelta(debug.postNoteIgnoreMarginMs)],
      ["excluded pre-note inputs", debug.excludedBeforeCount ?? 0],
      ["excluded post-note inputs", debug.excludedAfterCount ?? 0],
      ["window kept inputs", debug.keptInputCount ?? "-"],
      ["window original inputs", debug.originalInputCount ?? "-"],
      ["AudioLeadIn", formatNullableDelta(debug.audioLeadInMs)],
      ["raw best offset", formatNullableDelta(debug.rawBestOffsetMs)],
      ["normalized best offset", formatNullableDelta(debug.normalizedBestOffsetMs)],
      ["AudioLeadIn adjusted offset", formatNullableDelta(debug.audioLeadInAdjustedOffsetMs)],
      ["total applied offset", formatNullableDelta(debug.totalAppliedOffsetMs)],
      ["average hit delta", formatNullableDelta(debug.averageDeltaMs)],
      ["median hit delta", formatNullableDelta(debug.medianDeltaMs)],
      ["auto offset applied", formatNullableDelta(debug.autoOffsetMs)],
      ["auto timing window", debug.autoTimingWindowMs ? `${debug.autoTimingWindowMs}ms` : "-"],
      ["OSR Miss", debug.osrMiss ?? "-"],
      ["Analyzer Miss", debug.analyzerMiss ?? "-"],
      ["Difference", formatSignedNumber(debug.missDifference)],
      ["before AudioLeadIn hits", debug.beforeAudioLeadInHitCount ?? "-"],
      ["before AudioLeadIn Analyzer Miss", debug.beforeAudioLeadInAnalyzerMiss ?? "-"],
      ["after AudioLeadIn hits", debug.afterAudioLeadInHitCount ?? "-"],
      ["after AudioLeadIn Analyzer Miss", debug.afterAudioLeadInAnalyzerMiss ?? "-"],
      ["after analyzer miss", debug.afterMissed ?? "-"],
      ["OSR comparison", debug.osrMissComparable ? "available" : "unavailable"],
      ["before offset hits", debug.beforeOffsetHits ?? "-"],
      ["after offset hits", debug.afterOffsetHits ?? "-"],
      ["before early ratio", formatNullablePercent(debug.beforeEarlyRatio)],
      ["before late ratio", formatNullablePercent(debug.beforeLateRatio)],
      ["after early ratio", formatNullablePercent(debug.afterEarlyRatio)],
      ["after late ratio", formatNullablePercent(debug.afterLateRatio)],
      ["current hits", debug.currentHits],
      ["reversed lane hits", debug.reversedLaneHits ?? "-"],
      ["best sampled offset", formatNullableDelta(debug.bestOffsetMs)],
      ["best sampled offset hits", debug.bestOffsetHits ?? "-"]
    ])}
    <div>
      <strong>first notes 20</strong>
      <pre class="debug-pre">${escapeHtml(JSON.stringify(debug.firstNotes, null, 2))}</pre>
    </div>
    <div>
      <strong>first input events 20</strong>
      <pre class="debug-pre">${escapeHtml(JSON.stringify(debug.firstInputs, null, 2))}</pre>
    </div>
    <div>
      <strong>first hit pairs 20</strong>
      <pre class="debug-pre">${escapeHtml(JSON.stringify(debug.firstHits, null, 2))}</pre>
    </div>
    <div>
      <strong>first missed notes 20</strong>
      <pre class="debug-pre">${escapeHtml(JSON.stringify(debug.firstMissedNotes, null, 2))}</pre>
    </div>
    <div>
      <strong>lane average deltas</strong>
      <pre class="debug-pre">${escapeHtml(JSON.stringify(debug.laneDeltaStats, null, 2))}</pre>
    </div>
    <div>
      <strong>miss breakdown</strong>
      <pre class="debug-pre">${escapeHtml(JSON.stringify(debug.missBreakdown, null, 2))}</pre>
    </div>
    <div>
      <strong>bitmask lane mapping</strong>
      <pre class="debug-pre">${escapeHtml(JSON.stringify(debug.laneMapping, null, 2))}</pre>
    </div>
    <div>
      <strong>offset samples</strong>
      <pre class="debug-pre">${escapeHtml(JSON.stringify(debug.offsetSamples, null, 2))}</pre>
    </div>
    <div>
      <strong>offset/window candidates</strong>
      <pre class="debug-pre">${escapeHtml(JSON.stringify(debug.calibrationCandidates, null, 2))}</pre>
    </div>
  `;
}

function buildUiAnalysisDebug() {
  if (!state.analysisResult?.debug) return null;
  const notes = state.analysisResult.notes ?? [];
  const keydowns = state.analysisResult.keydowns ?? [];
  const firstNoteTimeMs = notes[0]?.timeMs ?? null;
  const firstInputTimeMs = keydowns[0]?.timeMs ?? null;
  const reversedLaneHits = state.analysisMode === "replay" ? countHitsForEvents(reverseReplayInputLanes(state.replayInputEvents)) : null;
  const offsetSamples = state.analysisMode === "replay" ? sampleOffsetsForReplayInputs(state.replayInputEvents) : [];
  const bestOffset = offsetSamples.slice().sort((a, b) => b.hits - a.hits)[0] ?? null;
  const replayOffset = state.analysisResult.debug.replayOffset ?? null;
  const analysisWindow = state.analysisResult.debug.analysisWindow ?? replayOffset?.analysisWindow ?? {};
  const beforeRatios = replayOffset?.beforeSummary ? getEarlyLateRatios(replayOffset.beforeSummary) : null;
  const afterRatios = replayOffset?.afterSummary ? getEarlyLateRatios(replayOffset.afterSummary) : null;
  const osrMiss = state.osrMissCount;
  const analyzerMiss = state.analysisResult.summary.analyzerMissCount ?? getMistakeTypeCount(state.analysisResult.summary, "missed");

  return {
    ...state.analysisResult.debug,
    firstNoteTimeMs,
    firstInputTimeMs,
    firstInputMinusFirstNoteMs:
      Number.isFinite(firstNoteTimeMs) && Number.isFinite(firstInputTimeMs) ? firstInputTimeMs - firstNoteTimeMs : null,
    analysisStartTimeMs: analysisWindow.analysisStartTimeMs ?? null,
    analysisEndTimeMs: analysisWindow.analysisEndTimeMs ?? null,
    preNoteIgnoreMarginMs: analysisWindow.preNoteIgnoreMarginMs ?? state.settings.preNoteIgnoreMarginMs,
    postNoteIgnoreMarginMs: analysisWindow.postNoteIgnoreMarginMs ?? state.settings.postNoteIgnoreMarginMs,
    excludedBeforeCount: analysisWindow.excludedBeforeCount ?? 0,
    excludedAfterCount: analysisWindow.excludedAfterCount ?? 0,
    keptInputCount: analysisWindow.keptInputCount ?? null,
    originalInputCount: analysisWindow.originalInputCount ?? null,
    currentHits: state.analysisResult.summary.hitCount,
    reversedLaneHits,
    audioLeadInMs: replayOffset?.audioLeadInMs ?? getBeatmapAudioLeadInMs(),
    rawBestOffsetMs: replayOffset?.rawBestOffsetMs ?? null,
    normalizedBestOffsetMs: replayOffset?.normalizedBestOffsetMs ?? replayOffset?.bestOffsetMs ?? null,
    audioLeadInAdjustedOffsetMs: replayOffset?.audioLeadInAdjustedOffsetMs ?? null,
    totalAppliedOffsetMs: replayOffset?.totalAppliedOffsetMs ?? null,
    bestOffsetMs: replayOffset?.bestOffsetMs ?? bestOffset?.offsetMs ?? null,
    bestOffsetHits: replayOffset?.afterHitCount ?? bestOffset?.hits ?? null,
    autoOffsetMs: replayOffset?.bestOffsetMs ?? null,
    autoTimingWindowMs: replayOffset?.bestTimingWindowMs ?? null,
    osrMissComparable: Number.isFinite(osrMiss),
    osrMiss,
    analyzerMiss,
    missDifference: Number.isFinite(osrMiss) && Number.isFinite(analyzerMiss) ? analyzerMiss - osrMiss : null,
    afterMissed: replayOffset?.best?.analyzerMiss ?? analyzerMiss,
    missBreakdown: state.analysisResult.summary.lnBreakdown ?? state.analysisResult.debug.lnBreakdown,
    beforeAudioLeadInHitCount: replayOffset?.beforeAudioLeadInHitCount ?? null,
    beforeAudioLeadInAnalyzerMiss: replayOffset?.beforeAudioLeadInAnalyzerMiss ?? null,
    afterAudioLeadInHitCount: replayOffset?.afterAudioLeadInHitCount ?? null,
    afterAudioLeadInAnalyzerMiss: replayOffset?.afterAudioLeadInAnalyzerMiss ?? null,
    beforeOffsetHits: replayOffset?.beforeHitCount ?? null,
    afterOffsetHits: replayOffset?.afterHitCount ?? null,
    beforeEarlyRatio: beforeRatios?.early ?? null,
    beforeLateRatio: beforeRatios?.late ?? null,
    afterEarlyRatio: afterRatios?.early ?? null,
    afterLateRatio: afterRatios?.late ?? null,
    offsetSamples: replayOffset?.refinedSamples ?? offsetSamples,
    calibrationCandidates: replayOffset?.candidates ?? []
  };
}

function reverseReplayInputLanes(events) {
  return events.map((event) =>
    event.source === "osr"
      ? {
          ...event,
          lane: state.settings.laneCount - event.lane + 1
        }
      : event
  );
}

function sampleOffsetsForReplayInputs(events) {
  const candidates = [-1000, -750, -500, -250, -100, -50, 0, 50, 100, 250, 500, 750, 1000];
  return candidates.map((offsetMs) => ({
    offsetMs,
    hits: countHitsForEvents(shiftReplayInputTimes(events, offsetMs))
  }));
}

function shiftReplayInputTimes(events, offsetMs) {
  return events.map((event) =>
    event.source === "osr"
      ? {
          ...event,
          timeMs: event.timeMs + offsetMs
        }
      : event
  );
}

function countHitsForEvents(replayEvents) {
  if (!state.beatmap?.events?.length) return null;
  return analyzeEvents([...state.beatmap.events, ...replayEvents], state.settings).summary.hitCount;
}

function findBestReplayOffset(noteEvents, replayEvents, settings) {
  const grouped = groupOffsetSearchEvents(noteEvents, replayEvents, settings);
  const samples = [];
  let best = null;

  for (let offsetMs = -2000; offsetMs <= 2000; offsetMs += 10) {
    const score = scoreReplayOffset(grouped, settings, offsetMs);
    const sample = {
      offsetMs,
      hits: score.hits,
      averageAbsDeltaMs: score.averageAbsDeltaMs,
      averageDeltaMs: score.averageDeltaMs,
      medianDeltaMs: score.medianDeltaMs
    };

    if (offsetMs % 100 === 0) samples.push(sample);
    if (!best || sample.hits > best.hits || (sample.hits === best.hits && sample.averageAbsDeltaMs < best.averageAbsDeltaMs)) {
      best = sample;
    }
  }

  const refinedSamples = [];
  const refineStart = Math.max(-2000, best.offsetMs - 50);
  const refineEnd = Math.min(2000, best.offsetMs + 50);
  for (let offsetMs = refineStart; offsetMs <= refineEnd; offsetMs += 5) {
    const score = scoreReplayOffset(grouped, settings, offsetMs);
    const sample = {
      offsetMs,
      hits: score.hits,
      averageAbsDeltaMs: score.averageAbsDeltaMs,
      averageDeltaMs: score.averageDeltaMs,
      medianDeltaMs: score.medianDeltaMs
    };
    refinedSamples.push(sample);
    if (sample.hits > best.hits || (sample.hits === best.hits && sample.averageAbsDeltaMs < best.averageAbsDeltaMs)) {
      best = sample;
    }
  }

  return {
    bestOffsetMs: best.offsetMs,
    searchRangeMs: [-2000, 2000],
    coarseStepMs: 10,
    refinedStepMs: 5,
    bestAverageAbsDeltaMs: best.averageAbsDeltaMs,
    bestAverageDeltaMs: best.averageDeltaMs,
    bestMedianDeltaMs: best.medianDeltaMs,
    samples,
    refinedSamples
  };
}

function findBestReplayCalibration(noteEvents, replayEvents, settings, osrMissCount) {
  const hasOsrMiss = Number.isFinite(osrMissCount);
  const timingWindows = [...new Set([settings.timingWindowMs, 40, 50, 60, 70, 80, 90])]
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  const candidates = [];

  timingWindows.forEach((timingWindowMs) => {
    const candidateSettings = { ...settings, timingWindowMs };
    const offsetDebug = findBestReplayOffset(noteEvents, replayEvents, candidateSettings);
    const correctedReplayEvents = applyReplayOffset(replayEvents, offsetDebug.bestOffsetMs);
    const result = analyzeEvents([...noteEvents, ...correctedReplayEvents], candidateSettings);
    const missed = result.summary.analyzerMissCount ?? getMistakeTypeCount(result.summary, "missed");
    const early = getMistakeTypeCount(result.summary, "early");
    const late = getMistakeTypeCount(result.summary, "late");
    const extra = getMistakeTypeCount(result.summary, "extra");

    candidates.push({
      timingWindowMs,
      offsetMs: offsetDebug.bestOffsetMs,
      hitCount: result.summary.hitCount,
      totalMistakes: result.summary.totalMistakes,
      analyzerMiss: missed,
      missed: getMistakeTypeCount(result.summary, "missed"),
      lnBreakdown: result.summary.lnBreakdown,
      early,
      late,
      extra,
      osrMissCount: hasOsrMiss ? osrMissCount : null,
      osrMissDiff: hasOsrMiss ? Math.abs(missed - osrMissCount) : null,
      averageDeltaMs: result.debug.averageDeltaMs,
      medianDeltaMs: result.debug.medianDeltaMs,
      offsetAverageDeltaMs: offsetDebug.bestAverageDeltaMs,
      offsetMedianDeltaMs: offsetDebug.bestMedianDeltaMs
    });
  });

  const best = candidates
    .slice()
    .sort(
      (a, b) =>
        compareNullableDiff(a.osrMissDiff, b.osrMissDiff) ||
        b.hitCount - a.hitCount ||
        a.totalMistakes - b.totalMistakes ||
        Math.abs(a.offsetMs) - Math.abs(b.offsetMs)
    )[0];

  return {
    osrMissCount: hasOsrMiss ? osrMissCount : null,
    osrMissComparable: hasOsrMiss,
    best,
    candidates
  };
}

function groupOffsetSearchEvents(noteEvents, replayEvents, settings) {
  const lanes = [];
  for (let lane = 1; lane <= settings.laneCount; lane += 1) {
    lanes.push({
      lane,
      notes: noteEvents
        .filter((event) => event.eventType === "note" && event.lane === lane)
        .map((event) => event.timeMs)
        .sort((a, b) => a - b),
      inputs: replayEvents
        .filter((event) => event.eventType === "keydown" && event.lane === lane)
        .map((event) => event.timeMs)
        .sort((a, b) => a - b)
    });
  }
  return lanes;
}

function scoreReplayOffset(groupedEvents, settings, offsetMs) {
  const deltas = [];

  groupedEvents.forEach(({ notes, inputs: rawInputs }) => {
    const inputs = rawInputs.map((timeMs) => timeMs + offsetMs);

    let inputIndex = 0;
    notes.forEach((noteTime) => {
      while (inputIndex < inputs.length && inputs[inputIndex] < noteTime - settings.timingWindowMs) {
        inputIndex += 1;
      }

      let bestIndex = -1;
      let bestAbsDelta = Infinity;
      for (let index = inputIndex; index < inputs.length && inputs[index] <= noteTime + settings.timingWindowMs; index += 1) {
        const absDelta = Math.abs(inputs[index] - noteTime);
        if (absDelta < bestAbsDelta) {
          bestAbsDelta = absDelta;
          bestIndex = index;
        }
      }

      if (bestIndex === -1) return;

      deltas.push(inputs[bestIndex] - noteTime);
      inputs.splice(bestIndex, 1);
      if (bestIndex < inputIndex) inputIndex = bestIndex;
    });
  });

  return {
    hits: deltas.length,
    averageAbsDeltaMs: roundNumber(meanNumber(deltas.map(Math.abs))),
    averageDeltaMs: roundNumber(meanNumber(deltas)),
    medianDeltaMs: roundNumber(medianNumber(deltas))
  };
}

function applyReplayOffset(events, offsetMs) {
  return events.map((event) =>
    event.source === "osr"
      ? {
          ...event,
          rawTimeMs: event.rawTimeMs ?? event.timeMs,
          timeMs: event.timeMs + offsetMs,
          appliedOffsetMs: offsetMs
        }
      : event
  );
}

function meanNumber(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function medianNumber(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function roundNumber(value) {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
}

function getEarlyLateRatios(summary) {
  const total = Math.max(summary.totalMistakes, 1);
  const early = summary.byType.find((entry) => entry.id === "early")?.count ?? 0;
  const late = summary.byType.find((entry) => entry.id === "late")?.count ?? 0;
  return {
    early: early / total,
    late: late / total
  };
}

function getMistakeTypeCount(summary, type) {
  return summary.byType.find((entry) => entry.id === type)?.count ?? 0;
}

function getMissBreakdown(summary) {
  const ln = summary.lnBreakdown ?? {};
  return {
    tapNoteMiss: ln.tapNoteMiss ?? getMistakeTypeCount(summary, "missed"),
    lnStartMiss: ln.lnStartMiss ?? getMistakeTypeCount(summary, "lnStartMiss"),
    lnReleaseEarly: getMistakeTypeCount(summary, "lnReleaseEarly"),
    lnReleaseLate: getMistakeTypeCount(summary, "lnReleaseLate"),
    lnHoldBreak: ln.lnHoldBreak ?? getMistakeTypeCount(summary, "lnHoldBreak"),
    overhit: getMistakeTypeCount(summary, "extra"),
    early: getMistakeTypeCount(summary, "early"),
    late: getMistakeTypeCount(summary, "late")
  };
}

function buildCauseComments({ osrMiss, analyzerMiss, difference, breakdown, summary, replayOffset }) {
  const comments = [];
  const lnRelease = breakdown.lnReleaseEarly + breakdown.lnReleaseLate + breakdown.lnHoldBreak;
  const largest = Object.entries({
    "Tap Note Miss": breakdown.tapNoteMiss,
    "LN start": breakdown.lnStartMiss,
    "LN release/hold": lnRelease,
    Overhit: breakdown.overhit,
    Early: breakdown.early,
    Late: breakdown.late
  }).sort((a, b) => b[1] - a[1])[0] ?? ["Unknown", 0];

  if (Number.isFinite(osrMiss)) {
    if (difference > 0) {
      comments.push(`Analyzer Miss is ${difference} higher than OSR Miss. The largest visible cause is ${largest[0]} (${largest[1]}).`);
    } else if (difference < 0) {
      comments.push(`Analyzer Miss is ${Math.abs(difference)} lower than OSR Miss. Some misses may be classified as timing or overhit errors.`);
    } else {
      comments.push("Analyzer Miss matches OSR Miss.");
    }
  } else {
    comments.push("OSR Miss is unavailable, so direct comparison is not possible.");
  }

  if (lnRelease > 0) {
    comments.push(`LN release/hold related mistakes: ${lnRelease}. LN timing may be a major source of the remaining difference.`);
  }
  if (breakdown.early > breakdown.late * 2 && breakdown.early > 0) {
    comments.push("Early presses are dominant. Check offset and replay time alignment.");
  }
  if (breakdown.late > breakdown.early * 2 && breakdown.late > 0) {
    comments.push("Late presses are dominant. Check offset sign and timing alignment.");
  }
  if (breakdown.overhit > Math.max(20, analyzerMiss * 0.2)) {
    comments.push("Overhit is high. Check keydown/keyup conversion and bitmask lane mapping.");
  }
  if (replayOffset?.bestOffsetMs !== undefined) {
    comments.push("Offset and timing window were corrected automatically. Details are available in Analysis debug.");
  }

  return comments.slice(0, 5);
}
function compareNullableDiff(a, b) {
  const aValid = Number.isFinite(a);
  const bValid = Number.isFinite(b);
  if (aValid && bValid) return a - b;
  if (aValid) return -1;
  if (bValid) return 1;
  return 0;
}

function renderMetadataRows(rows) {
  return rows
    .map(
      ([label, value]) => `
        <div class="metadata-row">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(String(value))}</strong>
        </div>
      `
    )
    .join("");
}

function togglePlayback() {
  if (state.isPlaying) {
    stopPlayback();
    return;
  }

  if (state.playbackState.durationMs === 0) return;
  state.isPlaying = true;
  playbackStartedAt = performance.now();
  playbackStartTimeMs = state.playbackTimeMs;
  elements.playbackButton.textContent = t(state.settings.language, "pause");
  playbackTimerId = window.setInterval(tickPlayback, 60);
}

function tickPlayback() {
  const elapsed = performance.now() - playbackStartedAt;
  state.playbackTimeMs = Math.min(state.playbackState.durationMs, playbackStartTimeMs + elapsed);
  renderPlayback();

  if (state.playbackTimeMs >= state.playbackState.durationMs) {
    stopPlayback();
  }
}

function stopPlayback() {
  state.isPlaying = false;
  if (playbackTimerId !== null) {
    window.clearInterval(playbackTimerId);
    playbackTimerId = null;
  }
  elements.playbackButton.textContent = t(state.settings.language, "play");
}

function renderPlayback() {
  const playbackState = state.playbackState;
  const min = 0;
  const max = playbackState.durationMs;
  elements.playbackRange.min = String(min);
  elements.playbackRange.max = String(max);
  elements.playbackRange.value = String(Math.round(state.playbackTimeMs));
  elements.playbackRange.disabled = playbackState.durationMs === 0;
  elements.playbackCurrentTime.textContent = formatPlaybackTime(state.playbackTimeMs);
  elements.playbackButton.textContent = t(state.settings.language, state.isPlaying ? "pause" : "play");

  const absolutePlaybackTimeMs = playbackState.startMs + state.playbackTimeMs;
  const snapshot = getPlaybackSnapshot(playbackState, absolutePlaybackTimeMs);
  elements.playbackNextMistake.textContent = snapshot.nextMistake
    ? `${t(state.settings.language, "nextMistake")}: ${formatTime(snapshot.nextMistake.timeMs)} / ${t(state.settings.language, snapshot.nextMistake.type)}`
    : t(state.settings.language, "noNextMistake");

  elements.activeMistakes.innerHTML = snapshot.activeMistakes.length
    ? snapshot.activeMistakes.map(renderActiveMistake).join("")
    : `<p class="empty-state">${t(state.settings.language, "noActiveMistakes")}</p>`;
}

function renderActiveMistake(mistake) {
  const finger = getFingerLabel(mistake.finger, state.settings.language);
  return `
    <div class="active-mistake">
      <strong>${formatTime(mistake.timeMs)} - ${t(state.settings.language, mistake.type)}</strong>
      <div class="subtle">${t(state.settings.language, "laneLabel")} ${mistake.lane} / ${t(state.settings.language, "key")}: ${escapeHtml(mistake.key)} / ${t(state.settings.language, "finger")}: ${escapeHtml(finger)}</div>
    </div>
  `;
}

function formatPlaybackTime(timeMs) {
  return formatTime(timeMs);
}

function handleFingerChange(event) {
  const index = Number(event.target.dataset.index);
  if (!Number.isInteger(index)) return;

  const fingerMap = [...state.settings.fingerMap];
  fingerMap[index] = event.target.value === "custom" ? fingerMap[index] || "Custom" : event.target.value;
  updateSettings({ fingerMap });
  renderFingerEditor();
  rerunAnalysisIfReady();
}

function handleCustomFingerInput(event) {
  const index = Number(event.target.dataset.customIndex);
  if (!Number.isInteger(index)) return;

  const fingerMap = [...state.settings.fingerMap];
  fingerMap[index] = event.target.value.trim() || "Custom";
  savePartialSettings({ fingerMap });
  rerunAnalysisIfReady();
}

function updateSettings(partial) {
  state.settings = normalizeSettings({ ...state.settings, ...partial });
  saveSettings();
  render();
}

function savePartialSettings(partial) {
  state.settings = normalizeSettings({ ...state.settings, ...partial });
  saveSettings();
}

function setStatusKey(key) {
  state.statusMessageKey = key;
  state.statusMessageText = "";
  renderStatus();
}

function setStatusText(message) {
  state.statusMessageKey = "";
  state.statusMessageText = message;
  renderStatus();
}

function setStatusMessage(message) {
  state.statusMessageKey = message?.key ?? "";
  state.statusMessageText = message?.text ?? "";
  renderStatus();
}

function setMultiStatus(message) {
  elements.multiStatus.textContent = message;
}

function renderStatus() {
  elements.statusText.textContent = state.statusMessageKey
    ? t(state.settings.language, state.statusMessageKey)
    : state.statusMessageText;
}

function loadSettings() {
  try {
    return normalizeSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}"));
  } catch {
    return normalizeSettings(DEFAULT_SETTINGS);
  }
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatTime(timeMs) {
  const safeMs = Math.max(0, Math.round(Number(timeMs) || 0));
  const minutes = Math.floor(safeMs / 60000);
  const seconds = Math.floor((safeMs % 60000) / 1000);
  const milliseconds = safeMs % 1000;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

function formatNullableTime(value) {
  return Number.isFinite(value) ? formatTime(value) : "-";
}

function formatNullableDelta(value) {
  return Number.isFinite(value) ? `${value > 0 ? "+" : ""}${Math.round(value)}ms` : "-";
}

function formatNullablePercent(value) {
  return Number.isFinite(value) ? `${Math.round(value * 100)}%` : "-";
}

function formatSignedNumber(value) {
  return Number.isFinite(value) ? `${value > 0 ? "+" : ""}${value}` : "-";
}
