# Homepage showcase video

`basera-property-showcase.mp4` is the real, locally hosted reel used by the
homepage "AI Property Videos" section (`src/components/public/AIVideoShowcase.tsx`).

- 20 s, 1280×720, H.264/yuv420p, **no audio track** (never autoplays with sound).
- Generated from this repository's own hero image (`public/hero-villa.jpg`)
  with a slow cinematic zoom — no third-party or copyrighted footage.
- `basera-property-showcase-poster.jpg` is the first frame, used as the
  `<video poster>` and the play-button overlay.

## Regenerating

Requires ffmpeg on PATH:

```
node scripts/generate-showcase-video.mjs
```

or manually:

```
ffmpeg -y -loop 1 -i public/hero-villa.jpg -filter_complex \
  "scale=2560:-2,zoompan=z='min(1+0.00045*on,1.18)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=600:s=1280x720:fps=30,format=yuv420p" \
  -t 20 -c:v libx264 -preset slow -crf 27 -profile:v high -movflags +faststart -an \
  public/videos/basera-property-showcase.mp4

ffmpeg -y -i public/videos/basera-property-showcase.mp4 -vf "select=eq(n\,0)" \
  -frames:v 1 -q:v 4 public/videos/basera-property-showcase-poster.jpg
```

## Honesty note

This is a **presentation sample**, clearly labelled "Demo reel" in the UI.
Basera does **not** auto-generate videos: staff upload one MP4 per property
from the dashboard (Add/Edit Property → Media), and buyers watch it on the
property detail page. If this file is removed, the section degrades to an
explicit "Video preview unavailable" state instead of a broken player.
