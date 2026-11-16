/**
 * Interactive progress / seek bar for the bottom player.
 * Uses YouTube IFrame API player bound to #youtube-player.
 * Click or drag to jump to any second of the track.
 */
(function () {
  'use strict';

  function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '0:00';
    const s = Math.floor(seconds);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m + ':' + String(r).padStart(2, '0');
  }

  function getPlayer() {
    try {
      if (window.YT && typeof window.YT.get === 'function') {
        return window.YT.get('youtube-player') || null;
      }
    } catch (_) {}
    return null;
  }

  function getDuration(player) {
    try {
      const d = player.getDuration();
      return d && isFinite(d) && d > 0 ? d : 0;
    } catch (_) {
      return 0;
    }
  }

  function setup() {
    const track = document.querySelector('.progress');
    if (!track || track.dataset.seekReady === '1') return;
    track.dataset.seekReady = '1';
    track.setAttribute('role', 'slider');
    track.setAttribute('aria-label', 'Перемотка треку');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    track.setAttribute('aria-valuenow', '0');
    track.tabIndex = 0;

    // Visual thumb
    let thumb = track.querySelector('.progress-thumb');
    if (!thumb) {
      thumb = document.createElement('span');
      thumb.className = 'progress-thumb';
      thumb.setAttribute('aria-hidden', 'true');
      track.appendChild(thumb);
    }

    const fill = document.getElementById('progress-fill');
    const currentEl = document.getElementById('current-time');
    const durationEl = document.getElementById('duration');

    let dragging = false;

    function ratioFromEvent(e) {
      const rect = track.getBoundingClientRect();
      const clientX = e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX;
      if (!rect.width) return 0;
      return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    }

    function applyVisual(ratio) {
      const pct = (ratio * 100).toFixed(2) + '%';
      if (fill) fill.style.width = pct;
      if (thumb) thumb.style.left = pct;
      track.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
    }

    function seekToRatio(ratio) {
      const player = getPlayer();
      if (!player) return;
      const duration = getDuration(player);
      if (!duration) return;
      const time = duration * ratio;
      try {
        player.seekTo(time, true);
      } catch (_) {
        return;
      }
      applyVisual(ratio);
      if (currentEl) currentEl.textContent = formatTime(time);
      if (durationEl && durationEl.textContent === '0:00') {
        durationEl.textContent = formatTime(duration);
      }
    }

    function onPointerDown(e) {
      // Only primary button / touch
      if (e.type === 'mousedown' && e.button !== 0) return;
      const player = getPlayer();
      if (!player || !getDuration(player)) return;
      dragging = true;
      track.classList.add('is-seeking');
      try {
        track.setPointerCapture?.(e.pointerId);
      } catch (_) {}
      seekToRatio(ratioFromEvent(e));
      e.preventDefault();
    }

    function onPointerMove(e) {
      if (!dragging) return;
      seekToRatio(ratioFromEvent(e));
      e.preventDefault();
    }

    function onPointerUp(e) {
      if (!dragging) return;
      dragging = false;
      track.classList.remove('is-seeking');
      seekToRatio(ratioFromEvent(e));
    }

    // Pointer events (mouse + touch + pen)
    track.addEventListener('pointerdown', onPointerDown);
    track.addEventListener('pointermove', onPointerMove);
    track.addEventListener('pointerup', onPointerUp);
    track.addEventListener('pointercancel', onPointerUp);
    track.addEventListener('lostpointercapture', () => {
      dragging = false;
      track.classList.remove('is-seeking');
    });

    // Keyboard: arrows seek ±5s, Home/End
    track.addEventListener('keydown', (e) => {
      const player = getPlayer();
      if (!player) return;
      const duration = getDuration(player);
      if (!duration) return;
      let current = 0;
      try {
        current = player.getCurrentTime() || 0;
      } catch (_) {
        return;
      }
      let next = current;
      if (e.key === 'ArrowRight') next = Math.min(duration, current + 5);
      else if (e.key === 'ArrowLeft') next = Math.max(0, current - 5);
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = duration;
      else return;
      e.preventDefault();
      try {
        player.seekTo(next, true);
      } catch (_) {}
      applyVisual(next / duration);
      if (currentEl) currentEl.textContent = formatTime(next);
    });

    // Keep thumb in sync while playing (when not dragging)
    setInterval(() => {
      if (dragging) return;
      const player = getPlayer();
      if (!player) return;
      const duration = getDuration(player);
      if (!duration) return;
      let current = 0;
      try {
        current = player.getCurrentTime() || 0;
      } catch (_) {
        return;
      }
      applyVisual(Math.min(1, current / duration));
    }, 400);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
  // Re-run after app may re-render player bar
  setTimeout(setup, 1500);
  setTimeout(setup, 4000);
})();
