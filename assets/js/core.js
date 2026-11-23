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
    hrAnchor: null,                   // { date, minutes, text, appliedAt } from a pasted HR message
    recovery: { mode: "month", includeToday: true, days: [] },   // plan to make up a negative balance: off | month | week | custom
  };
  const withDefaults = (s) => Object.assign({}, DEFAULT_SETTINGS, s || {}, {
    perDay: Object.assign({}, DEFAULT_SETTINGS.perDay, (s && s.perDay) || {}),
    recovery: Object.assign({}, DEFAULT_SETTINGS.recovery, (s && s.recovery) || {}),
  });

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
  /* ---------- recovery plan ---------- */
  /* Split `total` minutes over n days in whole minutes; the remainder goes one minute each to the first days. */
  function splitMinutes(total, n) {
    if (n <= 0 || total <= 0) return [];
    const base = Math.floor(total / n), r = total - base * n;
    return Array.from({ length: n }, (_, i) => base + (i < r ? 1 : 0));
  }
  const median = (a) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return b[Math.floor((b.length - 1) / 2)]; };
  /* Usual first clock-in (minutes after midnight) and usual total break, from the last 20 worked days before `k`. */
  function habits(data, k) {
    const idx = indexByDay(data.sessions);
    const keys = [...idx.keys()].filter((d) => d < k).sort().slice(-20);
    const starts = [], breaks = [];
    for (const d of keys) {
      const l = idx.get(d); const st = new Date(l[0].start); starts.push(st.getHours() * 60 + st.getMinutes());
      if (l.every((x) => x.end)) breaks.push(l.slice(1).reduce((t, x, i) => t + Math.max(0, Math.round((x.start - l[i].end) / MIN)), 0));
    }
    return { start: median(starts) ?? 9 * 60, brk: median(breaks) ?? 60 };
  }
  /* Is today finished? (sessions recorded, nothing running and the day target reached) */
  function todayFinished(data, now) {
    const k = dateKey(now), d = dayStats(k, data, now);
    return d.sessions.length > 0 && !d.sessions.some((x) => x.end == null) && d.worked >= d.target;
  }
  /* Candidate days for a mode (keys ≥ first day). Days off and non-working days are excluded, except custom picks on a
     non-working day (the user chose to come in); days off are always excluded. */
  function recoveryDays(data, now, rec) {
    const s = data.settings, today = dateKey(now);
    const first = rec.includeToday && !todayFinished(data, now) ? today : addDays(today, 1);
    const off = data.daysOff || {};
    let list;
    if (rec.mode === "week") { const end = addDays(weekStart(today), 6); list = [...eachDay(first, end)].filter((k) => !off[k] && baseTarget(k, s) > 0); }
    else if (rec.mode === "month") { list = [...eachDay(first, monthEnd(today))].filter((k) => !off[k] && baseTarget(k, s) > 0); }
    else if (rec.mode === "custom") { list = [...new Set(rec.days || [])].filter((k) => k >= first && !(off[k] && !off[k].half)).sort(); }
    else list = [];
    return list;
  }
  /* Plan to bring the cumulative balance (through yesterday) back to 0. null when nothing to recover or mode "off". */
  function recoveryPlan(data, now) {
    const s = data.settings, rec = Object.assign({}, DEFAULT_SETTINGS.recovery, s.recovery || {});
    if (rec.mode === "off") return null;
    const today = dateKey(now);
    const deficit = -balance(data, addDays(today, -1), now).minutes;
    if (deficit <= 0) return null;
    const keys = recoveryDays(data, now, rec);
    const parts = splitMinutes(deficit, keys.length);
    const h = habits(data, today);
    const days = keys.map((k, i) => {
      const target = targetFor(k, s, data.daysOff) + parts[i];
      const brk = target > 6 * 60 ? h.brk : 0;
      return { key: k, extra: parts[i], target, leaveAt: atTime(k, "00:00") + (h.start + brk + target) * MIN };
    });
    return { mode: rec.mode, includeToday: rec.includeToday, deficit, days, perDay: parts.length ? Math.max(...parts) : 0,
      perDayMin: parts.length ? Math.min(...parts) : 0, todayExtra: days[0] && days[0].key === today ? days[0].extra : 0, habits: h };
  }

  /* Today summary: remaining minutes, estimated leave time to reach the day target (plus today's recovery extra when a plan
     is active) and to bring the cumulative balance to 0. */
  function todaySummary(data, now) {
    const k = dateKey(now);
    const d = dayStats(k, data, now);
    const open = openSession(data.sessions);
    const running = !!(open && dateKey(open.start) === k);
    const plan = recoveryPlan(data, now);
    const planExtra = plan ? plan.todayExtra : 0;
    const goal = d.target + planExtra;                                      // today's goal including the plan
    const remaining = Math.max(0, goal - d.worked);
    const before = balance(data, addDays(k, -1), now).minutes;          // through yesterday
    const toZero = Math.max(0, d.target - d.worked - before);             // to end the day with a cumulative 0
    const base = running ? now : null;
    return {
      key: k, ...d, running, open, remaining, plan, planExtra, goal,
      balanceBefore: before, balanceNow: before + d.diff,
      leaveAt: base != null && remaining > 0 ? base + remaining * MIN : null,
      leaveAtTarget: base != null && d.target - d.worked > 0 ? base + (d.target - d.worked) * MIN : null,
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


  /* ---------- HR message parser ----------
     Finds every "au <jour> <mois> [année] au cumul … tu dois rattraper X" (deficit, negative) or
     "… dépassement / en avance / en plus X" (positive) in pasted text, ignoring chat noise.
     Returns { date, minutes, text, all } for the most recent date (same date twice → last one in the text), or null. */
  const MONTHS = [["janv", 1], ["jan", 1], ["fevr", 2], ["fev", 2], ["feb", 2], ["mars", 3], ["mar", 3], ["avr", 4], ["apr", 4], ["mai", 5], ["may", 5],
    ["juin", 6], ["jun", 6], ["juil", 7], ["jul", 7], ["aout", 8], ["aou", 8], ["aug", 8], ["sept", 9], ["sep", 9], ["oct", 10], ["nov", 11], ["dec", 12]];
  const monthNum = (w) => { for (const [p, n] of MONTHS) if (w.startsWith(p)) return n; return 0; };
  const norm = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\u00a0\u202f]/g, " ").toLowerCase();
  const NEG = /rattrap|retard|deficit|manque|en moins|a recuperer|dois|debiteur|negati/;
  const POS = /depassement|en avance|en plus|de plus|excedent|surplus|crediteur|positi|d'avance|supplementaire/;
  const ZERO = /a jour|equilibre|aucun (?:retard|depassement)|solde (?:est )?(?:nul|a 0|de 0)/;
  function parseAmount(seg) {
    const re = /(?<![a-z0-9:])(\d{1,3})\s*h(?:eures?|rs?)?\s*(?:(\d{1,2})\s*(?:mn|min(?:utes?)?|m)?)?(?![a-z0-9])|(?<![a-z0-9:])(\d{1,4})\s*(?:mn|min(?:utes?)?)(?![a-z])/;
    const m = seg.match(re);
    if (!m) return null;
    return { minutes: m[3] != null ? +m[3] : +m[1] * 60 + (+m[2] || 0), index: m.index };
  }
  function parseHR(text, now) {
    const raw = String(text || ""), t = norm(raw);
    now = now == null ? Date.now() : now;
    const today = dateKey(now);
    const re = /\bau\s+(\d{1,2})(?:er)?\s*(?:([a-z]+)\.?|\/\s*(\d{1,2}))(?:\s*\/?\s*(\d{4}))?[\s,.]*au\s+cumul/g;
    const hits = []; let m;
    while ((m = re.exec(t))) hits.push(m);
    const found = [];
    hits.forEach((h, i) => {
      const day = +h[1], mon = h[2] ? monthNum(h[2]) : +h[3];
      if (!mon || mon > 12 || day < 1 || day > 31) return;
      let year = h[4] ? +h[4] : parseKey(today).getFullYear();
      let key = `${year}-${pad(mon)}-${pad(day)}`;
      if (!h[4] && key > today) { year -= 1; key = `${year}-${pad(mon)}-${pad(day)}`; }
      if (dateKey(parseKey(key)) !== key) return;                       // invalid day (e.g. 31 Nov)
      const end = i + 1 < hits.length ? hits[i + 1].index : t.length;
      const seg = t.slice(h.index + h[0].length, Math.min(end, h.index + h[0].length + 240));
      const amt = parseAmount(seg);
      const before = amt ? seg.slice(0, amt.index) : seg;
      let sign = 0;
      if (NEG.test(before)) sign = -1; else if (POS.test(before)) sign = 1;
      else if (amt && NEG.test(seg.slice(amt.index, amt.index + 60))) sign = -1;
      else if (amt && POS.test(seg.slice(amt.index, amt.index + 60))) sign = 1;
      let minutes;
      if (amt && sign) minutes = sign * amt.minutes;
      else if (ZERO.test(seg) || (amt && amt.minutes === 0)) minutes = 0;
      else return;
      found.push({ date: key, minutes, order: i, start: h.index, end: h.index + h[0].length + (amt ? amt.index + 20 : 60) });
    });
    if (!found.length) return null;
    const best = found.reduce((a, b) => (b.date >= a.date ? b : a));
    return { date: best.date, minutes: best.minutes, text: lineAround(raw, best, t), count: found.length, all: found.map(({ date, minutes }) => ({ date, minutes })) };
  }
  /* Anchor model: balance at the end of the HR date = HR figure; the app's own tracking continues the next day. History is kept. */
  function applyHRAnchor(settings, hr, now) {
    return Object.assign({}, settings, { startDate: addDays(hr.date, 1), initialBalance: hr.minutes,
      hrAnchor: { date: hr.date, minutes: hr.minutes, text: hr.text || "", appliedAt: now == null ? Date.now() : now } });
  }
  /* True when startDate / initialBalance still match the stored anchor (otherwise the user changed them by hand). */
  const anchorValid = (s) => !!(s.hrAnchor && s.startDate === addDays(s.hrAnchor.date, 1) && Number(s.initialBalance) === s.hrAnchor.minutes);
  /* The raw line(s) containing the chosen message (best effort, used only for display/storage). */
  function lineAround(raw, f, t) {
    if (t.length !== raw.length) return raw.trim().slice(0, 400);
    let a = raw.lastIndexOf("\n", f.start); a = a < 0 ? 0 : a + 1;
    let b = raw.indexOf("\n", f.start); if (b < 0) b = raw.length;
    return raw.slice(a, b).trim().slice(0, 400);
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
    indexByDay, dayStats, rangeStats, balance, todaySummary, fmtDur, fmtClock, fmtSigned, parseDur, validate, toCSV, parseHR, applyHRAnchor, anchorValid,
    splitMinutes, recoveryDays, recoveryPlan, todayFinished, habits };
});
