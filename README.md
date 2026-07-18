# TURN UP THE BASS.

A living landing page for **Tuba Steve** — a New Orleans sousaphone player who
watches your cursor from a neon-lit bar behind the page.

Open `index.html` from any static server (e.g. `python3 -m http.server`) and
move your mouse. He follows it: left, right, a dead-on stare at screen center,
and a full glance down at the floor when your cursor drops low. Leave the mouse
still for three seconds and he calmly looks around on his own.

## How it works

- Two 5-second locked-off cinema takes of the same scene (a level head-turn
  pass and a head-bowed down pass) sit in a fixed full-screen stage. They are
  **never played** — cursor X is mapped through a measured calibration curve
  onto the clip timeline and the videos are scrubbed frame by frame, with
  weighted easing (~9% per frame) for natural momentum.
- Cursor Y is a hysteresis switch, not a mix: below 75% of the viewport the
  stage dissolves to the down take in ~250 ms; it only returns once the cursor
  rises above the middle. Outside a dissolve the blend is always exactly 0 or 1.
- Both takes are re-encoded **all-intra** (every frame a keyframe) in H.264 and
  VP9, chosen at runtime with `canPlayType`, and loaded as fetched blobs so
  seeking never depends on range requests.
- Phones and reduced-motion visitors get the level take as a gentle autoplay
  loop instead.

Vanilla HTML/CSS/JS — no frameworks. The scene itself was generated with
Higgsfield (Nano Banana Pro for the 4K stills, Seedance 2.0 for the two motion
passes) from Steve's real reference photos.

`.github/workflows/fetch-media.yml` is a small utility that relays remote media
into the repo via `workflow_dispatch` (used during production because the build
sandbox could not reach the generation CDN directly).
