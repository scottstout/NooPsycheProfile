# NooPsycheProfile

A browser editor for Noo-Psyche K7 Pro lighting profiles. The Noo-Psyche app
can't edit these profiles directly. It can only export them as QR code images to
Photos, and import them from there. This editor reads those QR codes, lets you edit
the 24-hour schedule and channel limits, and makes a new QR code to import.

Open `index.html` in a browser (or serve the folder, e.g. GitHub Pages). It needs
`profile.js` next to it and loads two small QR libraries from public CDNs.

1. **Build** a profile: enter a full-strength target in watts for this
   light (or work it out from tank size and number of lights, at about 1 W per
   gallon), the lights-on time, ramp-up, peak and ramp-down hours (e.g.
   1 h / 6 h / 1 h; ramps of 3 h or more are smoothest, since the light holds
   one point per hour), and a color look. Then pick a strength step: step 6 is the full target, and
   steps 1 to 5 (50% to 90%) are for acclimating a new tank or new corals; move up
   one step every two weeks while the corals look happy. The builder never goes
   above the target.
   Or tap **Make all 6 steps**, then **Save all** to save every image at once
   (the share sheet on phones, a .zip elsewhere).
   **Or load** an exported QR image from Photos or one of the built-in
   Noo-Psyche stock profiles (LPS, mixed, SPS), and tap **Use as shape for the steps**: the six steps then scale that
   profile's own curve (timing, colors, moonlight) to your target instead of the
   builder's.
2. **Inspect and edit**: tap or drag on the curve to read every channel at that
   time. Drag the channel limits, type values into the hourly grid, or shift
   and scale the curve with the bulk buttons.
3. **Export**: every generated image has a label printed above the code: the
   name, estimated peak watts and share of the target, total light hours, main
   (full-strength) hours and date. That way saved images stay easy to tell apart in
   Photos. Steady low light overnight (3% or less) counts as moonlight and is reported separately, and
   schedules that run past midnight are summarized correctly. Press and hold the generated code and choose *Save to Photos*,
   then import it in the Noo-Psyche app.

Watts are estimated from the fixture rating (100 W for the K7 Pro IV), assuming
each channel draws an equal share. To correct the estimate, enter the wattage the
app reports for a loaded profile under *Match the app's watt reading*.

## Re-importing

The QR code only holds the 24 points, so the label printed above it can't be read
back. When you re-import a profile the builder made, the editor recognizes it,
puts its settings back in the builder, and restores its name (using the target
currently entered). Profiles from the app or other tools load as plain
points named "Imported profile".

## QR format

The QR code holds plain ASCII text, encoded in byte mode with error correction H:

```
WWBBGGUUCCRR#HHMMWWBBGGUUCCRR × 24
```

- **Header** (before `#`): one hex byte per channel, giving that channel's maximum
  output as a percentage (`00`–`64`).
- **Schedule** (after `#`): 24 slots, one per hour. Each slot is the hour index,
  the minute the point sits at, and then one hex byte per channel giving its
  intensity as a percentage.
- **Channel order on the K7 Pro**: White, Royal Blue, Green, UV, Cyan, Red.

`profile.js` works out the channel count from the header's length, so a model
with a different number of channels still parses. If a QR code doesn't match this
layout, the editor still shows its raw text so the format can be worked out.

The layout was worked out from BeanAnimal's
[K7 profile generator](https://beananimal.com/tools/noo-psyche-k7-profile-generator/),
which was built for the K7 Pro III.
