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

  var api = { PRO3_CHANNELS: PRO3_CHANNELS, parse: parse, serialize: serialize, blank: blank, channelNames: channelNames };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NooProfile = api;
})(this);
