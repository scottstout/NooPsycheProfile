/*
 * Noo-Psyche K7 profile codec.
 *
 * A profile QR code holds plain ASCII text (byte mode, error correction H):
 *
 *   <header>#<slot><slot>...<slot>
 *
 * header  one byte per channel, hex: the channel's maximum output in percent.
 * slot    one per hour (24 total): HH MM then one byte per channel, all hex.
 *         HH is the hour index (00-17 hex), MM the minute the point sits at,
 *         each channel byte the intensity in percent (00-64 hex).
 *
 * The K7 Pro III uses six channels in the order White, Blue, Green, UV,
 * Cyan, Red, so its header is 12 characters and each slot 16. The channel
 * count is derived from the header so other models parse as well.
 */
(function (root) {
  'use strict';

  var PRO3_CHANNELS = ['White', 'Blue', 'Green', 'UV', 'Cyan', 'Red'];

  function hex2(n) {
    return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0').toUpperCase();
  }

  function clampPct(n) {
    n = Math.round(Number(n));
    if (!isFinite(n)) return 0;
    return Math.max(0, Math.min(100, n));
  }

  function bytes(str) {
    var out = [];
    for (var i = 0; i < str.length; i += 2) out.push(parseInt(str.substr(i, 2), 16));
    return out;
  }

  function channelNames(count) {
    if (count === PRO3_CHANNELS.length) return PRO3_CHANNELS.slice();
    var names = [];
    for (var i = 0; i < count; i++) names.push('Channel ' + (i + 1));
    return names;
  }

  function parse(text) {
    text = String(text).trim();
    var parts = text.split('#');
    if (parts.length !== 2) throw new Error('Expected one "#" separating the channel limits from the schedule.');
    var head = parts[0], body = parts[1];
    if (!/^([0-9A-Fa-f]{2})+$/.test(head)) throw new Error('The channel limits before "#" are not hex bytes.');
    if (!/^[0-9A-Fa-f]+$/.test(body)) throw new Error('The schedule after "#" is not hex.');
    var count = head.length / 2;
    var slotLen = 4 + 2 * count;
    if (body.length % slotLen !== 0) {
      throw new Error('The schedule is ' + body.length + ' characters, which does not divide into ' +
        slotLen + '-character slots for ' + count + ' channels.');
    }
    var slots = [];
    for (var i = 0; i < body.length; i += slotLen) {
      var b = bytes(body.substr(i, slotLen));
      slots.push({ hour: b[0], minute: b[1], values: b.slice(2) });
    }
    return { channels: channelNames(count), limits: bytes(head), slots: slots };
  }

  function serialize(profile) {
    var s = profile.limits.map(function (v) { return hex2(clampPct(v)); }).join('') + '#';
    profile.slots.forEach(function (slot) {
      s += hex2(slot.hour) + hex2(Math.max(0, Math.min(59, Math.round(slot.minute))));
      slot.values.forEach(function (v) { s += hex2(clampPct(v)); });
    });
    return s;
  }

  function blank(channels) {
    channels = channels || PRO3_CHANNELS.slice();
    var slots = [];
    for (var h = 0; h < 24; h++) {
      slots.push({ hour: h, minute: 0, values: channels.map(function () { return 0; }) });
    }
    return { channels: channels, limits: channels.map(function () { return 100; }), slots: slots };
  }

  /*
   * Rough power draw at one slot. Assumes every channel draws an equal share
   * of the fixture's rated watts at 100%; `factor` corrects that once the app's
   * own watt reading for a profile is known.
   */
  function slotWatts(profile, slot, fixtureWatts, factor) {
    var n = profile.channels.length, sum = 0;
    slot.values.forEach(function (v, c) { sum += (v / 100) * (profile.limits[c] / 100); });
    return fixtureWatts * (factor || 1) * sum / n;
  }

  function peak(profile, fixtureWatts, factor) {
    var best = { watts: 0, slot: null };
    profile.slots.forEach(function (s) {
      var w = slotWatts(profile, s, fixtureWatts, factor);
      if (w > best.watts) best = { watts: w, slot: s };
    });
    return best;
  }

  // Relative channel mix at peak, in Pro III channel order: White, Blue, Green, UV, Cyan, Red.
  var LOOKS = {
    blue:     { label: 'Deep blue', mix: [0.25, 1, 0.08, 0.65, 0.60, 0.08] },
    balanced: { label: 'Balanced',  mix: [0.45, 1, 0.15, 0.50, 0.50, 0.15] },
    daylight: { label: 'Daylight',  mix: [0.80, 1, 0.30, 0.40, 0.45, 0.30] }
  };
  var COOL = [false, true, false, true, true, false]; // channels dimmed faster in the evening

  // S-curve: slow start, steady middle, gentle arrival at full strength.
  function ease(t) { return (1 - Math.cos(Math.PI * Math.max(0, Math.min(1, t)))) / 2; }

  /*
   * Lay out a builder profile at scale k (percent for a mix weight of 1).
   *   on, off      whole hours; the light is at 0 at both and lit between them
   *   rampUp       hours to fade in (from 0 at `on` to full), on an S-curve
   *   rampDown     hours to fade out (from full to 0 at `off`)
   *   warmEvening  blues/UV/cyan fade faster than white/red/green after the peak
   */
  // Per-slot, per-channel weight w so that each value is round(k * w).
  function weights(o) {
    var mix = (LOOKS[o.look] || LOOKS.balanced).mix;
    var up = Math.max(1, o.rampUp || o.ramp || 2), down = Math.max(1, o.rampDown || o.ramp || 2);
    var rows = [];
    for (var h = 0; h < 24; h++) {
      var f = 0, evening = false;
      if (h > o.on && h < o.off) {
        if (h - o.on < up) f = ease((h - o.on) / up);
        else if (o.off - h < down) { f = ease((o.off - h) / down); evening = true; }
        else f = 1;
      }
      rows.push(mix.map(function (m, c) { return (evening && o.warmEvening && COOL[c] ? f * f : f) * m; }));
    }
    return rows;
  }

  function render(o, k) {
    var w = weights(o), p = blank();
    p.slots.forEach(function (s, h) {
      s.values = w[h].map(function (x) { return Math.max(0, Math.min(100, Math.round(k * x))); });
    });
    return p;
  }

  // Build a profile whose peak draw is as close to o.peakWatts as possible without going over.
  function build(o) {
    var mix = (LOOKS[o.look] || LOOKS.balanced).mix, n = mix.length;
    var fixture = o.fixtureWatts || 100, factor = o.factor || 1;
    var sumMix = mix.reduce(function (a, b) { return a + b; }, 0);
    var kMax = 100 / Math.max.apply(null, mix);
    var k = Math.min(kMax, o.peakWatts * n * 100 / (fixture * factor * sumMix));
    var best = render(o, k);
    while (k > 0.5 && peak(best, fixture, factor).watts > o.peakWatts) { k *= 0.99; best = render(o, k); }
    for (var i = 0; i < 40 && k < kMax; i++) {
      k = Math.min(kMax, k * 1.01);
      var next = render(o, k);
      if (peak(next, fixture, factor).watts > o.peakWatts) break;
      best = next;
    }
    return best;
  }

  /*
   * If the profile is exactly what build() would make for some settings, return
   * them ({look, on, off, rampUp, rampDown, warmEvening}); otherwise null.
   */
  function recognize(profile) {
    var p = profile, n = PRO3_CHANNELS.length;
    if (p.channels.length !== n || p.slots.length !== 24) return null;
    if (p.limits.some(function (v) { return v !== 100; })) return null;
    for (var i = 0; i < 24; i++) if (p.slots[i].hour !== i || p.slots[i].minute !== 0) return null;
    var lit = p.slots.map(function (s) { return s.values.some(function (v) { return v > 0; }); });
    var first = lit.indexOf(true), last = lit.lastIndexOf(true);
    if (first < 0) return null;
    // The dimmest ramp points can round to 0, so the true on/off may sit up to two hours further out.
    var looks = Object.keys(LOOKS);
    for (var ex = 0; ex <= 4; ex++) for (var eOn = 0; eOn <= Math.min(2, ex); eOn++) {
      var on = first - 1 - eOn, off = last + 1 + (ex - eOn);
      if (on < 0 || off > 24 || ex - eOn > 2) continue;
      for (var up = 1; up <= 6; up++) for (var down = 1; down <= 6; down++) {
        if (off - on - up - down < 1) continue;
        for (var li = 0; li < looks.length; li++) for (var w = 1; w >= 0; w--) {
          var o = { look: looks[li], on: on, off: off, rampUp: up, rampDown: down, warmEvening: !!w };
          if (scaleFits(weights(o), p)) return o;
        }
      }
    }
    return null;
  }

  // Is there one scale k with round(k * w) equal to every value? Intersect the allowed k ranges.
  function scaleFits(wt, p) {
    var lo = 0, hi = Infinity;
    for (var h = 0; h < 24; h++) for (var c = 0; c < wt[h].length; c++) {
      var x = wt[h][c], v = p.slots[h].values[c];
      if (x === 0) { if (v !== 0) return false; continue; }
      lo = Math.max(lo, (v - 0.5) / x);
      if (v < 100) hi = Math.min(hi, (v + 0.5) / x);
      if (lo >= hi) return false;
    }
    return true;
  }

  /*
   * Describe when the light is on, by exact minutes, around the clock.
   * Light at or below 1%, or at or below 3% and under 4% of the profile's peak,
   * or at its lowest level, counts as moonlight; everything brighter is the day, so the fade
   * points of a dim profile stay part of it. A floor above 6% is not moonlight.
   * Returns { allOff } or { start, end, total, mainStart, mainEnd, main, moonlight }
   * with times in minutes after midnight and durations in minutes.
   */
  function schedule(profile) {
    var pts = profile.slots.map(function (s) {
      var eff = s.values.map(function (v, c) { return v * profile.limits[c] / 100; });
      return { t: (s.hour * 60 + s.minute) % 1440, level: Math.max.apply(null, eff), w: slotWatts(profile, s, 1, 1) };
    }).sort(function (a, b) { return a.t - b.t; });
    var n = pts.length, top = 0, topW = 0, floor = Infinity;
    pts.forEach(function (q) { top = Math.max(top, q.level); topW = Math.max(topW, q.w); floor = Math.min(floor, q.level); });
    if (top === 0) return { allOff: true };
    // Moonlight: at or below 3% and under 4% of the peak, or the floor itself.
    var thr = Math.max(floor, Math.min(3, Math.max(1, top * 0.04)));
    var day = pts.map(function (q) { return q.level > thr; });
    function gap(a, b) { return (b - a + 1440) % 1440; }
    // Longest circular run of daytime points.
    var best = { len: 0, at: 0 };
    if (floor > 6 || day.every(function (d) { return !d; })) best = { len: n, at: 0 };
    else {
      for (var i = 0; i < n; i++) {
        if (!day[i] || day[(i - 1 + n) % n]) continue;
        var len = 0; while (len < n && day[(i + len) % n]) len++;
        if (len > best.len) best = { len: len, at: i };
      }
    }
    // A fade keeps falling toward off; moonlight holds steady for hours. Pull fade points into the day:
    // up to two low points that lead straight to dark, or any that are still falling.
    if (best.len < n) {
      var lv = function (i) { return pts[((i % n) + n) % n].level; };
      var grow = function (from, dir) {
        var k = 0; while (k < 3 && lv(from + k * dir) > floor && lv(from + k * dir) <= lv(from + (k - 1) * dir)) k++;
        if (k <= 2 && lv(from + k * dir) <= floor) return k;
        k = 0; while (lv(from + k * dir) > floor && lv(from + k * dir) < lv(from + (k - 1) * dir) && lv(from + (k + 1) * dir) < lv(from + k * dir)) k++;
        return k;
      };
      var ge = grow(best.at + best.len, 1); best.len = Math.min(n, best.len + ge);
      var gs = grow(best.at - 1, -1); gs = Math.min(gs, n - best.len); best.at = (best.at - gs + n) % n; best.len += gs;
    }
    var out = {};
    if (best.len === n) { out.start = 0; out.end = 0; out.total = 1440; }
    else {
      out.start = pts[(best.at - 1 + n) % n].t;
      out.end = pts[(best.at + best.len) % n].t;
      out.total = gap(out.start, out.end) || 1440;
    }
    // Main: the run of points within 2% of the peak draw, inside the day.
    var runIdx = []; for (var j = 0; j < best.len; j++) runIdx.push((best.at + j) % n);
    var night = 0;
    for (var m = 0; m < n; m++) if (runIdx.indexOf(m) < 0) night = Math.max(night, pts[m].level);
    out.moonlight = night;
    var hi = runIdx.filter(function (ix) { return pts[ix].w >= topW * 0.98; });
    out.mainStart = pts[hi[0]].t; out.mainEnd = pts[hi[hi.length - 1]].t;
    out.main = gap(out.mainStart, out.mainEnd);
    return out;
  }

  /*
   * Effective channel levels (percent, after the channel limit) at any minute of
   * the day, assuming the light fades in a straight line between points and wraps
   * around midnight.
   */
  function levelsAt(profile, minute) {
    var pts = profile.slots.map(function (s) {
      return { t: (s.hour * 60 + s.minute) % 1440, v: s.values.map(function (v, c) { return v * profile.limits[c] / 100; }) };
    }).sort(function (a, b) { return a.t - b.t; });
    var n = pts.length, m = ((minute % 1440) + 1440) % 1440;
    if (!n) return [];
    var j = 0; while (j < n && pts[j].t <= m) j++;
    var a = pts[(j - 1 + n) % n], b = pts[j % n];
    var span = (b.t - a.t + 1440) % 1440 || 1440, f = ((m - a.t + 1440) % 1440) / span;
    return a.v.map(function (v, c) { return v + (b.v[c] - v) * f; });
  }

  /*
   * Scale every point of a profile by one factor so its peak draw is as close to
   * peakWatts as possible without going over. Light that was on stays at least 1%,
   * so dim details such as moonlight survive. Channel limits are kept.
   */
  function scaleTo(profile, peakWatts, fixtureWatts, factor) {
    var fixture = fixtureWatts || 100, f = factor || 1;
    var cur = peak(profile, fixture, f).watts, base = parse(serialize(profile));
    if (!(cur > 0)) return base;
    function make(k) {
      var p = parse(serialize(profile));
      p.slots.forEach(function (s) { s.values = s.values.map(function (v) { return v > 0 ? Math.max(1, Math.min(100, Math.round(v * k))) : 0; }); });
      return p;
    }
    var k = peakWatts / cur, best = make(k);
    while (k > 0.001 && peak(best, fixture, f).watts > peakWatts) { k *= 0.99; best = make(k); }
    for (var i = 0; i < 40; i++) {
      var next = make(k * 1.01);
      if (peak(next, fixture, f).watts > peakWatts || serialize(next) === serialize(best) && k > 100) break;
      k *= 1.01; best = next;
    }
    return best;
  }

  var api = {
    PRO3_CHANNELS: PRO3_CHANNELS, parse: parse, serialize: serialize, blank: blank, channelNames: channelNames,
    slotWatts: slotWatts, peak: peak, LOOKS: LOOKS, build: build, render: render,
    recognize: recognize, schedule: schedule, levelsAt: levelsAt, scaleTo: scaleTo
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NooProfile = api;
})(this);
