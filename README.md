# NooPsycheProfile

A browser editor for Noo-Psyche K7 Pro lighting profiles. The Noo-Psyche app
can't edit these profiles directly. It can only export them as QR code images to
Photos, and import them from there. This editor reads those QR codes, lets you edit
the 24-hour schedule and channel limits, and makes a new QR code to import.

Open `index.html` in a browser (or serve the folder, e.g. GitHub Pages). It needs
`profile.js` next to it and loads two small QR libraries from public CDNs.

1. **Load**: choose the exported QR image from Photos.
2. **Edit**: drag the channel limits, type values into the hourly grid, or shift
   and scale the curve with the bulk buttons.
3. **Export**: press and hold the generated code and choose *Save to Photos*,
   then import it in the Noo-Psyche app.

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
- **Channel order on the K7 Pro III**: White, Blue, Green, UV, Cyan, Red.

`profile.js` works out the channel count from the header's length, so a model
with a different number of channels still parses. If a QR code doesn't match this
layout, the editor still shows its raw text so the format can be worked out.

The layout was worked out from BeanAnimal's
[K7 profile generator](https://beananimal.com/tools/noo-psyche-k7-profile-generator/),
which was built for the K7 Pro III.
