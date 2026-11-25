/* Pointage sync: compress, chunk, checksum and merge helpers (no DOM).
   Works in the browser (window.PointageSync) and in Node (require).
   Wire format never leaves the two devices except as QR / copied text. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    var lz;
    try { lz = require("./vendor/lz-string.min.js"); } catch (e) { lz = root && root.LZString; }
    module.exports = factory(lz, typeof require === "function" ? require("./core.js") : (root && root.PointageCore));
  } else {
    root.PointageSync = factory(root.LZString, root.PointageCore);
  }
})(typeof self !== "undefined" ? self : this, function (LZString, Core) {
  "use strict";
  const MAGIC_ENV = "P1C";
  const MAGIC_CHK = "P1";
  const DEFAULT_CHUNK_SIZE = 400;           // payload chars per QR (fits ~version 15–20, EC M, byte mode)
  const UNDO_KEY = "pointage.v1.undo";

  function needLz() {
    if (!LZString || typeof LZString.compressToBase64 !== "function") throw new Error("lz-string missing");
    return LZString;
  }
  const pad = (n, w) => String(n).padStart(w || 2, "0");
  function dateKey(ms) {
    if (Core && Core.dateKey) return Core.dateKey(ms);
    const d = new Date(ms);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  /* ---------- CRC-32 (ISO 3309) of UTF-8 bytes, lowercase hex ---------- */
  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();
  function crc32(str) {
    let crc = 0xffffffff;
    const s = String(str);
    if (typeof TextEncoder !== "undefined") {
      const bytes = new TextEncoder().encode(s);
      for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    } else {
      const u = unescape(encodeURIComponent(s));
      for (let i = 0; i < u.length; i++) crc = CRC_TABLE[(crc ^ u.charCodeAt(i)) & 0xff] ^ (crc >>> 8);
    }
    return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0");
  }

  function randId() {
    const a = new Uint8Array(4);
    if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(a);
    else for (let i = 0; i < 4; i++) a[i] = Math.floor(Math.random() * 256);
    return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  /* ---------- pack / unpack (same data shape as the JSON export) ---------- */
  function pack(data, exportedAt) {
    return JSON.stringify({ app: "pointage", format: 1, exportedAt: exportedAt == null ? Date.now() : exportedAt, data: data });
  }
  function unpack(json, validate) {
    const o = JSON.parse(json);
    if (!o || typeof o !== "object") throw new Error("invalid");
    const raw = (o.app === "pointage" && o.data) ? o.data : o;
    const fn = validate || (Core && Core.validate);
    const data = fn ? fn(raw) : raw;
    return { data: data, exportedAt: (o.app === "pointage" && o.exportedAt) || null, format: o.format || 0 };
  }

  /* ---------- envelope & chunks ---------- */
  function strip(text) { return String(text || "").replace(/[\s\u200b\ufeff]+/g, ""); }

  function makeEnvelope(compressed, crc) { return MAGIC_ENV + "|" + crc + "|" + compressed; }
  function parseEnvelope(text) {
    const t = strip(text);
    const m = t.match(/^P1C\|([0-9a-f]{8})\|([A-Za-z0-9+/=]+)$/i);
    if (!m) return null;
    return { crc: m[1].toLowerCase(), compressed: m[2] };
  }
  function parseChunk(text) {
    const t = strip(text);
    const m = t.match(/^P1\|([0-9a-f]{8})\|(\d+)\|(\d+)\|([0-9a-f]{8})\|([0-9a-f]{8})\|([A-Za-z0-9+/=]*)$/i);
    if (!m) return null;
    const index = +m[2], total = +m[3];
    if (!total || index < 1 || index > total) return null;
    return { id: m[1].toLowerCase(), index: index, total: total, crc: m[4].toLowerCase(), ccrc: m[5].toLowerCase(), part: m[6] };
  }

  function makeChunks(compressed, crc, chunkSize, id) {
    const size = Math.max(16, chunkSize || DEFAULT_CHUNK_SIZE);
    id = id || randId();
    const n = Math.max(1, Math.ceil(compressed.length / size));
    const chunks = [];
    for (let i = 0; i < n; i++) {
      const part = compressed.slice(i * size, (i + 1) * size);
      const ccrc = crc32(part);
      const text = MAGIC_CHK + "|" + id + "|" + (i + 1) + "|" + n + "|" + crc + "|" + ccrc + "|" + part;
      chunks.push({ i: i + 1, n: n, id: id, crc: crc, ccrc: ccrc, part: part, text: text });
    }
    return chunks;
  }

  function encode(data, opts) {
    opts = opts || {};
    const lz = needLz();
    const packed = pack(data, opts.exportedAt);
    const compressed = lz.compressToBase64(packed);
    const crc = crc32(compressed);
    const envelope = makeEnvelope(compressed, crc);
    const chunks = makeChunks(compressed, crc, opts.chunkSize, opts.id);
    return { envelope: envelope, chunks: chunks, crc: crc, packed: packed.length, compressed: compressed.length };
  }

  function decodeCompressed(compressed, crc, validate) {
    if (crc32(compressed) !== crc) throw new Error("checksum");
    const json = needLz().decompressFromBase64(compressed);
    if (typeof json !== "string" || !json) throw new Error("invalid");
    return unpack(json, validate);
  }

  function decode(text, validate) {
    const env = parseEnvelope(text);
    if (env) return decodeCompressed(env.compressed, env.crc, validate);
    const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length) {
      const col = collector(validate);
      let last = null;
      for (const line of lines) last = col.add(line);
      if (last && last.complete) return last.result;
      if (last && !last.ok) throw new Error(last.error || "invalid");
    }
    throw new Error("invalid");
  }

  /* ---------- collector: chunks in any order, plus full envelope ---------- */
  function collector(validate) {
    let bag = null;            // { id, total, crc, parts: {index: part}, got }
    function reset() { bag = null; }
    function status() {
      if (!bag) return { got: 0, total: 0, id: null };
      return { got: bag.got, total: bag.total, id: bag.id, crc: bag.crc };
    }
    function finish(compressed, crc) {
      try {
        const result = decodeCompressed(compressed, crc, validate);
        return { ok: true, kind: "complete", complete: true, got: bag ? bag.total : 1, total: bag ? bag.total : 1, result: result };
      } catch (e) {
        return { ok: false, error: e.message === "checksum" ? "checksum" : "invalid", complete: false };
      }
    }
    function add(text) {
      const env = parseEnvelope(text);
      if (env) return finish(env.compressed, env.crc);
      const ch = parseChunk(text);
      if (!ch) return { ok: false, error: "invalid", complete: false };
      if (crc32(ch.part) !== ch.ccrc) return { ok: false, error: "corrupt", complete: false, index: ch.index };
      if (!bag || bag.id !== ch.id) bag = { id: ch.id, total: ch.total, crc: ch.crc, parts: Object.create(null), got: 0 };
      if (ch.total !== bag.total || ch.crc !== bag.crc) return { ok: false, error: "conflict", complete: false };
      const prev = bag.parts[ch.index];
      if (prev != null && prev !== ch.part) return { ok: false, error: "conflict", complete: false, index: ch.index };
      if (prev == null) { bag.parts[ch.index] = ch.part; bag.got++; }
      if (bag.got < bag.total) return { ok: true, kind: "chunk", complete: false, id: bag.id, index: ch.index, got: bag.got, total: bag.total };
      let compressed = "";
      for (let i = 1; i <= bag.total; i++) {
        if (bag.parts[i] == null) return { ok: false, error: "invalid", complete: false };
        compressed += bag.parts[i];
      }
      return finish(compressed, bag.crc);
    }
    return { add: add, reset: reset, status: status };
  }

  /* ---------- preview + merge ---------- */
  function summarize(data) {
    const sessions = (data && data.sessions) || [];
    const daysOff = (data && data.daysOff) || {};
    const closedDays = (data && data.closedDays) || {};
    const days = new Set([...Object.keys(daysOff), ...Object.keys(closedDays)]);
    for (const s of sessions) if (s && Number.isFinite(+s.start)) days.add(dateKey(+s.start));
    const keys = [...days].sort();
    const hr = data && data.settings && data.settings.hrAnchor;
    return {
      sessions: sessions.length,
      days: keys.length,
      from: keys[0] || null,
      to: keys[keys.length - 1] || null,
      hr: hr && hr.date ? { date: hr.date, minutes: hr.minutes, text: hr.text || "" } : null,
    };
  }

  function dayStamp(sessions, off, closed) {
    let max = 0;
    for (const s of sessions) {
      if (s && Number.isFinite(+s.start)) max = Math.max(max, +s.start);
      if (s && s.end != null && Number.isFinite(+s.end)) max = Math.max(max, +s.end);
    }
    if (off && Number.isFinite(+off.at)) max = Math.max(max, +off.at);
    if (closed && Number.isFinite(+closed.at)) max = Math.max(max, +closed.at);
    return max;
  }
  function indexByDay(data) {
    const map = Object.create(null);
    for (const s of (data.sessions || [])) {
      if (!s || !Number.isFinite(+s.start)) continue;
      const k = dateKey(+s.start);
      if (!map[k]) map[k] = { sessions: [], off: null, closed: null };
      map[k].sessions.push(s);
    }
    for (const [k, off] of Object.entries(data.daysOff || {})) {
      if (!map[k]) map[k] = { sessions: [], off: off, closed: null };
      else map[k].off = off;
    }
    for (const [k, closed] of Object.entries(data.closedDays || {})) {
      if (!map[k]) map[k] = { sessions: [], off: null, closed: closed };
      else map[k].closed = closed;
    }
    return map;
  }
  /* Per day, the newer side wins (max session start/end). Settings stay those of the local (receiving) device. */
  function merge(local, incoming, validate) {
    const a = indexByDay(local || { sessions: [], daysOff: {} });
    const b = indexByDay(incoming || { sessions: [], daysOff: {} });
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    const sessions = [];
    const daysOff = {};
    const closedDays = {};
    for (const k of keys) {
      const la = a[k], lb = b[k];
      const pick = !la ? lb : !lb ? la : (dayStamp(lb.sessions, lb.off, lb.closed) >= dayStamp(la.sessions, la.off, la.closed) ? lb : la);
      sessions.push.apply(sessions, pick.sessions);
      if (pick.off) daysOff[k] = pick.off;
      if (pick.closed) closedDays[k] = pick.closed;
    }
    const raw = { version: 1, settings: (local && local.settings) || {}, sessions: sessions, daysOff: daysOff, closedDays: closedDays };
    const fn = validate || (Core && Core.validate);
    return fn ? fn(raw) : raw;
  }

  /* ---------- one-shot undo of the last apply on this device ---------- */
  function saveUndo(data) {
    try { localStorage.setItem(UNDO_KEY, JSON.stringify({ at: Date.now(), data: data })); return true; }
    catch (e) { return false; }
  }
  function loadUndo(validate) {
    try {
      const raw = JSON.parse(localStorage.getItem(UNDO_KEY) || "null");
      if (!raw || !raw.data) return null;
      const fn = validate || (Core && Core.validate);
      return fn ? fn(raw.data) : raw.data;
    } catch (e) { return null; }
  }
  function clearUndo() { try { localStorage.removeItem(UNDO_KEY); } catch (e) {} }
  function hasUndo() { try { return !!localStorage.getItem(UNDO_KEY); } catch (e) { return false; } }

  return {
    DEFAULT_CHUNK_SIZE: DEFAULT_CHUNK_SIZE, UNDO_KEY: UNDO_KEY,
    crc32: crc32, pack: pack, unpack: unpack, parseEnvelope: parseEnvelope, parseChunk: parseChunk,
    makeChunks: makeChunks, encode: encode, decode: decode, collector: collector,
    summarize: summarize, merge: merge,
    saveUndo: saveUndo, loadUndo: loadUndo, clearUndo: clearUndo, hasUndo: hasUndo,
  };
});
