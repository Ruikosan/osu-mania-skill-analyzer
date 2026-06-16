const unsupportedBrowserReplayDecoder = {
  name: "browser-unsupported-lzma",
  canDecodeOsrFrames: false,
  async decodeLzmaReplayFrames() {
    throw new Error("LZMA replay frame decoding is not available in this browser session.");
  }
};

export const browserReplayDecoder = {
  name: "browser-lzma-js",
  get canDecodeOsrFrames() {
    return hasLzmaJsDecoder(globalThis) || isBrowserLike(globalThis);
  },
  async decodeLzmaReplayFrames(bytes) {
    const decoder = createBrowserLzmaJsDecoder(globalThis);
    if (!decoder) {
      return unsupportedBrowserReplayDecoder.decodeLzmaReplayFrames(bytes);
    }
    return decoder.decodeLzmaReplayFrames(bytes);
  }
};

export function createReplayDecoderAdapter(runtimeDecoder) {
  if (typeof runtimeDecoder !== "function") {
    return browserReplayDecoder;
  }

  return {
    name: "runtime-lzma-decoder",
    canDecodeOsrFrames: true,
    decodeLzmaReplayFrames: runtimeDecoder
  };
}

export function getReplayDecoderAdapter(globalObject = globalThis) {
  const exposedDecoder =
    globalObject?.osuManiaAnalyzer?.decodeLzmaReplayFrames ??
    globalObject?.electronAPI?.decodeLzmaReplayFrames ??
    globalObject?.replayDecoder?.decodeLzmaReplayFrames;

  if (typeof exposedDecoder === "function") {
    return createReplayDecoderAdapter((bytes) => exposedDecoder(toPlainByteArray(bytes)));
  }

  const browserDecoder = createBrowserLzmaJsDecoder(globalObject);
  if (browserDecoder) return browserDecoder;

  const nodeRequire = globalObject?.require;
  if (typeof nodeRequire === "function") {
    const nodeDecoder = createNodeLzmaDecoder(nodeRequire);
    if (nodeDecoder) return nodeDecoder;
  }

  return unsupportedBrowserReplayDecoder;
}

function createNodeLzmaDecoder(nodeRequire) {
  try {
    const lzmaNative = nodeRequire("lzma-native");
    if (typeof lzmaNative.decompress === "function") {
      return createReplayDecoderAdapter((bytes) =>
        new Promise((resolve, reject) => {
          lzmaNative.decompress(Buffer.from(bytes), (error, result) => {
            if (error) {
              reject(error);
              return;
            }
            resolve(bufferToUtf8(result));
          });
        })
      );
    }
  } catch {
    // Optional Electron dependency. Ignore and try the next adapter.
  }

  try {
    const lzma = nodeRequire("lzma");
    if (typeof lzma.decompress === "function") {
      return createReplayDecoderAdapter((bytes) =>
        new Promise((resolve, reject) => {
          lzma.decompress(toPlainByteArray(bytes), (result, error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve(typeof result === "string" ? result : bufferToUtf8(result));
          });
        })
      );
    }
  } catch {
    // Optional Electron dependency. Browser builds intentionally fall back.
  }

  return null;
}

function createBrowserLzmaJsDecoder(globalObject) {
  if (!getLzmaJs(globalObject) && !isBrowserLike(globalObject)) return null;

  return {
    name: "browser-lzma-js",
    canDecodeOsrFrames: true,
    async decodeLzmaReplayFrames(bytes) {
      const lzma = await ensureBrowserLzmaJs(globalObject);
      return new Promise((resolve, reject) => {
        lzma.decompress(toPlainByteArray(bytes), (result, error) => {
          if (error) {
            reject(new Error(`LZMA decoder failed: ${error.message ?? error}`));
            return;
          }
          resolve(typeof result === "string" ? result : bufferToUtf8(result));
        });
      });
    }
  };
}

function hasLzmaJsDecoder(globalObject) {
  return Boolean(getLzmaJs(globalObject));
}

function getLzmaJs(globalObject) {
  const lzma = globalObject?.LZMA_WORKER ?? globalObject?.LZMA;
  return typeof lzma?.decompress === "function" ? lzma : null;
}

async function ensureBrowserLzmaJs(globalObject) {
  const existing = getLzmaJs(globalObject);
  if (existing) return existing;

  if (!isBrowserLike(globalObject)) {
    throw new Error("LZMA decoder load failed: browser document is unavailable.");
  }

  await loadBrowserScript(globalObject, getBrowserLzmaUrl(globalObject));
  const loaded = getLzmaJs(globalObject);
  if (!loaded) {
    throw new Error("LZMA decoder load failed: LZMA_WORKER was not exposed.");
  }
  return loaded;
}

function loadBrowserScript(globalObject, scriptUrl) {
  return new Promise((resolve, reject) => {
    const document = globalObject.document;
    const existing = document.querySelector(`script[data-decoder="lzma-js"]`);
    if (existing) {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", () => reject(new Error(`LZMA decoder load failed: ${scriptUrl}`)), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = scriptUrl;
    script.async = true;
    script.dataset.decoder = "lzma-js";
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener("error", () => reject(new Error(`LZMA decoder load failed: ${scriptUrl}`)), { once: true });
    document.head.appendChild(script);
  });
}

function getBrowserLzmaUrl(globalObject) {
  const baseUrl = globalObject.document?.baseURI ?? globalObject.location?.href ?? "./";
  return new URL("./vendor/lzma/lzma_worker.js", baseUrl).href;
}

function isBrowserLike(globalObject) {
  return typeof globalObject?.document?.createElement === "function";
}

function toPlainByteArray(bytes) {
  return Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
}

function bufferToUtf8(value) {
  if (typeof value === "string") return value;
  return new TextDecoder("utf-8").decode(value instanceof Uint8Array ? value : new Uint8Array(value));
}
