/* Pointage core: pure time & balance maths (no DOM). Works in the browser (window.PointageCore) and in Node (require). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PointageCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const MIN = 60000;
  const pad = (n) => String(n).padStart(2, "0");

  /* ---------- dates (local time, keys = "YYYY-MM-DD") ---------- */
  const dateKey = (d) => { d = new Date(d); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const parseKey = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return dateKey(d); };
  const weekday = (k) => parseKey(k).getDay();               // 0 = Sunday … 6 = Saturday
  const weekStart = (k) => addDays(k, -((weekday(k) + 6) % 7)); // Monday
  const monthStart = (k) => k.slice(0, 8) + "01";
  const monthEnd = (k) => { const d = parseKey(monthStart(k)); d.setMonth(d.getMonth() + 1, 0); return dateKey(d); };
  const daysBetween = (a, b) => Math.round((parseKey(b) - parseKey(a)) / 86400000);
  function* eachDay(from, to) { for (let k = from; k <= to; k = addDays(k, 1)) yield k; }
  const hhmm = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const atTime = (k, hm) => { const [h, m] = hm.split(":").map(Number); const d = parseKey(k); d.setHours(h, m, 0, 0); return d.getTime(); };

  /* ---------- settings ---------- */
  const DEFAULT_SETTINGS = {
    dailyTarget: 480,                 // minutes
    workDays: [1, 2, 3, 4, 5],        // Mon–Fri
    perDayEnabled: false,
    perDay: { 0: 0, 1: 480, 2: 480, 3: 480, 4: 480, 5: 480, 6: 0 },
    weeklyTarget: null,               // minutes, spread evenly over working days when set
    startDate: null,                  // "YYYY-MM-DD" (balance counted from this day)
    initialBalance: 0,                // minutes (negative = to make up)
    rounding: 0,                      // 0 | 5 | 10 | 15 … minutes
    roundMode: "nearest",             // nearest | down | up (applied to each session's duration)
    lang: "fr",
    theme: "auto",
  };
  const withDefaults = (s) => Object.assign({}, DEFAULT_SETTINGS, s || {}, { perDay: Object.assign({}, DEFAULT_SETTINGS.perDay, (s && s.perDay) || {}) });

  /* Base target for a weekday, ignoring days off. */
  function baseTarget(k, s) {
    const wd = weekday(k);
    if (s.perDayEnabled) return Math.max(0, Number(s.perDay[wd]) || 0);
    if (!s.workDays.includes(wd)) return 0;
    if (s.weeklyTarget != null && s.weeklyTarget !== "" && s.workDays.length) return Math.round(Number(s.weeklyTarget) / s.workDays.length);
    return Number(s.dailyTarget) || 0;
  }
  /* Target for a date, honouring days off (full = 0, half = half the target). */
  function targetFor(k, s, daysOff) {
    const t = baseTarget(k, s);
    const off = daysOff && daysOff[k];
    if (!off) return t;
    return off.half ? Math.round(t / 2) : 0;
  }

  /* ---------- sessions ---------- */
  function roundMinutes(m, step, mode) {
    if (!step) return m;
    const f = mode === "down" ? Math.floor : mode === "up" ? Math.ceil : Math.round;
    return f(m / step) * step;
  }
  /* Duration of one session in minutes. Open sessions count until `now`, but only on the day they started
     (a session left open on a previous day counts 0 until it is fixed). */
  function sessionMinutes(sess, now, s) {
    let end = sess.end;
    if (end == null) {
      if (dateKey(sess.start) !== dateKey(now)) return 0;
      end = now;
    }
    const raw = Math.max(0, (end - sess.start) / MIN);
    return sess.end == null ? Math.floor(raw) : roundMinutes(Math.round(raw), s ? s.rounding : 0, s ? s.roundMode : "nearest");
  }
  const sessionsOn = (k, sessions) => sessions.filter((x) => dateKey(x.start) === k).sort((a, b) => a.start - b.start);
  const workedOn = (k, sessions, now, s) => sessionsOn(k, sessions).reduce((t, x) => t + sessionMinutes(x, now, s), 0);
  const openSession = (sessions) => sessions.find((x) => x.end == null) || null;
  const staleOpen = (sessions, now) => sessions.filter((x) => x.end == null && dateKey(x.start) !== dateKey(now));

  /* Group sessions by day key once (fast for long histories). */
  function indexByDay(sessions) {
    const m = new Map();
    for (const x of sessions) { const k = dateKey(x.start); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
    for (const v of m.values()) v.sort((a, b) => a.start - b.start);
    return m;
  }

  function dayStats(k, data, now, idx) {
    const s = data.settings;
    const list = (idx ? idx.get(k) : sessionsOn(k, data.sessions)) || [];
    const worked = list.reduce((t, x) => t + sessionMinutes(x, now, s), 0);
    const target = targetFor(k, s, data.daysOff);
    const breaks = list.slice(1).reduce((t, x, i) => t + (list[i].end ? Math.max(0, Math.round((x.start - list[i].end) / MIN)) : 0), 0);
    return { key: k, sessions: list, worked, target, diff: worked - target, breaks, off: (data.daysOff || {})[k] || null };
  }
  function rangeStats(from, to, data, now, idx) {
    idx = idx || indexByDay(data.sessions);
    const days = []; let worked = 0, target = 0;
    for (const k of eachDay(from, to)) { const d = dayStats(k, data, now, idx); days.push(d); worked += d.worked; target += d.target; }
    return { from, to, days, worked, target, diff: worked - target };
  }

  /* Cumulative balance from settings.startDate (or first session) through `upTo` inclusive, plus the initial offset. */
  function balance(data, upTo, now) {
    const s = data.settings;
    let from = s.startDate;
    if (!from) { const first = data.sessions.reduce((m, x) => Math.min(m, x.start), Infinity); from = isFinite(first) ? dateKey(first) : upTo; }
    const init = Number(s.initialBalance) || 0;
    if (from > upTo) return { from, upTo, minutes: init };
    const r = rangeStats(from, upTo, data, now);
    return { from, upTo, minutes: init + r.diff, worked: r.worked, target: r.target };
  }

  /* Today summary: remaining minutes, estimated leave time to reach the day target and to bring the cumulative balance to 0. */
  function todaySummary(data, now) {
    const k = dateKey(now);
    const d = dayStats(k, data, now);
    const open = openSession(data.sessions);
    const running = !!(open && dateKey(open.start) === k);
    const remaining = Math.max(0, d.target - d.worked);
    const before = balance(data, addDays(k, -1), now).minutes;          // through yesterday
    const toZero = Math.max(0, d.target - d.worked - before);             // to end the day with a cumulative 0
    const base = running ? now : null;
    return {
      key: k, ...d, running, open, remaining,
      balanceBefore: before, balanceNow: before + d.diff,
      leaveAt: base != null && remaining > 0 ? base + remaining * MIN : null,
      leaveAtZero: base != null && toZero > 0 ? base + toZero * MIN : null,
      toZero,
    };
  }

  /* ---------- formatting ---------- */
  function fmtDur(min, lang) {
    const m = Math.round(Math.abs(min));
    const h = Math.floor(m / 60), r = m % 60;
    const H = lang === "ar" ? "س" : "h", M = lang === "ar" ? "د" : lang === "en" ? "min" : "mn";
    if (h && r) return `${h} ${H} ${r} ${M}`;
    if (h) return `${h} ${H}`;
    return `${r} ${M}`;
  }
  const fmtClock = (min) => { const m = Math.max(0, Math.floor(min)); return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; };
  const fmtSigned = (min, lang) => (min > 0 ? "+" : min < 0 ? "−" : "") + fmtDur(min, lang);
  /* Parse "8", "8h", "7h30", "7:30", "-1h16", "-76", "1 h 16 mn", "45mn" → minutes. Plain numbers ≤ 24 are hours, otherwise minutes. */
  function parseDur(str) {
    if (str == null) return null;
    let t = String(str).trim().toLowerCase().replace(/[−–]/g, "-").replace(/\s+/g, "");
    if (!t) return null;
    let sign = 1; if (t[0] === "-") { sign = -1; t = t.slice(1); } else if (t[0] === "+") t = t.slice(1);
    let m;
    if ((m = t.match(/^(\d+):(\d{1,2})$/))) return sign * (+m[1] * 60 + +m[2]);
    if ((m = t.match(/^(\d+(?:[.,]\d+)?)h(?:(\d{1,2})(?:mn|min|m)?)?$/))) return sign * Math.round(parseFloat(m[1].replace(",", ".")) * 60 + (+m[2] || 0));
    if ((m = t.match(/^(\d+)(?:mn|min|m)$/))) return sign * +m[1];
    if ((m = t.match(/^\d+(?:[.,]\d+)?$/))) { const v = parseFloat(t.replace(",", ".")); return sign * Math.round(v <= 24 ? v * 60 : v); }
    return null;
  }

  /* ---------- import / CSV ---------- */
  function validate(obj) {
    if (!obj || typeof obj !== "object" || !Array.isArray(obj.sessions)) throw new Error("invalid");
    const sessions = obj.sessions.filter((x) => x && Number.isFinite(+x.start)).map((x) => ({
      id: String(x.id || Math.random().toString(36).slice(2)), start: +x.start, end: x.end == null ? null : +x.end, note: x.note ? String(x.note) : "",
    }));
    return { version: 1, settings: withDefaults(obj.settings), sessions, daysOff: obj.daysOff && typeof obj.daysOff === "object" ? obj.daysOff : {} };
  }
  function toCSV(data, now) {
    const esc = (v) => /[;"\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
    const rows = [["date", "jour", "entree", "sortie", "duree_min", "duree", "note"].join(";")];
    const days = ["dim", "lun", "mar", "mer", "jeu", "ven", "sam"];
    for (const x of [...data.sessions].sort((a, b) => a.start - b.start)) {
      const k = dateKey(x.start); const m = sessionMinutes(x, now, data.settings);
      rows.push([k, days[weekday(k)], hhmm(x.start), x.end ? hhmm(x.end) : "", m, fmtClock(m), x.note || ""].map(esc).join(";"));
    }
    rows.push("");
    rows.push(["date", "jour", "travaille_min", "objectif_min", "ecart_min", "conge"].join(";"));
    const keys = [...new Set(data.sessions.map((x) => dateKey(x.start)).concat(Object.keys(data.daysOff || {})))].sort();
    if (keys.length) {
      const r = rangeStats(keys[0], keys[keys.length - 1] < dateKey(now) ? dateKey(now) : keys[keys.length - 1], data, now);
      for (const d of r.days) if (d.worked || d.off || d.target) rows.push([d.key, days[weekday(d.key)], d.worked, d.target, d.diff, d.off ? (d.off.type + (d.off.half ? " (1/2)" : "")) : ""].map(esc).join(";"));
    }
    return "\ufeff" + rows.join("\r\n");
  }

  return { MIN, pad, dateKey, parseKey, addDays, weekday, weekStart, monthStart, monthEnd, daysBetween, eachDay, hhmm, atTime,
    DEFAULT_SETTINGS, withDefaults, baseTarget, targetFor, roundMinutes, sessionMinutes, sessionsOn, workedOn, openSession, staleOpen,
    indexByDay, dayStats, rangeStats, balance, todaySummary, fmtDur, fmtClock, fmtSigned, parseDur, validate, toCSV };
});
