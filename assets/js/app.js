/* Pointage app: UI + local storage. All data stays in this browser (localStorage key "pointage.v1"). */
(function () {
  "use strict";
  const C = window.PointageCore, I18N = window.I18N;
  const APP_VERSION = "1.1.0";
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

  function applyStatic() {
    const lang = data.settings.lang;
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    $$("[data-i18n]").forEach((el) => { const v = t(el.dataset.i18n); if (typeof v === "string") el.textContent = v; });
    $("#langSelect").value = lang;
    const off = $("#offType");
    off.innerHTML = `<option value="">${t("none")}</option>` + Object.entries(L().offTypes).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
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
    if (navigator.vibrate) navigator.vibrate(30);
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
    const offKeys = Object.keys(data.daysOff).filter((k) => k >= from && k <= end);
    const lastData = [today, ...offKeys].filter((k) => k <= end).sort().pop();
    const to = lastData < from ? null : (lastData > end ? end : lastData);
    $("#monthTitle").textContent = C.parseKey(from).toLocaleDateString(locale(), { month: "long", year: "numeric" });
    $("#nextMonth").disabled = C.monthStart(today) <= from && !Object.keys(data.daysOff).some((k) => k > end);
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
        const offB = d.off ? `<span class="badge off">${L_.offTypes[d.off.type] || t("dayOff")}${d.off.half ? " ½" : ""}</span> ` : "";
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
    if (type) data.daysOff[k] = { type, half: $("#offHalf").checked }; else delete data.daysOff[k];
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
  const recovery = () => Object.assign({ mode: "month", includeToday: true, days: [] }, data.settings.recovery || {});
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
        const k = C.addDays(from, i), off = data.daysOff[k];
        const past = k < today || (k === today && (!rec.includeToday || C.todayFinished(data, now)));
        const dis = past || (off && !off.half);
        cells.push(`<label class="chip" title="${fmtDate(k)}"><input type="checkbox" data-plan-day="${k}" ${sel.has(k) && !dis ? "checked" : ""} ${dis ? "disabled" : ""}><span>${L_.days[C.weekday(k)]}<b>${C.parseKey(k).getDate()}</b></span></label>`);
      }
      $("#planPicker").innerHTML = cells.join("");
    }
    const p = s.plan, ul = $("#planDays");
    if (rec.mode === "off" || !p) { $("#planSummary").textContent = ""; ul.innerHTML = ""; $("#planHint").textContent = ""; return; }
    if (!p.days.length) { $("#planSummary").textContent = ""; ul.innerHTML = `<li><span class="meta">${t("planNoDays")}</span></li>`; $("#planHint").textContent = ""; return; }
    $("#planSummary").textContent = p.perDay === p.perDayMin ? t("planPerDay", { x: dur(p.perDay), n: p.days.length })
      : t("planPerDayRange", { a: dur(p.perDayMin), b: dur(p.perDay), n: p.days.length });
    ul.innerHTML = p.days.map((d) => {
      const leave = d.key === today && s.running && s.leaveAt ? s.leaveAt : d.leaveAt;
      const label = d.key === today ? t("today") : fmtDate(d.key, { weekday: "short", day: "numeric", month: "short" });
      return `<li class="${d.key === today ? "is-today" : ""}"><span>${label}</span><span class="x">+${dur(d.extra)}</span>
        <span class="meta">${t("planTarget", { x: dur(d.target) })} · ${t("planLeave", { t: C.hhmm(leave) })}</span></li>`;
    }).join("");
    $("#planHint").textContent = t("planHint", { s: C.fmtClock(p.habits.start), b: dur(p.habits.brk) });
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
    if (!txt.trim()) { box.hidden = true; return; }
    box.hidden = false;
    box.classList.toggle("bad", !hrParsed);
    if (!hrParsed) { box.textContent = t("hrNone"); return; }
    const p = hrParsed;
    box.innerHTML = "";
    const add = (tag, text, cls) => { const el = document.createElement(tag); el.textContent = text; if (cls) el.className = cls; box.appendChild(el); };
    add("b", t("hrPreview", { d: shortDate(p.date), x: lcFirst(balanceText(p.minutes)) }));
    add("span", t("hrEffect", { d: shortDate(p.date), v: signed(p.minutes), n: shortDate(C.addDays(p.date, 1)) }));
    if (p.count > 1) add("span", t("hrFound", { n: p.count }), "muted small");
  }
  function openHR() {
    $("#hrText").value = ""; $("#hrText").placeholder = t("hrPlaceholder");
    $("#hrClipboard").hidden = !(navigator.clipboard && navigator.clipboard.readText);
    hrUpdatePreview(); $("#hrDialog").showModal(); $("#hrText").focus();
  }
  function applyHR() {
    if (!hrParsed) return;
    data.settings = C.applyHRAnchor(data.settings, hrParsed, Date.now());
    persist(); $("#hrDialog").close(); render(); toast(t("hrApplied"));
  }
  document.addEventListener("click", (e) => { if (e.target.closest("[data-hr-open]")) openHR(); });
  $("#hrText").addEventListener("input", hrUpdatePreview);
  $("#hrClipboard").addEventListener("click", async () => { try { $("#hrText").value = await navigator.clipboard.readText(); hrUpdatePreview(); } catch (e) { $("#hrText").focus(); } });
  $("#hrForm").addEventListener("submit", (e) => { if (e.submitter && e.submitter.value === "default") { e.preventDefault(); applyHR(); } });

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
  const initial = (location.hash || "").slice(1);
  show(["today", "history", "settings"].includes(initial) ? initial : "today");
  if (!localStorage.getItem(KEY)) persist();

  // Small hook for debugging / automated tests.
  window.Pointage = { get data() { return data; }, reload() { data = load(); render(); }, version: APP_VERSION };
})();
