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
    recovery: { mode: "month", includeToday: true, days: [], start: null, brk: null, dayOverrides: {} },
    holidays: { enabled: true, pentecost: false, alsace: false }, // official French public holidays (not Morocco)
    holidaySkipped: [],               // auto-holiday keys the user chose to work
    hrComparisons: [],                // last HR vs app balance comparisons
    prayer: { showMobile: true, showDesktop: true, lat: 31.6295, lng: -7.9811 }, // Marrakech, official Habous table + fallback
  };
  const withDefaults = (s) => Object.assign({}, DEFAULT_SETTINGS, s || {}, {
    perDay: Object.assign({}, DEFAULT_SETTINGS.perDay, (s && s.perDay) || {}),
    recovery: (function () {
      const rec = Object.assign({}, DEFAULT_SETTINGS.recovery, (s && s.recovery) || {});
      rec.days = Array.isArray(rec.days) ? rec.days.slice() : [];
      rec.dayOverrides = Object.assign({}, rec.dayOverrides || {});
      return rec;
    })(),
    holidays: Object.assign({}, DEFAULT_SETTINGS.holidays, (s && s.holidays) || {}),
    holidaySkipped: Array.isArray(s && s.holidaySkipped) ? s.holidaySkipped.slice() : [],
    hrComparisons: Array.isArray(s && s.hrComparisons) ? s.hrComparisons.slice() : [],
    prayer: (function () {
      const raw = (s && s.prayer) || {};
      const p = Object.assign({}, DEFAULT_SETTINGS.prayer, raw);
      if (Object.prototype.hasOwnProperty.call(raw, "show")
          && !Object.prototype.hasOwnProperty.call(raw, "showMobile")
          && !Object.prototype.hasOwnProperty.call(raw, "showDesktop")) {
        p.showMobile = p.showDesktop = !!raw.show;
      }
      delete p.show;
      return p;
    })(),
  });

  /* Base target for a weekday, ignoring days off. */
  function baseTarget(k, s) {
    const wd = weekday(k);
    if (s.perDayEnabled) return Math.max(0, Number(s.perDay[wd]) || 0);
    if (!s.workDays.includes(wd)) return 0;
    if (s.weeklyTarget != null && s.weeklyTarget !== "" && s.workDays.length) return Math.round(Number(s.weeklyTarget) / s.workDays.length);
    return Number(s.dailyTarget) || 0;
  }
  /* ---------- French public holidays (computed offline, Gregorian computus) ---------- */
  function easterSunday(year) {
    year = +year;
    const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const mod = (n, m) => ((n % m) + m) % m;
    const h = mod(19 * a + b - d - g + 15, 30), i = Math.floor(c / 4), k = c % 4;
    const l = mod(32 + 2 * e + 2 * i - h - k, 7), m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return dateKey(new Date(year, month - 1, day));
  }
  /* Official public holidays in metropolitan France. Pentecost Monday is optional (often a "journée de solidarité").
     Alsace-Moselle adds Good Friday and 26 December. */
  function frenchHolidays(year, opts) {
    opts = opts || {};
    const e = easterSunday(year);
    const list = [
      { key: year + "-01-01", id: "newYear" },
      { key: addDays(e, 1), id: "easterMonday" },
      { key: year + "-05-01", id: "labourDay" },
      { key: year + "-05-08", id: "victory" },
      { key: addDays(e, 39), id: "ascension" },
      { key: year + "-07-14", id: "nationalDay" },
      { key: year + "-08-15", id: "assumption" },
      { key: year + "-11-01", id: "allSaints" },
      { key: year + "-11-11", id: "armistice" },
      { key: year + "-12-25", id: "christmas" },
    ];
    if (opts.pentecost) list.push({ key: addDays(e, 50), id: "pentecostMonday" });
    if (opts.alsace) {
      list.push({ key: addDays(e, -2), id: "goodFriday" });
      list.push({ key: year + "-12-26", id: "stStephen" });
    }
    return list.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  }
  /* Auto holiday on this date, ignoring skipped/overrides (null if auto holidays are off). */
  function holidayOn(k, s) {
    const h = (s && s.holidays) || DEFAULT_SETTINGS.holidays;
    if (!k || h.enabled === false) return null;
    return frenchHolidays(+k.slice(0, 4), h).find((x) => x.key === k) || null;
  }
  /* Resolved special day for a date: user daysOff wins; otherwise an auto holiday unless skipped.
     Telework is a label only (still a working day). */
  function resolveOff(k, s, daysOff) {
    const manual = daysOff && daysOff[k];
    if (manual && manual.type) return manual;
    const hol = holidayOn(k, s);
    if (hol && !((s && s.holidaySkipped) || []).includes(k)) return { type: "holiday", auto: true, id: hol.id };
    return null;
  }
  const isNonWorkingOff = (off) => !!(off && off.type && off.type !== "telework");
  /* Set or clear a special day. Clearing an auto holiday records it in holidaySkipped so it does not come back. */
  function setDayOff(data, k, spec) {
    const s = withDefaults(data && data.settings);
    const daysOff = Object.assign({}, (data && data.daysOff) || {});
    const skipped = new Set(s.holidaySkipped || []);
    if (!spec || !spec.type) {
      delete daysOff[k];
      if (holidayOn(k, s)) skipped.add(k); else skipped.delete(k);
    } else {
      const row = { type: String(spec.type), half: !!spec.half };
      daysOff[k] = row;
      skipped.delete(k);
    }
    return { daysOff, settings: Object.assign({}, s, { holidaySkipped: [...skipped].sort() }) };
  }
  function applySpecialRange(data, from, to, spec) {
    if (to < from) { const x = from; from = to; to = x; }
    let daysOff = Object.assign({}, (data && data.daysOff) || {});
    let settings = withDefaults(data && data.settings);
    const half = !!(spec && spec.half && from === to);
    const payload = spec && spec.type ? { type: spec.type, half } : null;
    for (const k of eachDay(from, to)) {
      const r = setDayOff({ daysOff, settings }, k, payload);
      daysOff = r.daysOff; settings = r.settings;
    }
    return { daysOff, settings };
  }
  /* Target for a date, honouring days off / auto holidays (full = 0, half = half the target). Telework keeps the target. */
  function targetFor(k, s, daysOff) {
    const t = baseTarget(k, s);
    const off = resolveOff(k, s, daysOff);
    if (!isNonWorkingOff(off)) return t;
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
    return { key: k, sessions: list, worked, target, diff: worked - target, breaks, off: resolveOff(k, s, data.daysOff) };
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
  const minsAfterMidnight = (ms) => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); };
  /* First clock-in and total pauses of the last worked day strictly before `k` (defaults 09:00 and 1 h). */
  function habits(data, k) {
    const idx = indexByDay((data && data.sessions) || []);
    const last = [...idx.keys()].filter((d) => d < k).sort().pop();
    if (!last) return { start: 9 * 60, brk: 60, key: null };
    const l = idx.get(last);
    const brk = l.slice(1).reduce((t, x, i) => t + (l[i].end ? Math.max(0, Math.round((x.start - l[i].end) / MIN)) : 0), 0);
    return { start: minsAfterMidnight(l[0].start), brk, key: last };
  }
  /* Resolved entry and pauses for a plan day. Plan-level start/brk override the last day; per-day overrides win.
     For today, if already clocked in: real entry and real pauses so far, plus remaining planned pause when one was set. */
  function planTimes(data, k, now) {
    now = now == null ? Date.now() : now;
    const today = dateKey(now);
    const rec = withDefaults(data && data.settings).recovery;
    const auto = habits(data, today);
    const planStart = rec.start != null && rec.start !== "" ? +rec.start : auto.start;
    const planBrk = rec.brk != null && rec.brk !== "" ? +rec.brk : auto.brk;
    const ov = (rec.dayOverrides || {})[k] || {};
    const hasStart = ov.start != null && ov.start !== "";
    const hasBrk = ov.brk != null && ov.brk !== "";
    let start = hasStart ? +ov.start : planStart;
    let brk = hasBrk ? +ov.brk : planBrk;
    const manual = hasStart || hasBrk;
    let fromClock = false;
    if (k === today) {
      const list = sessionsOn(k, (data && data.sessions) || []) || [];
      if (list.length) {
        fromClock = true;
        start = minsAfterMidnight(list[0].start);
        const realBrk = dayStats(k, data, now).breaks;
        const pauseSet = hasBrk || (rec.brk != null && rec.brk !== "");
        brk = pauseSet ? Math.max(realBrk, hasBrk ? +ov.brk : planBrk) : realBrk;
      }
    }
    return { start, brk, autoStart: auto.start, autoBrk: auto.brk, planStart, planBrk, manual, fromClock, autoKey: auto.key };
  }
  const leaveFromTimes = (k, start, brk, target) => atTime(k, "00:00") + (start + brk + target) * MIN;
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
    const blocked = (k) => isNonWorkingOff(resolveOff(k, s, data.daysOff));
    let list;
    if (rec.mode === "week") { const end = addDays(weekStart(today), 6); list = [...eachDay(first, end)].filter((k) => !blocked(k) && baseTarget(k, s) > 0); }
    else if (rec.mode === "month") { list = [...eachDay(first, monthEnd(today))].filter((k) => !blocked(k) && baseTarget(k, s) > 0); }
    else if (rec.mode === "custom") { list = [...new Set(rec.days || [])].filter((k) => k >= first && !(blocked(k) && !((data.daysOff || {})[k] || {}).half)).sort(); }
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
      const t = planTimes(data, k, now);
      return { key: k, extra: parts[i], target, start: t.start, brk: t.brk, leaveAt: leaveFromTimes(k, t.start, t.brk, target),
        manual: t.manual, fromClock: t.fromClock };
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
    const times = planTimes(data, k, now);
    const leaveOf = (need, total) => {
      if (need <= 0) return null;
      if (d.sessions.length) return leaveFromTimes(k, times.start, times.brk, total);
      return running ? now + need * MIN : null;
    };
    return {
      key: k, ...d, running, open, remaining, plan, planExtra, goal, planTimes: times,
      balanceBefore: before, balanceNow: before + d.diff,
      leaveAt: leaveOf(remaining, goal),
      leaveAtTarget: leaveOf(d.target - d.worked, d.target),
      leaveAtZero: leaveOf(toZero, d.worked + toZero),
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

  /* App balance at an HR date, before applying a new anchor. Uses a previous valid anchor when it is older than this message;
     otherwise counts from startDate, or from the first session if startDate is after the HR date. */
  function compareHR(data, hr, now) {
    if (!hr || !hr.date) return null;
    now = now == null ? Date.now() : now;
    const s = withDefaults(data && data.settings);
    let calc = s;
    const prev = anchorValid(s) ? s.hrAnchor : null;
    if (prev && prev.date < hr.date) calc = s;
    else if (s.startDate && s.startDate <= hr.date) calc = s;
    else {
      const first = (data.sessions || []).reduce((m, x) => Math.min(m, x.start), Infinity);
      calc = Object.assign({}, s, { startDate: isFinite(first) ? dateKey(first) : hr.date, initialBalance: 0, hrAnchor: null });
    }
    const appMinutes = balance({ settings: calc, sessions: (data && data.sessions) || [], daysOff: (data && data.daysOff) || {} }, hr.date, now).minutes;
    const rhMinutes = hr.minutes;
    const delta = appMinutes - rhMinutes;
    return { date: hr.date, appMinutes, rhMinutes, delta, equal: Math.abs(delta) <= 1, usedPreviousAnchor: !!(prev && prev.date < hr.date) };
  }
  function recordComparison(settings, entry, limit) {
    const row = Object.assign({ at: Date.now() }, entry);
    const list = [row].concat((settings && settings.hrComparisons) || []).slice(0, limit || 8);
    return Object.assign({}, withDefaults(settings), { hrComparisons: list });
  }
  /* PWA shortcut action from a query string ("?action=punch"). */
  function shortcutAction(search) {
    const q = String(search || "").replace(/^[?#]/, "");
    const a = new URLSearchParams(q.indexOf("action=") >= 0 || q.indexOf("=") >= 0 ? q : "").get("action")
      || (String(search || "").match(/[?&]action=([a-z]+)/) || [])[1];
    return (a === "punch" || a === "balance") ? a : null;
  }

  return { MIN, pad, dateKey, parseKey, addDays, weekday, weekStart, monthStart, monthEnd, daysBetween, eachDay, hhmm, atTime,
    DEFAULT_SETTINGS, withDefaults, baseTarget, targetFor, resolveOff, isNonWorkingOff, holidayOn, easterSunday, frenchHolidays,
    setDayOff, applySpecialRange,
    roundMinutes, sessionMinutes, sessionsOn, workedOn, openSession, staleOpen,
    indexByDay, dayStats, rangeStats, balance, todaySummary, fmtDur, fmtClock, fmtSigned, parseDur, validate, toCSV, parseHR, applyHRAnchor, anchorValid,
    compareHR, recordComparison, shortcutAction,
    splitMinutes, recoveryDays, recoveryPlan, todayFinished, habits, planTimes, leaveFromTimes };
});
