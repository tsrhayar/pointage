/* Pointage prayer times: offline Habous (Morocco) calculation, no API.
   Reconstructs the Ministry of Habous and Islamic Affairs timetable:
     • Meeus apparent sun (full nutation, ch. 28 equation of time), iterated
       at each prayer's own moment;
     • Fajr 19°, Isha 17°, true altitudes; Asr Shafi'i on the apparent sun
       (noon shadow from the refracted noon altitude + 1 length; Sæmundsson
       refraction at noon, Bennett at Asr);
     • Dhuhr 5 minutes after transit;
     • Sunrise 1 minute before, and Maghrib 1.8 minutes after, the sun on
       altitude −(34′ + semi-diameter) − city dip (east at sunrise, west at
       Maghrib);
     • Fajr rounded down to the minute, every other time to the nearest;
     • Printed on the ministry clock (GMT+1 until 17 Sep 2026, then GMT).
   For the Marrakech preset the calculation uses the ministry method point
   (31.6283, −8.0332) and fitted horizon dips (0.828° east, 0.808° west).
   That calculation matches the official Habous table to 0 minutes on every
   published day we have (1 Oct – 30 Nov 2026, 61 days). The embedded
   official table is still used as an override when the date is covered.
   Custom coordinates use the same method with height-0 default dips.
   Works in the browser (window.PointagePrayer) and in Node (require). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PointagePrayer = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const PRAYER_KEYS = ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"];
  const SALAH_KEYS = ["fajr", "dhuhr", "asr", "maghrib", "isha"];
  const NAME_KEYS = {
    fajr: "prayerFajr", sunrise: "prayerSunrise", dhuhr: "prayerDhuhr",
    asr: "prayerAsr", maghrib: "prayerMaghrib", isha: "prayerIsha",
  };
  /* User-facing default (kept so saved settings stay on the preset). */
  const MARRAKECH = { lat: 31.6295, lng: -7.9811 };
  /* Fitted method point + horizon allowances for official Marrakech times. */
  const METHOD_POINT = { lat: 31.6283, lng: -8.0332, dipEast: 0.828, dipWest: 0.808 };
  const DEFAULT_PRAYER = { showMobile: true, showDesktop: true, lat: MARRAKECH.lat, lng: MARRAKECH.lng };
  const FAJR_ANGLE = 19;
  const ISHA_ANGLE = 17;
  const ASR_FACTOR = 1;
  const SUNRISE_MARGIN = -1.0;
  const MAGHRIB_MARGIN = 1.8;
  const DHUHR_AFTER_TRANSIT = 5;
  const RAD = Math.PI / 180;
  const DAY_MS = 86400000;
  const GRACE_MS = 30 * 60 * 1000;
  const MOBILE_UA = /Mobi|Android|iPhone|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i;
  const MOBILE_MAX_WIDTH = 768;
  /* Ministry printed GMT from 17 September 2026 (clocks legally moved on the 20th). */
  const CLOCK_GMT_FROM = "2026-09-17";

  function loadTable() {
    if (typeof PointagePrayerTable !== "undefined") return PointagePrayerTable;
    if (typeof require === "function") {
      try { return require("./prayer-marrakech.js"); } catch (e) { /* no table file */ }
    }
    return null;
  }
  const OFFICIAL = loadTable();

  const pad = (n) => String(n).padStart(2, "0");

  function meeusApparentSun(d) {
    const T = d / 36525;
    const L0 = (((280.46646 + T * (36000.76983 + 0.0003032 * T)) % 360) + 360) % 360;
    const M = (357.52911 + T * (35999.05029 - 0.0001537 * T)) * RAD;
    const C =
      (1.914602 - T * (0.004817 + 0.000014 * T)) * Math.sin(M) +
      (0.019993 - 0.000101 * T) * Math.sin(2 * M) +
      0.000289 * Math.sin(3 * M);
    const om = (125.04 - 1934.136 * T) * RAD;
    const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
    const Lm = (280.4665 + 36000.7698 * T) * RAD;
    const Lmoon = (218.3165 + 481267.8813 * T) * RAD;
    const dpsi = (-17.2 * Math.sin(om) - 1.32 * Math.sin(2 * Lm) - 0.23 * Math.sin(2 * Lmoon) + 0.21 * Math.sin(2 * om)) / 3600;
    const deps = (9.2 * Math.cos(om) + 0.57 * Math.cos(2 * Lm) + 0.1 * Math.cos(2 * Lmoon) - 0.09 * Math.cos(2 * om)) / 3600;
    const lambda = (L0 + C - 0.00569 + dpsi) * RAD;
    const eps = (eps0 + deps) * RAD;
    const ra = (((Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)) / RAD) % 360) + 360) % 360;
    const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
    const E = L0 - 0.0057183 - ra + dpsi * Math.cos(eps);
    const eot = ((((E + 180) % 360) + 360) % 360 - 180) * 4;
    return { dec, eot };
  }

  /* Sæmundsson (Meeus 16.4) from a true altitude; Bennett (Meeus 16.3) from an apparent one. */
  const refractionFromTrue = (h) => (1.02 / Math.tan((h + 10.3 / (h + 5.11)) * RAD)) / 60;
  const refractionFromApparent = (h) => (1 / Math.tan((h + 7.31 / (h + 4.4)) * RAD)) / 60;
  const dipEastFromHeight = (heightM) => 0.32 + 0.025 * Math.sqrt(Math.max(heightM, 0));
  const dipWestFromHeight = (heightM) => 0.37 + 0.021 * Math.sqrt(Math.max(heightM, 0));

  /* Raw minutes past 00:00 UT of the civil date, margins applied, before rounding.
     Fajr is shifted −0.5 min so nearest-minute rounding equals rounding down. */
  function habousRawMinutes(latitude, longitude, year, month, day, dipEast, dipWest) {
    const d0 = (Date.UTC(year, month - 1, day) - Date.UTC(2000, 0, 1)) / DAY_MS - 0.5;
    const at = (t) => meeusApparentSun(d0 + t / 1440);
    let noon = 720 - 4 * longitude;
    for (let i = 0; i < 3; i++) noon = 720 - 4 * longitude - at(noon).eot;
    const sp = Math.sin(latitude * RAD);
    const cp = Math.cos(latitude * RAD);
    const T = (d0 + noon / 1440) / 36525;
    const Ma = (357.52911 + 35999.05029 * T) * RAD;
    const horizon = -(34 / 60 + 0.26667 / (1.00014 - 0.016708 * Math.cos(Ma) - 0.00014 * Math.cos(2 * Ma)));
    const event = (alt, sign, start) => {
      let t = start;
      for (let i = 0; i < 3; i++) {
        const { dec, eot } = at(t);
        const c = (Math.sin(alt * RAD) - sp * Math.sin(dec)) / (cp * Math.cos(dec));
        if (!(Math.abs(c) <= 1)) return NaN;
        t = 720 - 4 * longitude - eot + (sign * 4 * Math.acos(c)) / RAD;
      }
      return t;
    };
    const noonDec = at(noon).dec;
    const noonTrue = 90 - Math.abs(latitude - noonDec / RAD);
    const noonApparent = noonTrue + refractionFromTrue(noonTrue);
    const asrApparent = Math.atan(1 / (ASR_FACTOR + 1 / Math.tan(noonApparent * RAD))) / RAD;
    const asrTrue = asrApparent - refractionFromApparent(asrApparent);
    return {
      fajr: event(-FAJR_ANGLE, -1, noon - 420) - 0.5,
      sunrise: event(horizon - dipEast, -1, noon - 360) + SUNRISE_MARGIN,
      dhuhr: noon + DHUHR_AFTER_TRANSIT,
      asr: event(asrTrue, 1, noon + 200),
      maghrib: event(horizon - dipWest, 1, noon + 360) + MAGHRIB_MARGIN,
      isha: event(-ISHA_ANGLE, 1, noon + 420),
    };
  }

  /* Ministry table clock: GMT+1 until 17 Sep 2026, GMT from that date on. */
  function ministryOffsetMinutes(year, month, day) {
    return (year + "-" + pad(month) + "-" + pad(day)) < CLOCK_GMT_FROM ? 60 : 0;
  }

  function printedFromUt(utRounded, offsetMin) {
    const m = (((utRounded + offsetMin) % 1440) + 1440) % 1440;
    return pad(Math.floor(m / 60)) + ":" + pad(m % 60);
  }

  function hhmmToMinutes(hhmm) {
    const [h, m] = String(hhmm).split(":").map(Number);
    return h * 60 + m;
  }

  function localOffsetHours(year, month, day) {
    return -new Date(year, month - 1, day, 12, 0, 0).getTimezoneOffset() / 60;
  }

  function ymdOf(date) {
    if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const [y, m, d] = date.split("-").map(Number);
      return { year: y, month: m, day: d, key: date };
    }
    const d = date instanceof Date ? date : new Date(date);
    return {
      year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(),
      key: d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()),
    };
  }

  function shiftKey(key, n) {
    const [y, m, d] = key.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + n));
    return ymdOf(dt.getUTCFullYear() + "-" + pad(dt.getUTCMonth() + 1) + "-" + pad(dt.getUTCDate()));
  }

  function clampCoord(v, min, max, fallback) {
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  }

  function resolveCoords(opts) {
    opts = opts || {};
    const lat = clampCoord(opts.lat, -90, 90, MARRAKECH.lat);
    const lng = clampCoord(opts.lng, -180, 180, MARRAKECH.lng);
    const isDefault = lat === MARRAKECH.lat && lng === MARRAKECH.lng;
    return { lat, lng, isDefault };
  }

  function tableRow(key) {
    const times = OFFICIAL && OFFICIAL.times;
    return times && times[key] ? times[key] : null;
  }

  function packTimes(year, month, day, key, lat, lng, isDefault, rawOrPrinted, source) {
    const off = ministryOffsetMinutes(year, month, day);
    const tz = off / 60;
    const times = {};
    const timesMs = {};
    if (source === "official") {
      PRAYER_KEYS.forEach((k, i) => {
        const printed = rawOrPrinted[i];
        const utRounded = hhmmToMinutes(printed) - off;
        times[k] = printed;
        timesMs[k] = Date.UTC(year, month - 1, day) + utRounded * 60 * 1000;
      });
      return { dateKey: key, lat, lng, isDefault, tz, times, timesMs, approx: false, source: "official" };
    }
    for (const k of PRAYER_KEYS) {
      const rounded = Math.floor(rawOrPrinted[k] + 0.5);
      times[k] = printedFromUt(rounded, off);
      timesMs[k] = Date.UTC(year, month - 1, day) + rounded * 60 * 1000;
    }
    return { dateKey: key, lat, lng, isDefault, tz, times, timesMs, approx: false, source: source };
  }

  /* Compute today's six times for a civil date. For the Marrakech preset,
     official Habous times are used when the date is in the table.
     Pass opts.forceCalc to skip the table (fallback / tests). */
  function timesForDate(date, opts) {
    opts = opts || {};
    const { year, month, day, key } = ymdOf(date);
    const { lat, lng, isDefault } = resolveCoords(opts);
    if (isDefault && !opts.forceCalc) {
      const row = tableRow(key);
      if (row && row.length === PRAYER_KEYS.length) {
        return packTimes(year, month, day, key, lat, lng, isDefault, row, "official");
      }
    }
    const point = isDefault ? METHOD_POINT : {
      lat: lat, lng: lng,
      dipEast: dipEastFromHeight(0),
      dipWest: dipWestFromHeight(0),
    };
    const raw = habousRawMinutes(point.lat, point.lng, year, month, day, point.dipEast, point.dipWest);
    return packTimes(year, month, day, key, lat, lng, isDefault, raw, isDefault ? "habous" : "habous-custom");
  }

  function fmtSpan(ms) {
    const sign = ms < 0 ? "-" : "";
    ms = Math.abs(ms);
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return sign + h + ":" + pad(m);
    return sign + m + ":" + pad(s);
  }

  function eventsAround(now, opts) {
    const today = timesForDate(now, opts);
    const yest = timesForDate(shiftKey(today.dateKey, -1).key, opts);
    const tom = timesForDate(shiftKey(today.dateKey, 1).key, opts);
    const list = [];
    for (const day of [yest, today, tom]) {
      for (const k of PRAYER_KEYS) {
        list.push({ key: k, at: day.timesMs[k], dateKey: day.dateKey, isSalah: SALAH_KEYS.indexOf(k) !== -1, hhmm: day.times[k] });
      }
    }
    return { today, yest, tom, list };
  }

  /* After a salah starts, show a count-up for GRACE_MS (30 min); then count down to the next time. */
  function statusAt(now, opts) {
    now = typeof now === "number" || now instanceof Date ? +now : Date.now();
    const { today, list } = eventsAround(now, opts);
    let last = null, next = null;
    for (const ev of list) {
      if (ev.at <= now) last = ev;
      else if (!next) next = ev;
    }
    if (last && last.isSalah && now - last.at < GRACE_MS) {
      const elapsedMs = now - last.at;
      return {
        dateKey: today.dateKey,
        times: today.times,
        timesMs: today.timesMs,
        mode: "since",
        prayer: last.key,
        nameKey: NAME_KEYS[last.key],
        elapsedMs,
        remainingMs: 0,
        clock: fmtSpan(elapsedMs),
        approx: !!today.approx,
        source: today.source,
        coords: { lat: today.lat, lng: today.lng, isDefault: today.isDefault },
      };
    }
    if (!next) next = list[list.length - 1];
    const remainingMs = Math.max(0, next.at - now);
    return {
      dateKey: today.dateKey,
      times: today.times,
      timesMs: today.timesMs,
      mode: "countdown",
      prayer: next.key,
      nameKey: NAME_KEYS[next.key],
      elapsedMs: 0,
      remainingMs,
      clock: fmtSpan(remainingMs),
      approx: !!today.approx,
      source: today.source,
      coords: { lat: today.lat, lng: today.lng, isDefault: today.isDefault },
    };
  }

  function normalizePrayerSettings(raw) {
    raw = raw || {};
    const p = Object.assign({}, DEFAULT_PRAYER, raw);
    if (Object.prototype.hasOwnProperty.call(raw, "show")
        && !Object.prototype.hasOwnProperty.call(raw, "showMobile")
        && !Object.prototype.hasOwnProperty.call(raw, "showDesktop")) {
      p.showMobile = p.showDesktop = !!raw.show;
    }
    delete p.show;
    return p;
  }

  function isMobileDevice(env) {
    env = env || {};
    if (env.ua == null && env.width == null && env.coarse == null && typeof navigator !== "undefined") {
      env = {
        ua: navigator.userAgent || "",
        width: typeof innerWidth === "number" ? innerWidth : undefined,
        coarse: typeof matchMedia === "function" ? matchMedia("(pointer: coarse)").matches : false,
      };
    }
    if (env.ua && MOBILE_UA.test(env.ua)) return true;
    if (env.coarse) return true;
    if (env.width != null && env.width < MOBILE_MAX_WIDTH) return true;
    return false;
  }

  function prayerVisible(prayer, env) {
    const p = normalizePrayerSettings(prayer);
    return isMobileDevice(env) ? p.showMobile !== false : p.showDesktop !== false;
  }

  return {
    PRAYER_KEYS, SALAH_KEYS, NAME_KEYS, MARRAKECH, METHOD_POINT, DEFAULT_PRAYER, OFFICIAL,
    FAJR_ANGLE, ISHA_ANGLE, ASR_FACTOR, SUNRISE_MARGIN, MAGHRIB_MARGIN, DHUHR_AFTER_TRANSIT,
    GRACE_MS, MOBILE_MAX_WIDTH, CLOCK_GMT_FROM,
    resolveCoords, timesForDate, statusAt, fmtSpan, localOffsetHours, ministryOffsetMinutes,
    normalizePrayerSettings, isMobileDevice, prayerVisible, tableRow,
  };
});
