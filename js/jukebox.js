/* ===== jukebox — background music from Steve's band =====
 *
 * Streams Magnetic Ear's "587 Miles" from the band's own YouTube channel via
 * the official embed (no audio files are hosted here). The iframe is only
 * created after the visitor asks for sound — browsers block audible autoplay
 * anyway, and the click gesture lets the embed start with sound. The player
 * stays visible in a corner card, per the embed terms, and links through to
 * the band's channel.
 */

(function () {
  'use strict';

  var VIDEO_ID = 'ur9vGGqJVAo'; // Magnetic Ear — "587 Miles" (channel: magneticear)

  var toggle = document.getElementById('soundToggle');
  var box = document.getElementById('jukebox');
  var frame = document.getElementById('jukeboxFrame');
  var close = document.getElementById('jukeboxClose');
  if (!toggle || !box || !frame || !close) return;

  var playing = false;

  function start() {
    var iframe = document.createElement('iframe');
    iframe.width = '320';
    iframe.height = '180';
    iframe.title = 'Magnetic Ear — 587 Miles';
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture';
    iframe.setAttribute('allowfullscreen', '');
    iframe.setAttribute('frameborder', '0');
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.src = 'https://www.youtube-nocookie.com/embed/' + VIDEO_ID +
      '?autoplay=1&loop=1&playlist=' + VIDEO_ID + '&rel=0';
    frame.appendChild(iframe);
    box.hidden = false;
    playing = true;
    toggle.textContent = '♪ SOUND OFF';
  }

  function stop() {
    frame.innerHTML = ''; // removing the iframe stops playback
    box.hidden = true;
    playing = false;
    toggle.textContent = '♪ SOUND ON';
  }

  toggle.addEventListener('click', function () { playing ? stop() : start(); });
  close.addEventListener('click', stop);
})();
