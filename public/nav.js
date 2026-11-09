/** Bottom + side navigation — works even if app.js fails to load */
(function () {
  'use strict';

  function showView(name) {
    if (!name) return;
    document.querySelectorAll('.view').forEach(function (v) {
      v.classList.toggle('active', v.id === 'view-' + name);
    });
    document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-view') === name);
    });
    document.body.classList.toggle('is-player-view', name === 'player');
    var crumb = document.getElementById('crumb');
    if (crumb) {
      var labels = {
        home: 'Home',
        library: 'Library',
        favorites: 'Favorites',
        recent: 'Recent',
        playlist: 'Playlist',
        player: 'Player'
      };
      try {
        if (window.LunaI18n && typeof window.LunaI18n.t === 'function') {
          labels.home = window.LunaI18n.t('home');
          labels.library = window.LunaI18n.t('library');
          labels.favorites = window.LunaI18n.t('favorites');
          labels.recent = window.LunaI18n.t('recent');
          labels.player = window.LunaI18n.t('player');
        }
      } catch (_) {}
      crumb.textContent = labels[name] || name;
    }
    window.scrollTo(0, 0);
  }

  function onTap(e) {
    var el = e.target.closest('[data-view]');
    if (!el) return;
    var name = el.getAttribute('data-view');
    if (!name) return;
    e.preventDefault();
    e.stopPropagation();
    showView(name);
  }

  document.addEventListener('click', onTap, true);
  document.addEventListener('pointerup', function (e) {
    if (e.pointerType === 'touch' || e.pointerType === 'pen') onTap(e);
  }, true);

  window.LunaNav = { showView: showView };
})();
