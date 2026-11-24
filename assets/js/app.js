/* Pointage app: UI + local storage. All data stays in this browser (localStorage key "pointage.v1"). */
(function () {
  "use strict";
  const C = window.PointageCore, I18N = window.I18N;
  const APP_VERSION = "1.3.1";
  const KEY = "pointage.v1";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  /* ---------- storage ---------- */
  function load() {
    try { const raw = localStorage.getItem(KEY); if (raw) return C.validate(JSON.parse(raw)); } catch (e) { console.warn("Pointage: could not read data", e); }
    const s = C.withDefaults({ startDate: C.dateKey(Date.now()) });
    const nav = (navigator.language || "fr").slice(0, 2);
    s.lang = I18N[nav] && nav !== "en" ? nav : "fr";
    return { version: 1, settings: s, sessions: [], daysOff: {} };
  }
  let data = load();
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); }
    catch (e) { toast("⚠ " + e.message); }
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  /* ---------- i18n ---------- */
  const L = () => I18N[data.settings.lang] || I18N.fr;
  const t = (k, vars) => { let s = L()[k] ?? I18N.fr[k] ?? k; if (vars) for (const [a, b] of Object.entries(vars)) s = s.replace(`{${a}}`, b); return s; };
  const dur = (m) => C.fmtDur(m, data.settings.lang);
  const signed = (m) => C.fmtSigned(m, data.settings.lang);
  const locale = () => ({ fr: "fr-FR", en: "en-GB", ar: "ar-MA" }[data.settings.lang] || "fr-FR");
  const fmtDate = (k, opts) => C.parseKey(k).toLocaleDateString(locale(), opts || { weekday: "long", day: "numeric", month: "long" });
  const balanceText = (m) => (m < 0 ? t("mustCatchUp", { x: dur(m) }) : m > 0 ? t("ahead", { x: dur(m) }) : t("upToDate"));
  const offTypes = () => L().offTypes || I18N.fr.offTypes;
  const holidayName = (id) => (L().holidayNames || I18N.fr.holidayNames || {})[id] || id;
  const offLabel = (off) => {
    if (!off) return "";
    if (off.auto && off.id) return holidayName(off.id);
    return offTypes()[off.type] || off.type;
  };
  const fillOffSelect = (el, includeEmpty) => {
    el.innerHTML = (includeEmpty ? `<option value="">${t("none")}</option>` : "") +
      Object.entries(offTypes()).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
  };

  function applyStatic() {
    const lang = data.settings.lang;
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    $$("[data-i18n]").forEach((el) => { const v = t(el.dataset.i18n); if (typeof v === "string") el.textContent = v; });
    $("#langSelect").value = lang;
    const off = $("#offType");
    const prevOff = off.value, prevRange = $("#offRangeType") && $("#offRangeType").value;
    fillOffSelect(off, true);
    if (prevOff) off.value = prevOff;
    if ($("#offRangeType")) {
      fillOffSelect($("#offRangeType"), false);
      if (prevRange) $("#offRangeType").value = prevRange;
    }
  }
  function applyTheme() {
    const th = data.settings.theme;
    const dark = th === "dark" || (th === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", applyTheme);

  /* ---------- toast ---------- */
  let toastTimer;
  function toast(msg) { const el = $("#toast"); el.textContent = msg; el.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 2400); }

  /* ---------- clock in / out ---------- */
  function clockToggle() {
    const now = Date.now();
    const today = C.dateKey(now);
    const open = data.sessions.find((x) => x.end == null && C.dateKey(x.start) === today);
    if (open) { open.end = Math.max(now, open.start + 1000); toast(`${t("clockOut")} ${C.hhmm(now)} ✔`); }
    else { data.sessions.push({ id: uid(), start: now, end: null, note: "" }); toast(`${t("clockIn")} ${C.hhmm(now)} ✔`); }
    persist(); render();
    try { if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.isActive)) navigator.vibrate(30); } catch (e) {}
  }

  /* ---------- TODAY view ---------- */
  function renderToday() {
    const now = Date.now();
    const s = C.todaySummary(data, now);
    const L_ = L();
    // stale open sessions from previous days
    const stale = C.staleOpen(data.sessions, now);
    const banner = $("#staleBanner");
    if (stale.length) {
      const k = C.dateKey(stale[0].start);
      banner.innerHTML = `<span>${t("staleWarn", { d: fmtDate(k, { weekday: "short", day: "numeric", month: "short" }) })}</span><button class="btn small" data-day="${k}">${t("fix")}</button>`;
      banner.hidden = false;
    } else banner.hidden = true;

    // hero
    const btn = $("#clockBtn");
    btn.className = "clock-btn " + (s.running ? "out" : "in");
    $("#clockLabel").textContent = s.running ? t("clockOut") : t("clockIn");
    $("#clockIcon").textContent = s.running ? "■" : "▶";
    const status = $("#statusLine");
    status.className = "status" + (s.running ? " on" : "");
    status.textContent = s.running ? `${t("working")} ${C.hhmm(s.open.start)}` : s.sessions.length ? `${t("dayDone")} · ${C.hhmm(s.sessions[s.sessions.length - 1].end)}` : t("notWorking");
    $("#tTarget").textContent = s.off && !s.target ? L_.offTypes[s.off.type] || t("dayOff") : dur(s.target) + (s.planExtra ? ` + ${dur(s.planExtra)}` : "");
    if (s.worked >= s.goal && s.goal > 0) { $("#tRemainingLabel").textContent = t("extra"); $("#tRemaining").textContent = "+" + dur(s.worked - s.goal); }
    else { $("#tRemainingLabel").textContent = t("remaining"); $("#tRemaining").textContent = dur(s.remaining); }
    $("#tLeaveLabel").textContent = s.planExtra ? t("planLeaveLabel") : t("leaveAt");
    $("#tLeave").textContent = s.leaveAt ? C.hhmm(s.leaveAt) : s.goal > 0 && s.worked >= s.goal ? "✔" : "–";
    $("#tLeaveZero").textContent = s.leaveAtZero ? (C.dateKey(s.leaveAtZero) === s.key ? C.hhmm(s.leaveAtZero) : "> 24:00") : s.toZero === 0 && (s.worked || s.balanceBefore >= 0) ? "✔" : "–";
    const pct = s.target ? Math.min(1, s.worked / s.target) : s.worked ? 1 : 0;
    const ring = $("#ringFg");
    ring.style.strokeDashoffset = String(326.73 * (1 - pct));
    ring.classList.toggle("done", s.target > 0 && s.worked >= s.target);
    $("#timerSub").textContent = s.target ? `/ ${dur(s.target)}` : "";
    tick();

    // balance
    const bc = $("#balanceCard");
    const yk = C.addDays(s.key, -1);
    bc.classList.toggle("neg", s.balanceBefore < 0); bc.classList.toggle("pos", s.balanceBefore > 0);
    $("#balanceAt").textContent = t("balanceAt", { d: fmtDate(yk, { day: "numeric", month: "short" }) });
    $("#balanceMain").textContent = balanceText(s.balanceBefore);
    $("#balanceNow").textContent = s.sessions.length || s.target === 0
      ? (s.running ? t("ifLeaveNow", { x: signed(s.balanceNow) }) : t("withToday", { x: signed(s.balanceNow) }))
      : "";

    $("#hrAnchorLine").textContent = hrAnchorText();
    renderPlan(s, now);

    // week
    const ws = C.weekStart(s.key);
    const w = C.rangeStats(ws, C.addDays(ws, 6), data, now);
    $("#weekNums").textContent = `${dur(w.worked)} / ${dur(w.target)}`;
    const wb = $("#weekBar");
    wb.style.width = (w.target ? Math.min(100, (w.worked / w.target) * 100) : 0) + "%";
    wb.classList.toggle("done", w.target > 0 && w.worked >= w.target);
    $("#weekDays").innerHTML = w.days.map((d) => {
      const past = d.key <= s.key;
      const cls = ["wd", d.key === s.key ? "today" : "", !d.target ? "off" : ""].join(" ");
      const diff = past && (d.worked || d.target) && d.key < s.key ? `<span class="d ${d.diff >= 0 ? "pos" : "neg"}">${d.diff >= 0 ? "+" : "−"}${C.fmtClock(Math.abs(d.diff))}</span>` : `<span class="d">&nbsp;</span>`;
      return `<div class="${cls}" data-day="${d.key}" title="${fmtDate(d.key)}">${L_.days[C.weekday(d.key)]}<b>${d.worked ? C.fmtClock(d.worked) : "–"}</b>${diff}</div>`;
    }).join("");

    // sessions list
    const ul = $("#todaySessions");
    if (!s.sessions.length) { ul.innerHTML = `<li class="gap">${t("noSessions")}</li>`; return; }
    const items = [];
    s.sessions.forEach((x, i) => {
      if (i > 0 && s.sessions[i - 1].end) items.push(`<li class="gap">☕ ${t("breaks")} · ${dur(Math.round((x.start - s.sessions[i - 1].end) / C.MIN))}</li>`);
      const m = C.sessionMinutes(x, now, data.settings);
      items.push(`<li><span dir="ltr">${C.hhmm(x.start)} → ${x.end ? C.hhmm(x.end) : `<span class="live">${t("open")}</span>`}</span><b>${dur(m)}</b></li>`);
    });
    ul.innerHTML = items.join("");
  }

  /* live timer (seconds) */
  function tick() {
    const now = Date.now();
    const today = C.dateKey(now);
    const list = C.sessionsOn(today, data.sessions);
    let sec = 0;
    for (const x of list) sec += x.end ? C.sessionMinutes(x, now, data.settings) * 60 : Math.max(0, Math.floor((now - x.start) / 1000));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), ss = sec % 60;
    const running = list.some((x) => !x.end);
    $("#timer").textContent = running ? `${h}:${C.pad(m)}:${C.pad(ss)}` : `${C.pad(h)}:${C.pad(m)}`;
  }

  /* ---------- HISTORY view ---------- */
  let histMonth = C.monthStart(C.dateKey(Date.now()));
  function renderHistory() {
    const now = Date.now(), today = C.dateKey(now), L_ = L();
    const from = histMonth, end = C.monthEnd(histMonth);
    const autoKeys = (a, b) => {
      const s = data.settings;
      if (!s.holidays || s.holidays.enabled === false) return [];
      const years = new Set([+a.slice(0, 4), +b.slice(0, 4)]);
      const skipped = new Set(s.holidaySkipped || []);
      const out = [];
      for (const y of years) for (const h of C.frenchHolidays(y, s.holidays)) if (h.key >= a && h.key <= b && !skipped.has(h.key) && !data.daysOff[h.key]) out.push(h.key);
      return out;
    };
    const offKeys = [...new Set([...Object.keys(data.daysOff).filter((k) => k >= from && k <= end), ...autoKeys(from, end)])];
    const lastData = [today, ...offKeys].filter((k) => k <= end).sort().pop();
    const to = lastData < from ? null : (lastData > end ? end : lastData);
    $("#monthTitle").textContent = C.parseKey(from).toLocaleDateString(locale(), { month: "long", year: "numeric" });
    const later = C.addDays(end, 1);
    $("#nextMonth").disabled = C.monthStart(today) <= from && !Object.keys(data.daysOff).some((k) => k > end) && autoKeys(later, C.addDays(later, 400)).length === 0;
    const idx = C.indexByDay(data.sessions);
    if (!to) { $("#monthTotals").textContent = ""; $("#historyList").innerHTML = `<div class="card muted center">${t("noSessions")}</div>`; return; }
    const m = C.rangeStats(from, to, data, now, idx);
    const sd = data.settings.startDate;
    const counted = (d) => d.key <= today && (!sd || d.key >= sd);   // days that count in the balance
    const pastDiff = m.days.filter(counted).reduce((a, d) => a + d.diff, 0);
    $("#monthTotals").textContent = `${t("worked")} ${dur(m.worked)} · ${t("target")} ${dur(m.target)} · ${signed(pastDiff)}`;

    // weeks (newest first)
    const weeks = new Map();
    for (const d of m.days) { const ws = C.weekStart(d.key); if (!weeks.has(ws)) weeks.set(ws, []); weeks.get(ws).push(d); }
    const html = [];
    for (const [ws, days] of [...weeks.entries()].reverse()) {
      const full = C.rangeStats(ws, C.addDays(ws, 6), data, now, idx);
      const wdiff = full.days.filter(counted).reduce((a, d) => a + d.diff, 0);
      html.push(`<div class="week-block"><div class="week-head"><span>${t("week")} ${fmtDate(ws, { day: "numeric", month: "short" })} – ${fmtDate(C.addDays(ws, 6), { day: "numeric", month: "short" })}</span><span>${dur(full.worked)} / ${dur(full.target)} · <span class="${wdiff >= 0 ? "pos" : "neg"}">${signed(wdiff)}</span></span></div><div class="card history-card">`);
      for (const d of [...days].reverse()) {
        const wd = C.weekday(d.key);
        const ss = d.sessions.map((x) => `${C.hhmm(x.start)}–${x.end ? C.hhmm(x.end) : "…"}`).join(" · ");
        const offB = d.off ? `<span class="badge ${d.off.type === "telework" ? "tele" : "off"}">${offLabel(d.off)}${d.off.half ? " ½" : ""}</span> ` : "";
        const staleB = d.sessions.some((x) => !x.end) && d.key !== today ? `<span class="badge warn">⚠</span> ` : "";
        const diffTxt = !counted(d) ? "" : (d.worked || d.target) ? `<small class="${d.diff >= 0 ? "pos" : "neg"}">${signed(d.diff)}</small>` : "";
        html.push(`<div class="day-row${wd === 0 || wd === 6 ? " weekend" : ""}${d.key === today ? " is-today" : ""}" data-day="${d.key}" role="button" tabindex="0">
          <div class="dn"><b>${C.parseKey(d.key).getDate()}</b><span>${L_.days[wd]}</span></div>
          <div class="ss">${offB}${staleB}${ss || (d.target ? "—" : "")}</div>
          <div class="tot"><b>${d.worked ? dur(d.worked) : "–"}</b>${diffTxt}</div></div>`);
      }
      html.push("</div></div>");
    }
    $("#historyList").innerHTML = html.join("");
  }

  /* ---------- day editor ---------- */
  let editingDay = null;
  function rowHtml(st = "", en = "") {
    return `<li><label>${t("start")}<input type="time" class="r-start" value="${st}" required></label>
      <label>${t("end")}<input type="time" class="r-end" value="${en}"></label>
      <button type="button" class="btn icon r-del" aria-label="${t("delete")}">🗑</button></li>`;
  }
  function openDay(k) {
    editingDay = k;
    const now = Date.now();
    const d = C.dayStats(k, data, now);
    const title = fmtDate(k, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    $("#dayTitle").textContent = title.charAt(0).toUpperCase() + title.slice(1);
    $("#daySummary").textContent = `${t("worked")} ${dur(d.worked)} · ${t("target")} ${dur(d.target)}${d.breaks ? ` · ${t("breaks")} ${dur(d.breaks)}` : ""}`;
    $("#dayRows").innerHTML = d.sessions.map((x) => rowHtml(C.hhmm(x.start), x.end ? C.hhmm(x.end) : "")).join("") || "";
    if (!d.sessions.length && !d.off) $("#dayRows").innerHTML = rowHtml();
    $("#offType").value = d.off ? d.off.type : "";
    $("#offHalf").checked = !!(d.off && d.off.half);
    $("#offHalf").closest("label").hidden = ($("#offType").value === "telework");
    $("#dayError").hidden = true;
    $("#dayDialog").showModal();
  }
  function saveDay() {
    const k = editingDay, today = C.dateKey(Date.now());
    const rows = $$("#dayRows li").map((li) => ({ st: $(".r-start", li).value, en: $(".r-end", li).value })).filter((r) => r.st || r.en);
    const old = C.sessionsOn(k, data.sessions);
    const next = [];
    for (const [i, r] of rows.entries()) {
      if (!r.st) return showErr(t("invalidTime"));
      const start = C.atTime(k, r.st);
      let end = r.en ? C.atTime(k, r.en) : null;
      if (end != null && end <= start) return showErr(t("invalidTime"));
      if (end == null && (k !== today || i !== rows.length - 1)) return showErr(t("invalidTime"));
      // keep original seconds when the minute did not change
      const prev = old[i];
      const keep = (a, b) => (a != null && b != null && C.hhmm(a) === C.hhmm(b) ? a : b);
      next.push({ id: prev ? prev.id : uid(), start: prev ? keep(prev.start, start) : start, end: prev && end != null ? keep(prev.end, end) : end, note: prev ? prev.note : "" });
    }
    next.sort((a, b) => a.start - b.start);
    for (let i = 1; i < next.length; i++) if (next[i - 1].end == null || next[i].start < next[i - 1].end) return showErr(t("invalidTime"));
    if (next.filter((x) => x.end == null).length > 1) return showErr(t("invalidTime"));
    data.sessions = data.sessions.filter((x) => C.dateKey(x.start) !== k).concat(next);
    const type = $("#offType").value;
    const r = C.setDayOff(data, k, type ? { type, half: type !== "telework" && $("#offHalf").checked } : null);
    data.daysOff = r.daysOff; data.settings = r.settings;
    persist(); $("#dayDialog").close(); render(); toast(t("saved"));
    return true;
  }
  function showErr(msg) { const e = $("#dayError"); e.textContent = msg; e.hidden = false; return false; }

  /* ---------- SETTINGS view ---------- */
  const hm = (m) => `${m < 0 ? "-" : ""}${Math.floor(Math.abs(m) / 60)}h${C.pad(Math.abs(m) % 60)}`;
  function renderSettings() {
    const s = data.settings, f = $("#settingsForm"), L_ = L();
    f.dailyTarget.value = hm(s.dailyTarget);
    f.weeklyTarget.value = s.weeklyTarget != null ? hm(s.weeklyTarget) : "";
    f.perDayEnabled.checked = !!s.perDayEnabled;
    f.startDate.value = s.startDate || "";
    f.initialBalance.value = s.initialBalance ? hm(s.initialBalance) : "";
    f.rounding.value = String(s.rounding || 0);
    f.roundMode.value = s.roundMode;
    f.lang.value = s.lang; f.theme.value = s.theme;
    const order = [1, 2, 3, 4, 5, 6, 0];
    $("#workDays").innerHTML = order.map((d) => `<label class="chip"><input type="checkbox" name="wd" value="${d}" ${s.workDays.includes(d) ? "checked" : ""}><span>${L_.days[d]}</span></label>`).join("");
    $("#perDay").innerHTML = order.map((d) => `<label>${L_.days[d]}<input name="pd${d}" value="${hm(s.perDay[d] || 0)}"></label>`).join("");
    $("#perDay").hidden = !s.perDayEnabled;
    $("#appVersion").textContent = "v" + APP_VERSION;
    $("#hrAnchorSettings").textContent = hrAnchorText() || t("hrAnchorNone");
    $("#syncUndo").hidden = !window.PointageSync.hasUndo();
    const hol = s.holidays || {};
    $("#holEnabled").checked = hol.enabled !== false;
    $("#holPentecost").checked = !!hol.pentecost;
    $("#holAlsace").checked = !!hol.alsace;
    $("#holPentecost").disabled = !$("#holEnabled").checked;
    $("#holAlsace").disabled = !$("#holEnabled").checked;
    renderCompareList($("#hrCompareList"), true);
  }
  function saveSettings(e) {
    e.preventDefault();
    const f = e.target, s = Object.assign({}, data.settings);
    const daily = C.parseDur(f.dailyTarget.value);
    if (daily == null || daily < 0 || daily > 24 * 60) return toast(t("invalidDur"));
    s.dailyTarget = daily;
    const weekly = f.weeklyTarget.value.trim() ? C.parseDur(f.weeklyTarget.value) : null;
    if (f.weeklyTarget.value.trim() && (weekly == null || weekly < 0)) return toast(t("invalidDur"));
    // weekly values like "40" are hours
    s.weeklyTarget = weekly != null && /^\s*\d+([.,]\d+)?\s*$/.test(f.weeklyTarget.value) ? Math.round(parseFloat(f.weeklyTarget.value.replace(",", ".")) * 60) : weekly;
    s.workDays = $$("input[name=wd]:checked", f).map((x) => +x.value).sort();
    s.perDayEnabled = f.perDayEnabled.checked;
    s.perDay = {};
    for (let d = 0; d < 7; d++) { const v = C.parseDur(f["pd" + d].value); s.perDay[d] = v == null ? 0 : Math.max(0, v); }
    s.startDate = f.startDate.value || null;
    const init = f.initialBalance.value.trim() ? C.parseDur(f.initialBalance.value) : 0;
    if (init == null) return toast(t("invalidDur"));
    // "-76" means minutes here; a bare "-1" would be one hour, which is confusing, so treat bare numbers > 24 as minutes (parseDur does)
    s.initialBalance = init;
    s.rounding = +f.rounding.value; s.roundMode = f.roundMode.value;
    s.lang = f.lang.value; s.theme = f.theme.value;
    if (s.hrAnchor && !C.anchorValid(s)) s.hrAnchor = null;   // start date / balance edited by hand → anchor no longer applies
    data.settings = s; persist(); applyTheme(); applyStatic(); render(); toast(t("saved"));
  }

  /* ---------- import / export ---------- */
  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  const stamp = () => C.dateKey(Date.now());
  function importFile(file) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const obj = C.validate(JSON.parse(r.result));
        if (!confirm(t("confirmImport"))) return;
        data = obj; persist(); applyTheme(); applyStatic(); render(); toast(t("importOk"));
      } catch (e) { toast(t("importErr")); }
    };
    r.readAsText(file);
  }

  /* ---------- recovery plan ---------- */
  const recovery = () => C.withDefaults(data.settings).recovery;
  const toHM = (m) => C.pad(Math.floor((Number(m) || 0) / 60)) + ":" + C.pad(Math.abs(Number(m) || 0) % 60);
  const fromHM = (s) => {
    if (s == null || s === "") return null;
    const [h, m] = String(s).split(":").map(Number);
    return Number.isFinite(h) ? h * 60 + (Number.isFinite(m) ? m : 0) : null;
  };
  function renderPlan(s, now) {
    const card = $("#planCard");
    if (s.balanceBefore >= 0) { card.hidden = true; return; }
    card.hidden = false;
    const rec = recovery(), L_ = L(), today = s.key;
    $("#planMode").value = rec.mode;
    $("#planToday").checked = !!rec.includeToday;
    $("#planToday").closest("label").hidden = rec.mode === "off";
    $("#planTotal").textContent = t("planTotal", { x: dur(-s.balanceBefore) });
    // custom day picker: from this week's Monday, 5 weeks
    const wrap = $("#planPickerWrap");
    wrap.hidden = rec.mode !== "custom";
    if (rec.mode === "custom") {
      const from = C.weekStart(today), sel = new Set(rec.days || []), cells = [];
      for (let i = 0; i < 35; i++) {
        const k = C.addDays(from, i), off = C.resolveOff(k, data.settings, data.daysOff);
        const past = k < today || (k === today && (!rec.includeToday || C.todayFinished(data, now)));
        const dis = past || (C.isNonWorkingOff(off) && !off.half);
        cells.push(`<label class="chip" title="${fmtDate(k)}"><input type="checkbox" data-plan-day="${k}" ${sel.has(k) && !dis ? "checked" : ""} ${dis ? "disabled" : ""}><span>${L_.days[C.weekday(k)]}<b>${C.parseKey(k).getDate()}</b></span></label>`);
      }
      $("#planPicker").innerHTML = cells.join("");
    }
    const p = s.plan, ul = $("#planDays");
    fillPlanHabits(p);
    $("#planHabits").hidden = rec.mode === "off";
    if (rec.mode === "off" || !p) { $("#planSummary").textContent = ""; ul.innerHTML = ""; $("#planHint").textContent = ""; return; }
    if (!p.days.length) { $("#planSummary").textContent = ""; ul.innerHTML = `<li><span class="meta">${t("planNoDays")}</span></li>`; $("#planHint").textContent = ""; return; }
    $("#planSummary").textContent = p.perDay === p.perDayMin ? t("planPerDay", { x: dur(p.perDay), n: p.days.length })
      : t("planPerDayRange", { a: dur(p.perDayMin), b: dur(p.perDay), n: p.days.length });
    ul.innerHTML = p.days.map((d) => {
      const leave = d.leaveAt;
      const label = d.key === today ? t("today") : fmtDate(d.key, { weekday: "short", day: "numeric", month: "short" });
      const manuel = d.manual ? `<span class="badge manuel">${t("planManual")}</span>` : "";
      return `<li class="${d.key === today ? "is-today" : ""}" data-plan-row="${d.key}" role="button" tabindex="0">
        <span>${label}${manuel}</span><span class="x">+${dur(d.extra)}</span>
        <span class="meta">${t("planEntryShort", { t: toHM(d.start) })} · ${t("planBreaksShort", { x: dur(d.brk) })} · ${t("planLeave", { t: C.hhmm(leave) })}</span></li>`;
    }).join("");
    $("#planHint").textContent = t("planHint", { s: toHM(p.habits.start), b: dur(p.habits.brk) });
  }
  function fillPlanHabits(p) {
    const rec = recovery();
    const autoS = rec.start == null, autoB = rec.brk == null;
    const start = autoS ? (p && p.habits ? p.habits.start : 9 * 60) : rec.start;
    const brk = autoB ? (p && p.habits ? p.habits.brk : 60) : rec.brk;
    const aS = $("#planStartAuto"), aB = $("#planBrkAuto"), iS = $("#planStart"), iB = $("#planBrk");
    if (document.activeElement !== aS) aS.checked = autoS;
    if (document.activeElement !== aB) aB.checked = autoB;
    if (document.activeElement !== iS) { iS.value = toHM(start); iS.disabled = autoS; }
    if (document.activeElement !== iB) { iB.value = hm(brk); iB.disabled = autoB; }
  }
  function setRecovery(patch) { data.settings.recovery = Object.assign(recovery(), patch); persist(); render(); }
  $("#planMode").addEventListener("change", (e) => {
    const patch = { mode: e.target.value };
    if (e.target.value === "custom" && !(recovery().days || []).length) {
      // pre-select the remaining working days of this week as a starting point
      patch.days = C.recoveryDays(data, Date.now(), Object.assign(recovery(), { mode: "week" }));
    }
    setRecovery(patch);
  });
  $("#planToday").addEventListener("change", (e) => setRecovery({ includeToday: e.target.checked }));
  $("#planPicker").addEventListener("change", (e) => {
    const k = e.target.dataset.planDay; if (!k) return;
    const today = C.dateKey(Date.now());
    const days = new Set((recovery().days || []).filter((d) => d >= today));
    e.target.checked ? days.add(k) : days.delete(k);
    setRecovery({ days: [...days].sort() });
  });
  $("#planStartAuto").addEventListener("change", (e) => {
    if (e.target.checked) setRecovery({ start: null });
    else setRecovery({ start: fromHM($("#planStart").value) ?? 9 * 60 });
  });
  $("#planBrkAuto").addEventListener("change", (e) => {
    if (e.target.checked) setRecovery({ brk: null });
    else { const v = C.parseDur($("#planBrk").value); setRecovery({ brk: v != null && v >= 0 ? v : 60 }); }
  });
  $("#planStart").addEventListener("change", () => {
    const v = fromHM($("#planStart").value); if (v != null) setRecovery({ start: v });
  });
  $("#planBrk").addEventListener("change", () => {
    const v = C.parseDur($("#planBrk").value); if (v != null && v >= 0) setRecovery({ brk: v });
  });

  let planDayKey = null;
  function openPlanDay(k) {
    planDayKey = k;
    const rec = recovery(), ov = (rec.dayOverrides || {})[k] || {};
    const times = C.planTimes(data, k, Date.now());
    $("#planDayTitle").textContent = t("planDayTitle", { d: k === C.dateKey(Date.now()) ? t("today") : fmtDate(k, { weekday: "short", day: "numeric", month: "short" }) });
    const autoS = ov.start == null, autoB = ov.brk == null;
    $("#planDayStartAuto").checked = autoS;
    $("#planDayBrkAuto").checked = autoB;
    $("#planDayStart").value = toHM(autoS ? times.planStart : ov.start);
    $("#planDayBrk").value = hm(autoB ? times.planBrk : ov.brk);
    $("#planDayStart").disabled = autoS;
    $("#planDayBrk").disabled = autoB;
    if (!$("#planDayDialog").open) $("#planDayDialog").showModal();
  }
  function savePlanDay(reset) {
    if (!planDayKey) return;
    const rec = recovery();
    const dayOverrides = Object.assign({}, rec.dayOverrides || {});
    if (reset || ($("#planDayStartAuto").checked && $("#planDayBrkAuto").checked)) delete dayOverrides[planDayKey];
    else {
      const row = {};
      if (!$("#planDayStartAuto").checked) { const v = fromHM($("#planDayStart").value); if (v != null) row.start = v; }
      if (!$("#planDayBrkAuto").checked) { const v = C.parseDur($("#planDayBrk").value); if (v != null && v >= 0) row.brk = v; }
      if (Object.keys(row).length) dayOverrides[planDayKey] = row; else delete dayOverrides[planDayKey];
    }
    setRecovery({ dayOverrides });
    $("#planDayDialog").close();
    toast(t("saved"));
  }
  $("#planDays").addEventListener("click", (e) => { const li = e.target.closest("[data-plan-row]"); if (li) openPlanDay(li.dataset.planRow); });
  $("#planDays").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const li = e.target.closest("[data-plan-row]"); if (!li) return;
    e.preventDefault(); openPlanDay(li.dataset.planRow);
  });
  $("#planDayStartAuto").addEventListener("change", () => { $("#planDayStart").disabled = $("#planDayStartAuto").checked; });
  $("#planDayBrkAuto").addEventListener("change", () => { $("#planDayBrk").disabled = $("#planDayBrkAuto").checked; });
  $("#planDayReset").addEventListener("click", (e) => { e.preventDefault(); savePlanDay(true); });
  $("#planDayForm").addEventListener("submit", (e) => { if (e.submitter && e.submitter.value === "default") { e.preventDefault(); savePlanDay(false); } });

  /* ---------- HR message (balance anchor) ---------- */
  const shortDate = (k) => fmtDate(k, { day: "numeric", month: "short", ...(k.slice(0, 4) !== C.dateKey(Date.now()).slice(0, 4) ? { year: "numeric" } : {}) });
  const lcFirst = (x) => (data.settings.lang === "ar" ? x : x.charAt(0).toLowerCase() + x.slice(1));
  function hrAnchorText() {
    const a = data.settings.hrAnchor;
    return a && C.anchorValid(data.settings) ? t("hrAnchor", { d: shortDate(a.date), v: signed(a.minutes) }) : "";
  }
  let hrParsed = null;
  function hrUpdatePreview() {
    const txt = $("#hrText").value, box = $("#hrPreview");
    hrParsed = txt.trim() ? C.parseHR(txt, Date.now()) : null;
    $("#hrApply").disabled = !hrParsed;
    const cmpBox = $("#hrCompare");
    const hideCmp = () => { cmpBox.hidden = true; $("#hrKeep").hidden = true; };
    if (!txt.trim()) { box.hidden = true; hideCmp(); return; }
    box.hidden = false;
    box.classList.toggle("bad", !hrParsed);
    if (!hrParsed) { box.textContent = t("hrNone"); hideCmp(); return; }
    const p = hrParsed;
    box.innerHTML = "";
    const add = (tag, text, cls) => { const el = document.createElement(tag); el.textContent = text; if (cls) el.className = cls; box.appendChild(el); };
    add("b", t("hrPreview", { d: shortDate(p.date), x: lcFirst(balanceText(p.minutes)) }));
    add("span", t("hrEffect", { d: shortDate(p.date), v: signed(p.minutes), n: shortDate(C.addDays(p.date, 1)) }));
    if (p.count > 1) add("span", t("hrFound", { n: p.count }), "muted small");
    const cmp = C.compareHR(data, p, Date.now());
    if (!cmp) { hideCmp(); return; }
    cmpBox.hidden = false;
    cmpBox.className = "hr-compare " + (cmp.equal ? "ok" : "warn");
    cmpBox.innerHTML = "";
    const line = document.createElement("b");
    line.textContent = t("hrCompare", { d: shortDate(cmp.date), a: signed(cmp.appMinutes), r: signed(cmp.rhMinutes), e: C.fmtDur(cmp.delta, data.settings.lang) });
    cmpBox.appendChild(line);
    const note = document.createElement("span");
    note.textContent = cmp.equal ? t("hrCompareEqual") : t("hrCompareDiff");
    cmpBox.appendChild(note);
    $("#hrKeep").hidden = false;
    renderCompareList($("#hrCompareHist"), false);
  }
  function openHR() {
    $("#hrText").value = ""; $("#hrText").placeholder = t("hrPlaceholder");
    $("#hrClipboard").hidden = !(navigator.clipboard && navigator.clipboard.readText);
    hrUpdatePreview(); $("#hrDialog").showModal(); $("#hrText").focus();
  }
  function applyHR() {
    if (!hrParsed) return;
    const cmp = C.compareHR(data, hrParsed, Date.now());
    data.settings = C.applyHRAnchor(data.settings, hrParsed, Date.now());
    if (cmp) data.settings = C.recordComparison(data.settings, Object.assign({}, cmp, { choice: "rh" }));
    persist(); $("#hrDialog").close(); render(); toast(t("hrApplied"));
  }
  function keepHR() {
    if (!hrParsed) return;
    const cmp = C.compareHR(data, hrParsed, Date.now());
    if (cmp) { data.settings = C.recordComparison(data.settings, Object.assign({}, cmp, { choice: "app" })); persist(); }
    $("#hrDialog").close(); render(); toast(t("hrKept"));
  }
  function renderCompareList(el, inSettings) {
    if (!el) return;
    const list = (data.settings.hrComparisons || []);
    if (!list.length) { el.hidden = true; el.innerHTML = ""; return; }
    el.hidden = false;
    const head = inSettings ? `<li class="meta">${t("hrCompareHistory")}</li>` : "";
    el.innerHTML = head + list.map((c) => `<li>${t("hrCompare", { d: shortDate(c.date), a: signed(c.appMinutes), r: signed(c.rhMinutes), e: C.fmtDur(c.delta, data.settings.lang) })}</li>`).join("");
  }
  document.addEventListener("click", (e) => { if (e.target.closest("[data-hr-open]")) openHR(); });
  $("#hrText").addEventListener("input", hrUpdatePreview);
  $("#hrClipboard").addEventListener("click", async () => { try { $("#hrText").value = await navigator.clipboard.readText(); hrUpdatePreview(); } catch (e) { $("#hrText").focus(); } });
  $("#hrForm").addEventListener("submit", (e) => { if (e.submitter && e.submitter.value === "default") { e.preventDefault(); applyHR(); } });
  $("#hrKeep").addEventListener("click", (e) => { e.preventDefault(); keepHR(); });
  $("#offType").addEventListener("change", () => { $("#offHalf").closest("label").hidden = $("#offType").value === "telework"; });

  /* ---------- navigation & render ---------- */
  let view = "today";
  function show(v) {
    view = v;
    $$(".view").forEach((s) => (s.hidden = s.id !== "view-" + v));
    $$(".tabbar button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === v)));
    if (location.hash !== "#" + v) history.replaceState(null, "", "#" + v);
    render(); window.scrollTo(0, 0);
  }
  function render() {
    if (view === "today") renderToday();
    else if (view === "history") renderHistory();
    else renderSettings();
  }

  /* ---------- events ---------- */
  $("#clockBtn").addEventListener("click", clockToggle);
  $$(".tabbar button").forEach((b) => b.addEventListener("click", () => show(b.dataset.view)));
  $("#editTodayBtn").addEventListener("click", () => openDay(C.dateKey(Date.now())));
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-day]");
    if (el && !e.target.closest("dialog")) openDay(el.dataset.day);
  });
  document.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.matches(".day-row")) { e.preventDefault(); openDay(e.target.dataset.day); } });
  $("#prevMonth").addEventListener("click", () => { histMonth = C.monthStart(C.addDays(histMonth, -1)); renderHistory(); });
  $("#nextMonth").addEventListener("click", () => { histMonth = C.addDays(C.monthEnd(histMonth), 1); renderHistory(); });
  $("#addRow").addEventListener("click", () => {
    const last = $$("#dayRows .r-end").pop();
    $("#dayRows").insertAdjacentHTML("beforeend", rowHtml(last && last.value ? last.value : ""));
    $$("#dayRows .r-start").pop().focus();
  });
  $("#dayRows").addEventListener("click", (e) => { const b = e.target.closest(".r-del"); if (b) b.closest("li").remove(); });
  $("#dayForm").addEventListener("submit", (e) => { if (e.submitter && e.submitter.value === "default") { e.preventDefault(); saveDay(); } });
  $("#settingsForm").addEventListener("submit", saveSettings);
  $("#settingsForm").perDayEnabled.addEventListener("change", (e) => ($("#perDay").hidden = !e.target.checked));
  $("#langSelect").addEventListener("change", (e) => { data.settings.lang = e.target.value; persist(); applyStatic(); render(); });
  $("#exportJson").addEventListener("click", () => download(`pointage-${stamp()}.json`, JSON.stringify(data, null, 2), "application/json"));
  $("#exportCsv").addEventListener("click", () => download(`pointage-${stamp()}.csv`, C.toCSV(data, Date.now()), "text/csv;charset=utf-8"));
  $("#importFile").addEventListener("change", (e) => { if (e.target.files[0]) importFile(e.target.files[0]); e.target.value = ""; });
  $("#resetAll").addEventListener("click", () => { if (confirm(t("confirmReset"))) { localStorage.removeItem(KEY); data = load(); persist(); applyTheme(); applyStatic(); render(); } });
  window.addEventListener("storage", (e) => { if (e.key === KEY) { data = load(); render(); } });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { data = load(); render(); } });

  let lastMinute = -1;
  setInterval(() => {
    if (document.hidden) return;
    const m = new Date().getMinutes();
    if (m !== lastMinute) { lastMinute = m; if (view !== "settings") render(); }
    else if (view === "today") tick();
  }, 1000);


  /* ---------- device-to-device QR / code sync ---------- */
  const Sync = window.PointageSync;
  let sync = { panel: "choice", dir: null, role: null, chunks: [], envelope: "", idx: 0, timer: null, playing: false, stream: null, raf: 0, collector: null, incoming: null, lastText: "" };

  function syncPanel(name) {
    sync.panel = name;
    $$("#syncDialog [data-sync-panel]").forEach((p) => (p.hidden = p.dataset.syncPanel !== name));
  }
  function stopSyncPlay() { if (sync.timer) { clearInterval(sync.timer); sync.timer = null; } sync.playing = false; const b = $("#syncToggle"); if (b) b.textContent = t("syncPlay"); }
  function stopSyncCamera() {
    if (sync.raf) { cancelAnimationFrame(sync.raf); sync.raf = 0; }
    const video = $("#syncVideo");
    if (sync.stream) { sync.stream.getTracks().forEach((tr) => tr.stop()); sync.stream = null; }
    if (video) { video.srcObject = null; video.hidden = true; }
  }
  function stopSync() { stopSyncPlay(); stopSyncCamera(); sync.collector = null; sync.incoming = null; sync.lastText = ""; }

  function renderQR(text, el) {
    el.innerHTML = "";
    if (typeof qrcode !== "function") { el.textContent = "QR?"; return; }
    let qr = null;
    for (let n = 2; n <= 40; n++) {
      try { const q = qrcode(n, "M"); q.addData(text, "Byte"); q.make(); qr = q; break; } catch (e) { qr = null; }
    }
    if (!qr) { el.textContent = "!"; return; }
    el.innerHTML = typeof qr.createSvgTag === "function" ? qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }) : qr.createImgTag(4, 2);
    const svg = el.querySelector("svg");
    if (svg) {
      if (!svg.getAttribute("viewBox")) {
        const w = svg.getAttribute("width") || "280", h = svg.getAttribute("height") || "280";
        svg.setAttribute("viewBox", "0 0 " + parseInt(w, 10) + " " + parseInt(h, 10));
      }
      svg.setAttribute("width", "100%"); svg.setAttribute("height", "100%");
      svg.setAttribute("aria-hidden", "true");
    }
  }
  function drawSyncQR() {
    if (!sync.chunks.length) return;
    const ch = sync.chunks[sync.idx];
    $("#syncQrCount").textContent = t("syncQrCount", { i: String(sync.idx + 1), n: String(sync.chunks.length) });
    renderQR(ch.text, $("#syncQr"));
    const multi = sync.chunks.length > 1;
    $("#syncQrNav").hidden = !multi;
  }
  function playSyncQR() {
    stopSyncPlay();
    if (sync.chunks.length < 2) return;
    sync.playing = true;
    $("#syncToggle").textContent = t("syncPause");
    sync.timer = setInterval(() => {
      sync.idx = (sync.idx + 1) % sync.chunks.length;
      drawSyncQR();
    }, 1100);
  }
  /* Phone-sized / touch device. Overridable via sync.role ("phone" | "pc"). */
  function isPhoneDevice() {
    if (sync.role === "phone") return true;
    if (sync.role === "pc") return false;
    const coarse = matchMedia("(pointer: coarse)").matches;
    const narrow = matchMedia("(max-width: 700px)").matches;
    const touch = (navigator.maxTouchPoints || 0) > 0 || "ontouchstart" in window;
    const ua = /Android|webOS|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    return !!(ua || (coarse && touch) || (narrow && touch));
  }
  function updateFlipRole() {
    const label = isPhoneDevice() ? t("syncIAmPc") : t("syncIAmPhone");
    $$(".sync-flip").forEach((b) => { b.textContent = label; b.hidden = !sync.dir; });
  }
  function enterDirection() {
    const phone = isPhoneDevice();
    const sending = sync.dir === "pc-mobile" ? !phone : phone;
    if (sending) startSend();
    else startRecv();
    updateFlipRole();
  }
  function pickDirection(dir) {
    sync.dir = dir;
    enterDirection();
  }

  function startSend() {
    stopSyncPlay(); stopSyncCamera();
    const enc = Sync.encode(data);
    sync.chunks = enc.chunks;
    sync.envelope = enc.envelope;
    sync.idx = 0;
    const area = $("#syncCode");
    area.value = enc.envelope;
    area.hidden = true;
    const shareMode = sync.dir === "mobile-pc";   // phone → PC: share/copy, no QR (PC has no camera)
    $("#syncQrWrap").hidden = shareMode;
    $("#syncShareHint").hidden = !shareMode;
    $("#syncShare").hidden = !shareMode;
    $("#syncShare").classList.toggle("primary", shareMode);
    $("#syncCopy").classList.toggle("primary", !shareMode);
    syncPanel("send");
    if (shareMode) stopSyncPlay();
    else {
      drawSyncQR();
      const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (enc.chunks.length > 1 && !reduce) playSyncQR();
      else { const b = $("#syncToggle"); if (b) b.textContent = t("syncPlay"); }
    }
    updateFlipRole();
  }

  function ingestSync(text, fromPaste) {
    if (!sync.collector) sync.collector = Sync.collector(C.validate);
    const r = sync.collector.add(text);
    if (!r.ok) {
      if (r.error === "corrupt") toast(t("syncCorrupt"));
      else if (fromPaste || r.error === "checksum" || r.error === "conflict") toast(t("syncInvalid"));
      return r;
    }
    if (r.total) {
      $("#syncProgress").textContent = t("syncProgress", { x: String(r.got), n: String(r.total) });
      const dots = $("#syncDots");
      dots.hidden = r.total <= 1;
      if (r.total > 1) {
        const have = new Set();
        // rebuild from collector status only; paint got as leading dots is misleading for out-of-order,
        // so just show count-filled dots.
        dots.innerHTML = Array.from({ length: r.total }, (_, i) => `<i class="${i < r.got ? "on" : ""}"></i>`).join("");
      }
    }
    if (r.complete) { stopSyncCamera(); showSyncPreview(r.result); }
    return r;
  }
  function showSyncPreview(result) {
    sync.incoming = result;
    const s = Sync.summarize(result.data);
    const box = $("#syncPreview");
    box.innerHTML = "";
    const add = (tag, text, cls) => { const el = document.createElement(tag); el.textContent = text; if (cls) el.className = cls; box.appendChild(el); };
    add("div", t("syncPreviewSessions", { n: String(s.sessions) }) + " · " + t("syncPreviewDays", { n: String(s.days) }), "nums");
    if (s.from && s.to) add("div", s.from === s.to ? shortDate(s.from) : t("syncPreviewRange", { a: shortDate(s.from), b: shortDate(s.to) }));
    else add("div", t("syncPreviewEmpty"), "muted");
    if (s.hr) add("div", t("syncPreviewHr", { d: shortDate(s.hr.date), x: signed(s.hr.minutes) }));
    else add("div", t("syncPreviewHrNone"), "muted");
    syncPanel("preview");
  }

  async function startCamera() {
    const video = $("#syncVideo"), no = $("#syncNoCam");
    no.hidden = true; no.textContent = "";
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      no.hidden = false; no.textContent = t("syncCameraOff");
      return;
    }
    try {
      sync.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      video.srcObject = sync.stream;
      video.hidden = false;
      await video.play();
      loopScan();
    } catch (e) {
      no.hidden = false; no.textContent = t("syncNoCamera");
    }
  }
  function loopScan() {
    const video = $("#syncVideo"), canvas = $("#syncCanvas");
    let detector = null;
    if (typeof BarcodeDetector === "function") {
      try { detector = new BarcodeDetector({ formats: ["qr_code"] }); } catch (e) { detector = null; }
    }
    const tick = async () => {
      if (!sync.stream) return;
      if (video.readyState >= 2) {
        try {
          let text = null;
          if (detector) {
            const codes = await detector.detect(video);
            if (codes && codes[0] && codes[0].rawValue) text = codes[0].rawValue;
          } else if (typeof jsQR === "function") {
            const w = video.videoWidth, h = video.videoHeight;
            if (w && h) {
              const scale = Math.min(1, 640 / Math.max(w, h));
              const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
              canvas.width = cw; canvas.height = ch;
              const ctx = canvas.getContext("2d", { willReadFrequently: true });
              ctx.drawImage(video, 0, 0, cw, ch);
              const img = ctx.getImageData(0, 0, cw, ch);
              const r = jsQR(img.data, cw, ch, { inversionAttempts: "attemptBoth" });
              if (r && r.data) text = r.data;
            }
          }
          if (text && text !== sync.lastText) { sync.lastText = text; ingestSync(text, false); }
        } catch (e) { /* drop a bad frame */ }
      }
      sync.raf = requestAnimationFrame(tick);
    };
    sync.raf = requestAnimationFrame(tick);
  }
  async function startRecv() {
    stopSyncPlay(); stopSyncCamera();
    sync.collector = Sync.collector(C.validate);
    sync.lastText = "";
    const onPc = !isPhoneDevice();
    const allowScan = !onPc && sync.dir === "pc-mobile";  // only the phone scans, and only in PC → Mobile
    const pcPaste = onPc || sync.dir === "mobile-pc";
    $("#syncPaste").value = "";
    $("#syncPaste").placeholder = t(pcPaste ? "syncPastePlaceholderPc" : "syncPastePlaceholder");
    $("#syncPasteHelp").hidden = pcPaste && onPc;
    $("#syncPasteHelp").textContent = t(onPc ? "syncPasteHelpPc" : "syncPasteHelp");
    $("#syncPasteSteps").hidden = !onPc;
    $("#syncScanBlock").hidden = !allowScan;
    $("#syncProgress").textContent = "";
    $("#syncDots").hidden = true;
    $("#syncDots").innerHTML = "";
    $("#syncNoCam").hidden = true;
    $("#syncPasteGo").classList.toggle("primary", !allowScan);
    syncPanel("recv");
    updateFlipRole();
    if (allowScan) await startCamera();
  }
  function applyIncoming(mode) {
    if (!sync.incoming) return;
    const incoming = sync.incoming.data;
    Sync.saveUndo(data);
    data = mode === "merge" ? Sync.merge(data, incoming, C.validate) : incoming;
    persist(); applyTheme(); applyStatic(); render();
    $("#syncDialog").close();
    toast(mode === "merge" ? t("syncAppliedMerge") : t("syncAppliedReplace"));
  }
  function openSync() {
    stopSync();
    sync.dir = null; sync.role = null;
    $("#syncUndo").hidden = !Sync.hasUndo();
    applyStatic();
    syncPanel("choice");
    if (!$("#syncDialog").open) $("#syncDialog").showModal();
  }
  function undoSync() {
    const prev = Sync.loadUndo(C.validate);
    if (!prev) return;
    if (!confirm(t("syncUndoConfirm"))) return;
    data = prev;
    Sync.clearUndo();
    persist(); applyTheme(); applyStatic(); render();
    toast(t("syncUndone"));
  }

  async function copySyncCode() {
    const text = sync.envelope || $("#syncCode").value;
    $("#syncCode").hidden = false;
    $("#syncCode").select();
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(text);
      else document.execCommand("copy");
      toast(t("syncCopied"));
    } catch (e) { $("#syncCode").hidden = false; }
  }
  async function shareSyncCode() {
    const text = sync.envelope || $("#syncCode").value;
    if (typeof navigator.share === "function") {
      try { await navigator.share({ title: "Pointage", text: text }); return; }
      catch (e) { if (e && e.name === "AbortError") return; }
    }
    await copySyncCode();
  }

  document.addEventListener("click", (e) => { if (e.target.closest("[data-sync-open]")) openSync(); });
  $("#syncClose").addEventListener("click", () => $("#syncDialog").close());
  $("#syncDialog").addEventListener("close", () => { stopSync(); sync.dir = null; sync.role = null; });
  $$("[data-sync-back]").forEach((b) => b.addEventListener("click", () => { stopSync(); sync.dir = null; sync.role = null; syncPanel("choice"); }));
  $("#syncPcToMobile").addEventListener("click", () => pickDirection("pc-mobile"));
  $("#syncMobileToPc").addEventListener("click", () => pickDirection("mobile-pc"));
  $$(".sync-flip").forEach((b) => b.addEventListener("click", () => {
    sync.role = isPhoneDevice() ? "pc" : "phone";
    enterDirection();
  }));
  $("#syncPrev").addEventListener("click", () => { if (!sync.chunks.length) return; stopSyncPlay(); sync.idx = (sync.idx + sync.chunks.length - 1) % sync.chunks.length; drawSyncQR(); });
  $("#syncNext").addEventListener("click", () => { if (!sync.chunks.length) return; stopSyncPlay(); sync.idx = (sync.idx + 1) % sync.chunks.length; drawSyncQR(); });
  $("#syncToggle").addEventListener("click", () => { if (sync.playing) stopSyncPlay(); else playSyncQR(); });
  $("#syncCopy").addEventListener("click", () => copySyncCode());
  $("#syncShare").addEventListener("click", () => shareSyncCode());
  $("#syncPasteGo").addEventListener("click", () => {
    const v = $("#syncPaste").value.trim();
    if (!v) return toast(t("syncInvalid"));
    ingestSync(v, true);
  });
  $("#syncPreviewBack").addEventListener("click", () => startRecv());
  $("#syncReplace").addEventListener("click", () => applyIncoming("replace"));
  $("#syncMerge").addEventListener("click", () => applyIncoming("merge"));
  $("#syncUndo").addEventListener("click", undoSync);


  /* ---------- special days (leave / holiday / sick / telework) & French holidays ---------- */
  let offCalMonth = C.monthStart(C.dateKey(Date.now()));
  function setHolidays(patch) {
    data.settings.holidays = Object.assign({}, C.withDefaults(data.settings).holidays, patch);
    persist(); render();
    if ($("#offDialog").open) renderOffDialog();
  }
  ["holEnabled", "holPentecost", "holAlsace"].forEach((id) => {
    $("#" + id).addEventListener("change", () => setHolidays({
      enabled: $("#holEnabled").checked, pentecost: $("#holPentecost").checked, alsace: $("#holAlsace").checked,
    }));
  });
  function renderOffDialog() {
    applyStatic();
    const s = data.settings, today = C.dateKey(Date.now());
    if (!$("#offFrom").value) $("#offFrom").value = today;
    if (!$("#offTo").value) $("#offTo").value = today;
    $("#offRangeHalfWrap").hidden = $("#offFrom").value !== $("#offTo").value || $("#offRangeType").value === "telework";
    $("#offCalTitle").textContent = C.parseKey(offCalMonth).toLocaleDateString(locale(), { month: "long", year: "numeric" });
    const from = offCalMonth, end = C.monthEnd(from);
    const wd0 = C.weekday(from);
    const pad = (wd0 + 6) % 7; // Monday-first: days before the 1st
    // L().days is Sun-first; show Mon–Sun
    const heads = [1, 2, 3, 4, 5, 6, 0].map((i) => `<div class="hd">${L().days[i]}</div>`);
    const body = [];
    for (let i = 0; i < pad; i++) body.push(`<span></span>`);
    for (let k = from; k <= end; k = C.addDays(k, 1)) {
      const off = C.resolveOff(k, s, data.daysOff);
      const cls = [off && off.type === "telework" ? "tw" : "", C.isNonWorkingOff(off) ? "hol" : "", k === today ? "on" : ""].filter(Boolean).join(" ");
      body.push(`<button type="button" data-off-day="${k}" class="${cls}" title="${off ? offLabel(off) : ""}">${+k.slice(8)}</button>`);
    }
    $("#offCal").innerHTML = heads.join("") + body.join("");
    const year = +from.slice(0, 4);
    const hols = (s.holidays && s.holidays.enabled === false) ? [] : C.frenchHolidays(year, s.holidays);
    const skipped = new Set(s.holidaySkipped || []);
    $("#offHolidayList").innerHTML = hols.length ? hols.map((h) => {
      const skip = skipped.has(h.key) && !data.daysOff[h.key];
      return `<li><span><b>${holidayName(h.id)}</b> <span class="meta">${shortDate(h.key)}${skip ? " · " + t("holSkipped") : " · " + t("holAuto")}</span></span>
        <button type="button" class="btn small" data-hol-toggle="${h.key}">${skip ? t("holRestore") : t("holWork")}</button></li>`;
    }).join("") : `<li class="meta">${t("holTitle")}</li>`;
    const userKeys = Object.keys(data.daysOff || {}).sort();
    $("#offUserList").innerHTML = userKeys.length ? userKeys.map((k) => {
      const off = data.daysOff[k];
      return `<li><span><b>${offLabel(off)}</b> <span class="meta">${shortDate(k)}${off.half ? " · " + t("halfDay") : ""}</span></span>
        <button type="button" class="btn small danger" data-off-del="${k}">${t("delete")}</button></li>`;
    }).join("") : `<li class="meta">${t("specialNone")}</li>`;
  }
  function openOffDialog() {
    offCalMonth = C.monthStart(C.dateKey(Date.now()));
    renderOffDialog();
    if (!$("#offDialog").open) $("#offDialog").showModal();
  }
  function addOffRange() {
    const from = $("#offFrom").value, to = $("#offTo").value, type = $("#offRangeType").value;
    if (!from || !to || !type || from > to) return toast(t("specialRangeErr"));
    const r = C.applySpecialRange(data, from, to, { type, half: type !== "telework" && $("#offRangeHalf").checked });
    data.daysOff = r.daysOff; data.settings = r.settings;
    persist(); render(); renderOffDialog(); toast(t("specialAdded"));
  }
  document.addEventListener("click", (e) => { if (e.target.closest("[data-off-open]")) openOffDialog(); });
  $("#offClose").addEventListener("click", () => $("#offDialog").close());
  $("#offRangeAdd").addEventListener("click", addOffRange);
  $("#offFrom").addEventListener("change", () => { if (!$("#offTo").value || $("#offTo").value < $("#offFrom").value) $("#offTo").value = $("#offFrom").value; renderOffDialog(); });
  $("#offTo").addEventListener("change", renderOffDialog);
  $("#offRangeType").addEventListener("change", renderOffDialog);
  $("#offCalPrev").addEventListener("click", () => { offCalMonth = C.monthStart(C.addDays(offCalMonth, -1)); renderOffDialog(); });
  $("#offCalNext").addEventListener("click", () => { offCalMonth = C.addDays(C.monthEnd(offCalMonth), 1); renderOffDialog(); });
  $("#offCal").addEventListener("click", (e) => {
    const b = e.target.closest("[data-off-day]"); if (!b) return;
    const k = b.dataset.offDay;
    if (!$("#offFrom").value || ($("#offFrom").value && $("#offTo").value && $("#offFrom").value !== $("#offTo").value)) {
      $("#offFrom").value = k; $("#offTo").value = k;
    } else if (k < $("#offFrom").value) { $("#offTo").value = $("#offFrom").value; $("#offFrom").value = k; }
    else $("#offTo").value = k;
    renderOffDialog();
  });
  $("#offHolidayList").addEventListener("click", (e) => {
    const b = e.target.closest("[data-hol-toggle]"); if (!b) return;
    const k = b.dataset.holToggle;
    const skipped = new Set(data.settings.holidaySkipped || []);
    if (skipped.has(k)) {
      skipped.delete(k);
      const daysOff = Object.assign({}, data.daysOff); delete daysOff[k];
      data.daysOff = daysOff;
      data.settings = Object.assign({}, data.settings, { holidaySkipped: [...skipped].sort() });
    } else {
      const r = C.setDayOff(data, k, null);
      data.daysOff = r.daysOff; data.settings = r.settings;
    }
    persist(); render(); renderOffDialog();
  });
  $("#offUserList").addEventListener("click", (e) => {
    const b = e.target.closest("[data-off-del]"); if (!b) return;
    const r = C.setDayOff(data, b.dataset.offDel, null);
    data.daysOff = r.daysOff; data.settings = r.settings;
    persist(); render(); renderOffDialog();
  });

  /* ---------- PWA: offline badge, install, service worker ---------- */
  const setOnline = () => ($("#offlineBadge").hidden = navigator.onLine);
  window.addEventListener("online", setOnline); window.addEventListener("offline", setOnline);
  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredPrompt = e; $("#installBtn").hidden = false; });
  $("#installBtn").addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt(); await deferredPrompt.userChoice.catch(() => {}); deferredPrompt = null; $("#installBtn").hidden = true;
  });
  window.addEventListener("appinstalled", () => { $("#installBtn").hidden = true; });
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  $("#iosHint").hidden = !(isIOS && !standalone);

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW registration failed", e));
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
  }

  /* ---------- boot ---------- */
  applyTheme(); applyStatic(); setOnline();
  const shortcut = C.shortcutAction(location.search);
  if (shortcut) history.replaceState(null, "", location.pathname + (location.hash || ""));
  const initial = (location.hash || "").slice(1);
  show(["today", "history", "settings"].includes(initial) ? initial : "today");
  if (!localStorage.getItem(KEY)) persist();
  if (shortcut === "punch") clockToggle();
  if (shortcut === "balance") {
    const s = C.todaySummary(data, Date.now());
    toast(t("shortcutBalance", { x: balanceText(s.balanceBefore) }));
    const card = $("#balanceCard"); if (card) card.scrollIntoView({ block: "center" });
  }

  // Small hook for debugging / automated tests.
  window.Pointage = { get data() { return data; }, reload() { data = load(); render(); }, version: APP_VERSION };
})();
