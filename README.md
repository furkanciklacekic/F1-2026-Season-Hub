# F1 2026 Season Hub

A personal tracker for the 2026 Formula 1 season: official race highlights for completed rounds, the remaining calendar, and constructors' and drivers' standings.

Site: https://furkanciklacekic.github.io/F1-2026-Season-Hub/

## How it updates

`.github/workflows/update.yml` runs `scripts/update.mjs` every 3 hours:

- Schedule, results and standings come from the [Jolpica F1 API](https://github.com/jolpica/jolpica-f1).
- Highlights are looked up in the official [FORMULA 1 YouTube](https://www.youtube.com/@Formula1) channel's RSS feed by their "Race Highlights | 2026 …" title.
- If `data.js` changed, it is committed and the site is redeployed.

## If a video is not found automatically

The RSS feed only contains the latest 15 videos. If a highlights video is missed, go to
**Actions → Update data and deploy → Run workflow** and enter the round number and video ID.
The script only adds the video after confirming it is from the official channel and matches that race.

## Running locally

```bash
node scripts/update.mjs
python -m http.server 8000
```
