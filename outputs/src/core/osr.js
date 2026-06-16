import { decodeReplayFramesToEvents } from "./replay-frames.js";

export function parseOsrMetadata(buffer) {
  const reader = createBinaryReader(buffer);
  const metadata = {
    gameMode: reader.readUint8(),
    gameVersion: reader.readInt32(),
    beatmapHash: reader.readOsuString(),
    playerName: reader.readOsuString(),
    replayHash: reader.readOsuString(),
    hitCounts: {
      count300: reader.readInt16(),
      count100: reader.readInt16(),
      count50: reader.readInt16(),
      countGeki: reader.readInt16(),
      countKatu: reader.readInt16(),
      countMiss: reader.readInt16()
    },
    score: reader.readInt32(),
    maxCombo: reader.readInt16(),
    perfectCombo: reader.readUint8() === 1,
    mods: reader.readInt32(),
    lifeBarGraph: reader.readOsuString(),
    timestampTicks: reader.readInt64(),
    compressedReplayLength: reader.readInt32()
  };

  metadata.modeName = getModeName(metadata.gameMode);
  metadata.isMania = metadata.gameMode === 3;
  metadata.replayDataOffset = reader.offset;
  metadata.canDecodeFrames = false;
  metadata.decodeNote = "Replay frames are LZMA-compressed in .osr files. The metadata is parsed now; frame decoding should be added through a desktop/runtime adapter next.";

  if (metadata.compressedReplayLength < 0 || metadata.replayDataOffset + metadata.compressedReplayLength > buffer.byteLength) {
    return {
      metadata,
      errors: ["Invalid compressed replay data length."]
    };
  }

  metadata.compressedReplayBytes = reader.readBytes(metadata.compressedReplayLength);

  return {
    metadata,
    errors: []
  };
}

export async function parseOsrReplay(buffer, settings, options = {}) {
  const parsed = parseOsrMetadata(buffer);
  const baseDebug = {
    compressedReplayByteLength: parsed.metadata?.compressedReplayBytes?.byteLength ?? 0,
    frameTextLength: 0,
    frameTextPreview: "",
    rawFrameChunkCount: 0,
    parsedFrameCount: 0,
    parsedFrameSamples: [],
    bitmaskSource: "-",
    bitmaskReason: ""
  };

  if (parsed.errors.length) {
    return {
      metadata: parsed.metadata,
      frames: [],
      events: [],
      errors: parsed.errors,
      warnings: [],
      debug: baseDebug
    };
  }

  const decodeLzma = options.decodeLzma;
  if (typeof decodeLzma !== "function") {
    return {
      metadata: parsed.metadata,
      frames: [],
      events: [],
      errors: [],
      warnings: [parsed.metadata.decodeNote],
      debug: baseDebug
    };
  }

  let frameText = "";
  try {
    frameText = normalizeDecodedFrameText(await decodeLzma(parsed.metadata.compressedReplayBytes));
  } catch (error) {
    return {
      metadata: parsed.metadata,
      frames: [],
      events: [],
      errors: [error.message || "LZMA decoder load failed."],
      warnings: [],
      debug: baseDebug
    };
  }

  const decodedDebug = {
    ...baseDebug,
    frameTextLength: frameText.length,
    frameTextPreview: frameText.slice(0, 500),
    rawFrameChunkCount: countRawFrameChunks(frameText)
  };

  if (!frameText.trim()) {
    return {
      metadata: parsed.metadata,
      frames: [],
      events: [],
      errors: ["Replay frame text is empty."],
      warnings: [],
      debug: decodedDebug
    };
  }

  const normalized = decodeReplayFramesToEvents(frameText, settings);
  const debug = {
    ...decodedDebug,
    ...normalized.debug,
    compressedReplayByteLength: baseDebug.compressedReplayByteLength
  };

  if (!normalized.frames.length) {
    return {
      metadata: parsed.metadata,
      frames: [],
      events: [],
      errors: ["Unsupported replay format: no replay frames were parsed."],
      warnings: [],
      debug
    };
  }

  if (parsed.metadata.isMania && !normalized.events.length) {
    return {
      metadata: {
        ...parsed.metadata,
        canDecodeFrames: true
      },
      frames: normalized.frames,
      events: [],
      errors: [`Key bitmask conversion failed: no key changes were found. ${debug.bitmaskReason}`],
      warnings: [],
      debug
    };
  }

  return {
    metadata: {
      ...parsed.metadata,
      canDecodeFrames: true
    },
    frames: normalized.frames,
    events: normalized.events,
    errors: [],
    warnings: [],
    debug
  };
}

function createBinaryReader(buffer) {
  const view = new DataView(buffer);
  let offset = 0;

  return {
    get offset() {
      return offset;
    },
    readUint8() {
      ensureAvailable(1);
      const value = view.getUint8(offset);
      offset += 1;
      return value;
    },
    readInt16() {
      ensureAvailable(2);
      const value = view.getInt16(offset, true);
      offset += 2;
      return value;
    },
    readInt32() {
      ensureAvailable(4);
      const value = view.getInt32(offset, true);
      offset += 4;
      return value;
    },
    readInt64() {
      ensureAvailable(8);
      const low = BigInt(view.getUint32(offset, true));
      const high = BigInt(view.getInt32(offset + 4, true));
      offset += 8;
      return high * 0x100000000n + low;
    },
    readBytes(length) {
      ensureAvailable(length);
      const bytes = new Uint8Array(buffer.slice(offset, offset + length));
      offset += length;
      return bytes;
    },
    readOsuString() {
      const marker = this.readUint8();
      if (marker === 0x00) return "";
      if (marker !== 0x0b) {
        throw new Error(`Invalid osu! string marker: ${marker}`);
      }

      const length = readUleb128();
      ensureAvailable(length);
      const bytes = new Uint8Array(buffer, offset, length);
      offset += length;
      return new TextDecoder("utf-8").decode(bytes);
    }
  };

  function readUleb128() {
    let result = 0;
    let shift = 0;

    while (true) {
      const byte = view.getUint8(offset);
      offset += 1;
      result |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return result;
      shift += 7;
    }
  }

  function ensureAvailable(length) {
    if (offset + length > buffer.byteLength) {
      throw new Error("Unexpected end of .osr file.");
    }
  }
}

function getModeName(mode) {
  return ["osu!", "taiko", "catch", "mania"][mode] ?? "unknown";
}

function normalizeDecodedFrameText(value) {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return new TextDecoder("utf-8").decode(value);
  if (Array.isArray(value)) return new TextDecoder("utf-8").decode(new Uint8Array(value));
  return String(value ?? "");
}

function countRawFrameChunks(frameText) {
  return String(frameText)
    .split(",")
    .map((chunk) => chunk.trim())
    .filter(Boolean).length;
}
