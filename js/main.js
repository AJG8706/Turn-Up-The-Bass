/* ===== TURN UP THE BASS — living portrait engine =====
 *
 * Two locked-off takes of the same scene live in a fixed stage and are
 * never played — they are scrubbed. Cursor X maps through a calibration
 * curve onto the clip timeline (head turns are not linear in time, so the
 * curve pins screen-center to the exact straight-into-camera frame and the
 * screen edges just inside the useful ends of each take). Cursor Y is a
 * pose switch: below the lower threshold we dissolve to the down take,
 * and only dissolve back once the cursor rises above the middle.
 */

(function () {
  'use strict';

  // ---- calibration (measured from extracted frames of the real encodes) ----
  // curve: [screenX 0..1, clipTime seconds] anchors, piecewise-linear.
  // The head turn is not linear in time: both takes hold the opening gaze
  // until ~1.0s, so that dwell is compressed into the outer 15% of cursor
  // travel. Screen-center is pinned to the measured straight-into-camera
  // frame (level t=2.0s; the down take faces the floor in front of the
  // camera at t=2.2s), and the edges sit just inside the clip ends.
  // Clips are motion-interpolated from the 24fps masters to 60fps all-intra,
  // so the scrub can land on 16.7ms steps instead of 42ms ones.
  // Pages with their own takes (e.g. /wide/) override via window.TUBA_CAL.
  var CAL = window.TUBA_CAL || {
    fps: 60,
    level: { curve: [[0, 0.08], [0.15, 0.70], [0.5, 1.60], [1, 4.92]] },
    down:  { curve: [[0, 0.08], [0.15, 0.80], [0.5, 2.20], [1, 4.92]] }
  };

  var EASE_PER_FRAME = 0.09;      // fraction of remaining distance per 60Hz frame
  var lastTick = 0;               // for frame-rate-independent easing
  var DISSOLVE_MS = 250;          // pose crossfade duration
  var DOWN_ENTER = 0.75;          // cursor below 75% of viewport -> down pose
  var DOWN_EXIT = 0.50;           // must rise above 50% to come back up
  var IDLE_AFTER_MS = 3000;       // stillness before he looks around himself

  var stage = document.getElementById('stage');
  var vids = {
    level: document.getElementById('vidLevel'),
    down: document.getElementById('vidDown')
  };

  // ---- fallback: phones & reduced-motion get a gentle looping clip ----
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var coarsePointer = window.matchMedia('(pointer: coarse)').matches &&
                      !window.matchMedia('(any-pointer: fine)').matches;
  var fallbackMode = reducedMotion || coarsePointer;

  // ---- format pick: some Chromium builds ship without H.264 ----
  function pickFormat() {
    var probe = document.createElement('video');
    var h264 = probe.canPlayType('video/mp4; codecs="avc1.640828"') ||
               probe.canPlayType('video/mp4; codecs="avc1.42E01E"');
    if (h264 === 'probably' || h264 === 'maybe') return 'mp4';
    var vp9 = probe.canPlayType('video/webm; codecs="vp09.00.41.08"') ||
              probe.canPlayType('video/webm; codecs="vp9"');
    if (vp9 === 'probably' || vp9 === 'maybe') return 'webm';
    return 'mp4';
  }

  // ---- load clips as blobs so seeking never depends on range requests ----
  // Retries with a cache-busting query so one truncated CDN response (e.g.
  // a fetch that raced a redeploy) can't permanently kill the stage.
  function loadBlob(url, video, tries) {
    tries = tries === undefined ? 2 : tries;
    var u = tries < 2 ? url + '?r=' + Date.now() : url;
    return fetch(u, tries < 2 ? { cache: 'reload' } : undefined)
      .then(function (r) {
        if (!r.ok) throw new Error('fetch failed: ' + u + ' ' + r.status);
        return r.blob();
      })
      .then(function (blob) {
        return new Promise(function (resolve, reject) {
          video.src = URL.createObjectURL(blob);
          video.muted = true;
          video.onloadedmetadata = function () { resolve(video); };
          video.onerror = function () { reject(new Error('decode failed: ' + u)); };
        });
      })
      .catch(function (err) {
        if (tries > 0) return loadBlob(url, video, tries - 1);
        throw err;
      });
  }

  // ---- calibration curve: piecewise-linear x -> t ----
  function curveTime(curve, x) {
    if (x <= curve[0][0]) return curve[0][1];
    for (var i = 1; i < curve.length; i++) {
      if (x <= curve[i][0]) {
        var a = curve[i - 1], b = curve[i];
        var f = (x - a[0]) / (b[0] - a[0]);
        return a[1] + f * (b[1] - a[1]);
      }
    }
    return curve[curve.length - 1][1];
  }

  // ---- engine state ----
  var state = {
    mode: 'boot',            // boot | tracking | idle | fallback
    pose: 'level',           // level | down  (the *committed* pose)
    blend: 0,                // 0 = level fully visible, 1 = down fully visible
    dissolving: false,
    dissolveFrom: 0,
    dissolveStart: 0,
    cursorX: 0.5,
    cursorY: 0.5,
    lastMove: performance.now(),
    idleStart: 0,
    idleGlanceDown: false,
    times: { level: 0, down: 0 },   // eased playhead per clip
    lastHiddenSync: 0,
    ready: false,
    downReady: false                // down pose loads in the background
  };

  // exposed for automated verification
  window.__tuba = state;
  window.__tubaVids = vids;
  window.__tubaCal = CAL;

  function frameDur() { return 1 / (CAL.fps || 24); }

  function applyBlend(b) {
    state.blend = b;
    vids.down.style.opacity = String(b);
    vids.level.style.opacity = String(1 - b);
    vids.down.classList.toggle('is-hidden', b === 0);
    vids.level.classList.toggle('is-hidden', b === 1);
  }

  function requestPose(pose) {
    if (pose === state.pose || state.dissolving) return;
    state.pose = pose;
    state.dissolving = true;
    state.dissolveFrom = state.blend;
    state.dissolveStart = performance.now();
  }

  function seekIfNeeded(which, t) {
    var v = vids[which];
    if (!v.duration) return;
    if (v.seeking) return; // let the in-flight seek land; avoids cancel storms
    var clamped = Math.min(Math.max(t, 0.02), v.duration - 0.06);
    if (Math.abs(v.currentTime - clamped) > frameDur()) {
      try { v.currentTime = clamped; } catch (e) { /* not seekable yet */ }
    }
  }

  // ---- idle wander: slow sines + occasional clean full glance down ----
  function idleTargetX(tMs) {
    var t = tMs / 1000;
    var x = 0.5 + 0.42 * Math.sin(t * 0.45) * Math.cos(t * 0.17 + 1.3);
    return Math.min(1, Math.max(0, x));
  }

  function tick(now) {
    if (!state.ready) { requestAnimationFrame(tick); return; }

    // 9% per 60Hz frame, scaled so a throttled rAF still eases in real time
    var dt = lastTick ? Math.min(now - lastTick, 250) : 16.7;
    lastTick = now;
    var ease = 1 - Math.pow(1 - EASE_PER_FRAME, dt / 16.7);

    var targetX, wantPose;

    if (state.mode === 'idle') {
      var it = now - state.idleStart;
      targetX = idleTargetX(it);
      // every ~8s of idling: a clean glance down for ~2.2s, then back up
      var phase = it % 8000;
      state.idleGlanceDown = phase > 5000 && phase < 7200;
      wantPose = state.idleGlanceDown ? 'down' : 'level';
    } else {
      targetX = state.cursorX;
      var yn = state.cursorY;
      if (state.pose === 'level' && yn > DOWN_ENTER) wantPose = 'down';
      else if (state.pose === 'down' && yn < DOWN_EXIT) wantPose = 'level';
      else wantPose = state.pose;
    }

    if (!state.downReady) wantPose = 'level'; // down take still downloading
    if (wantPose !== state.pose) requestPose(wantPose);

    // ease both playheads toward their curve targets. The visible layer is
    // seeked every frame; the hidden layer only needs to be roughly in place
    // before a dissolve, so it syncs at ~10Hz — during a dissolve both run at
    // full rate so the incoming pose is already correct before it shows.
    var hiddenDue = now - state.lastHiddenSync > 100;
    ['level', 'down'].forEach(function (which) {
      var tt = curveTime(CAL[which].curve, targetX);
      var cur = state.times[which];
      var next = cur + (tt - cur) * ease;
      state.times[which] = next;
      var visible = (which === 'down') ? state.blend > 0 : state.blend < 1;
      if (visible || state.dissolving) {
        seekIfNeeded(which, next);
      } else if (hiddenDue) {
        seekIfNeeded(which, next);
        state.lastHiddenSync = now;
      }
    });

    // dissolve progression — snap to exactly 0 or 1 at the ends
    if (state.dissolving) {
      var f = Math.min(1, (now - state.dissolveStart) / DISSOLVE_MS);
      var toDown = state.pose === 'down';
      var target = toDown ? 1 : 0;
      var b = state.dissolveFrom + (target - state.dissolveFrom) * f;
      if (f >= 1) {
        applyBlend(target);   // exact 0 or 1 — poses never rest half-blended
        state.dissolving = false;
      } else {
        applyBlend(b);
      }
    }

    // idle entry
    if (state.mode === 'tracking' && now - state.lastMove > IDLE_AFTER_MS) {
      state.mode = 'idle';
      state.idleStart = now;
    }

    requestAnimationFrame(tick);
  }

  function onMove(e) {
    state.cursorX = Math.min(1, Math.max(0, e.clientX / window.innerWidth));
    state.cursorY = Math.min(1, Math.max(0, e.clientY / window.innerHeight));
    state.lastMove = performance.now();
    if (state.mode === 'idle') state.mode = 'tracking'; // snap back to tracking
  }

  // ---- boot ----
  // Progressive: the poster background is already showing the scene. The
  // level take goes live the moment it arrives; the down take streams in
  // behind it and simply unlocks the look-down pose when ready. A total
  // failure leaves the poster visible — the stage is never black.
  function boot() {
    var fmt = pickFormat();
    var base = 'assets/';
    var hint = document.getElementById('loadHint');

    loadBlob(base + 'level.' + fmt, vids.level).then(function () {
      if (hint) hint.remove();
      if (fallbackMode) {
        state.mode = 'fallback';
        vids.down.style.display = 'none';
        vids.level.loop = true;
        vids.level.autoplay = true;
        applyBlend(0);
        var p = vids.level.play();
        if (p && p.catch) p.catch(function () { /* tap-to-play policies */ });
        state.ready = true;
        return;
      }
      vids.level.pause();
      state.times.level = curveTime(CAL.level.curve, 0.5);
      state.times.down = curveTime(CAL.down.curve, 0.5);
      seekIfNeeded('level', state.times.level);
      applyBlend(0);
      state.mode = 'tracking';
      state.lastMove = performance.now();
      state.ready = true;
      window.addEventListener('mousemove', onMove, { passive: true });
      requestAnimationFrame(tick);
    }).catch(function (err) {
      // poster stays up; the page degrades to a beautiful still
      if (hint) hint.textContent = 'STILL FRAME MODE';
      console.warn('stage boot fell back to poster:', err.message);
      state.mode = 'error';
    });

    if (!fallbackMode) {
      loadBlob(base + 'down.' + fmt, vids.down).then(function () {
        vids.down.pause();
        seekIfNeeded('down', curveTime(CAL.down.curve, 0.5));
        state.downReady = true;
      }).catch(function (err) {
        console.warn('down take unavailable, level-only mode:', err.message);
      });
    }
  }

  boot();
})();
