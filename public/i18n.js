/**
 * Luna i18n — default language: Russian (ru)
 * Options: Ukrainian (uk), French (fr)
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'luna-lang';
  var DEFAULT_LANG = 'ru';

  var STRINGS = {
    ru: {
      title: 'Луна — твоя музыкальная библиотека',
      menu: 'МЕНЮ',
      home: 'Главная',
      library: 'Библиотека',
      favorites: 'Избранное',
      recent: 'Недавние',
      playlists: 'ПЛЕЙЛИСТЫ',
      createPlaylist: 'Создать плейлист',
      musicLibrary: 'Музыкальная библиотека',
      yourAccount: 'Твой аккаунт',
      myMusic: 'Моя музыка',
      connection: 'Подключение',
      tryAgain: 'Попробовать ещё',
      yourMusic: 'ТВОЯ МУЗЫКА',
      heroTitle: 'Найди свой',
      heroTitleEm: 'ритм.',
      heroCopy: 'Собирай плейлисты с YouTube и слушай в Telegram.',
      listenNow: 'Слушать сейчас',
      addTrack: 'Добавить трек',
      addTrackHint: 'Ссылка на YouTube',
      importPlaylist: 'Импорт плейлиста',
      importHint: 'С YouTube по ссылке',
      newPlaylist: 'Новый плейлист',
      newPlaylistHint: 'Пустая подборка',
      latest: 'Последние',
      all: 'Все',
      history: 'ИСТОРИЯ',
      recentTracks: 'Недавние треки',
      collection: 'КОЛЛЕКЦИЯ',
      libraryTitle: 'Библиотека',
      libraryCopy: 'Все твои плейлисты.',
      create: 'Создать',
      searchPlaylist: 'Поиск плейлиста',
      sortRecent: 'Недавние',
      sortName: 'По названию',
      sortCount: 'По количеству',
      chosen: 'ИЗБРАННОЕ',
      favoritesTitle: 'Избранное',
      favoritesCopy: 'Треки, которые ты отметил ♡',
      recentTitle: 'Недавние',
      recentCopy: 'То, что ты слушал в последнее время.',
      backToLibrary: '← К библиотеке',
      back: '← Назад',
      nowPlaying: 'СЕЙЧАС ИГРАЕТ',
      player: 'Плеер',
      playerCopy: 'Видео только для просмотра. Управляй воспроизведением нижним плеером.',
      pickTrack: 'Выбери композицию',
      openFullPlayer: 'Открыть полный плеер',
      shuffle: 'Перемешать',
      previous: 'Предыдущий',
      play: 'Воспроизвести',
      next: 'Следующий',
      repeatOff: 'Повтор: выкл.',
      volume: 'Звук',
      addToFav: 'В избранное',
      addToPlaylist: 'Добавить в плейлист',
      openYoutube: 'Открыть в YouTube ↗',
      openYoutubeMusic: 'Открыть в YouTube Music ↗',
      premiumHint: 'Чтобы слушать в фоне (с заблокированным экраном) — открой трек в YouTube или YouTube Music. В мини-приложении фон не поддерживается.',
      queue: 'Очередь',
      pickATrack: 'Выбери трек',
      pressPlay: 'Нажми ▶ рядом с композицией',
      addToFavorites: 'Добавить в избранное',
      seek: 'Перемотка трека',
      close: 'Закрыть',
      forMuhammad: '(специально для Мухаммада)',
      langLabel: 'Язык'
    },
    uk: {
      title: 'Луна — твоя музична бібліотека',
      menu: 'МЕНЮ',
      home: 'Головна',
      library: 'Бібліотека',
      favorites: 'Улюблене',
      recent: 'Нещодавні',
      playlists: 'ПЛЕЙЛИСТИ',
      createPlaylist: 'Створити плейлист',
      musicLibrary: 'Музична бібліотека',
      yourAccount: 'Твій акаунт',
      myMusic: 'Моя музика',
      connection: 'Підключення',
      tryAgain: 'Спробувати ще',
      yourMusic: 'ТВОЯ МУЗИКА',
      heroTitle: 'Знайди свій',
      heroTitleEm: 'ритм.',
      heroCopy: 'Збирай плейлисти з YouTube і слухай у Telegram.',
      listenNow: 'Слухати зараз',
      addTrack: 'Додати трек',
      addTrackHint: 'Посилання на YouTube',
      importPlaylist: 'Імпорт плейлиста',
      importHint: 'З YouTube за посиланням',
      newPlaylist: 'Новий плейлист',
      newPlaylistHint: 'Порожня добірка',
      latest: 'Останні',
      all: 'Усі',
      history: 'ІСТОРІЯ',
      recentTracks: 'Нещодавні треки',
      collection: 'КОЛЕКЦІЯ',
      libraryTitle: 'Бібліотека',
      libraryCopy: 'Усі твої плейлисти.',
      create: 'Створити',
      searchPlaylist: 'Пошук плейлиста',
      sortRecent: 'Нещодавні',
      sortName: 'За назвою',
      sortCount: 'За кількістю',
      chosen: 'ОБРАНЕ',
      favoritesTitle: 'Улюблене',
      favoritesCopy: 'Треки, які ти позначив ♡',
      recentTitle: 'Нещодавні',
      recentCopy: 'Те, що ти слухав останнім часом.',
      backToLibrary: '← До бібліотеки',
      back: '← Назад',
      nowPlaying: 'ЗАРАЗ ГРАЄ',
      player: 'Плеєр',
      playerCopy: 'Відео лише для перегляду. Керуй відтворенням нижнім плеєром.',
      pickTrack: 'Обери композицію',
      openFullPlayer: 'Відкрити повний плеєр',
      shuffle: 'Перемішати',
      previous: 'Попередній',
      play: 'Відтворити',
      next: 'Наступний',
      repeatOff: 'Повтор: вимкнено',
      volume: 'Звук',
      addToFav: 'У обране',
      addToPlaylist: 'Додати в плейлист',
      openYoutube: 'Відкрити в YouTube ↗',
      openYoutubeMusic: 'Відкрити в YouTube Music ↗',
      premiumHint: 'Щоб слухати у фоні (з заблокованим екраном) — відкрий трек у YouTube або YouTube Music. У міні-додатку фон не підтримується.',
      queue: 'Черга',
      pickATrack: 'Обери трек',
      pressPlay: 'Натисни ▶ біля композиції',
      addToFavorites: 'Додати в улюблене',
      seek: 'Перемотка треку',
      close: 'Закрити',
      forMuhammad: '(спеціально для Мухаммада)',
      langLabel: 'Мова'
    },
    fr: {
      title: 'Luna — ta bibliothèque musicale',
      menu: 'MENU',
      home: 'Accueil',
      library: 'Bibliothèque',
      favorites: 'Favoris',
      recent: 'Récents',
      playlists: 'PLAYLISTS',
      createPlaylist: 'Créer une playlist',
      musicLibrary: 'Bibliothèque musicale',
      yourAccount: 'Ton compte',
      myMusic: 'Ma musique',
      connection: 'Connexion',
      tryAgain: 'Réessayer',
      yourMusic: 'TA MUSIQUE',
      heroTitle: 'Trouve ton',
      heroTitleEm: 'rythme.',
      heroCopy: 'Crée des playlists YouTube et écoute dans Telegram.',
      listenNow: 'Écouter maintenant',
      addTrack: 'Ajouter un titre',
      addTrackHint: 'Lien YouTube',
      importPlaylist: 'Importer une playlist',
      importHint: 'Depuis YouTube',
      newPlaylist: 'Nouvelle playlist',
      newPlaylistHint: 'Collection vide',
      latest: 'Récentes',
      all: 'Toutes',
      history: 'HISTORIQUE',
      recentTracks: 'Titres récents',
      collection: 'COLLECTION',
      libraryTitle: 'Bibliothèque',
      libraryCopy: 'Toutes tes playlists.',
      create: 'Créer',
      searchPlaylist: 'Rechercher une playlist',
      sortRecent: 'Récentes',
      sortName: 'Par nom',
      sortCount: 'Par nombre',
      chosen: 'FAVORIS',
      favoritesTitle: 'Favoris',
      favoritesCopy: 'Titres que tu as marqués ♡',
      recentTitle: 'Récents',
      recentCopy: 'Ce que tu as écouté récemment.',
      backToLibrary: '← Bibliothèque',
      back: '← Retour',
      nowPlaying: 'EN COURS',
      player: 'Lecteur',
      playerCopy: 'Vidéo en lecture seule. Contrôle via le lecteur du bas.',
      pickTrack: 'Choisis un titre',
      openFullPlayer: 'Ouvrir le lecteur complet',
      shuffle: 'Aléatoire',
      previous: 'Précédent',
      play: 'Lecture',
      next: 'Suivant',
      repeatOff: 'Répétition : off',
      volume: 'Volume',
      addToFav: 'Favoris',
      addToPlaylist: 'Ajouter à la playlist',
      openYoutube: 'Ouvrir dans YouTube ↗',
      openYoutubeMusic: 'Ouvrir dans YouTube Music ↗',
      premiumHint: 'Pour écouter en arrière-plan (écran verrouillé), ouvre le titre dans YouTube ou YouTube Music. Non pris en charge dans la mini-app.',
      queue: 'File',
      pickATrack: 'Choisis un titre',
      pressPlay: 'Appuie sur ▶ près du titre',
      addToFavorites: 'Ajouter aux favoris',
      seek: 'Position dans le titre',
      close: 'Fermer',
      forMuhammad: '(spécialement pour Muhammad)',
      langLabel: 'Langue'
    }
  };

  function getLang() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved && STRINGS[saved]) return saved;
    } catch (_) {}
    return DEFAULT_LANG;
  }

  function setLang(lang) {
    if (!STRINGS[lang]) lang = DEFAULT_LANG;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch (_) {}
    apply(lang);
  }

  function t(key, lang) {
    lang = lang || getLang();
    var pack = STRINGS[lang] || STRINGS[DEFAULT_LANG];
    return pack[key] != null ? pack[key] : (STRINGS[DEFAULT_LANG][key] || key);
  }

  function apply(lang) {
    lang = lang || getLang();
    if (!STRINGS[lang]) lang = DEFAULT_LANG;
    document.documentElement.lang = lang === 'uk' ? 'uk' : lang === 'fr' ? 'fr' : 'ru';

    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      var val = t(key, lang);
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        el.placeholder = val;
      } else if (el.hasAttribute('data-i18n-html')) {
        el.innerHTML = val;
      } else {
        el.textContent = val;
      }
    });

    document.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
      el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria'), lang));
    });

    document.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      el.setAttribute('title', t(el.getAttribute('data-i18n-title'), lang));
    });

    // Title
    document.title = t('title', lang);

    // Language switcher active state
    document.querySelectorAll('[data-set-lang]').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-set-lang') === lang);
    });

    // Crumb default if still on home text
    var crumb = document.getElementById('crumb');
    if (crumb && !crumb.dataset.locked) {
      crumb.textContent = t('home', lang);
    }

    window.dispatchEvent(new CustomEvent('luna:lang', { detail: { lang: lang } }));
  }

  function wireSwitcher() {
    document.querySelectorAll('[data-set-lang]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setLang(btn.getAttribute('data-set-lang'));
      });
    });
  }

  window.LunaI18n = {
    t: t,
    getLang: getLang,
    setLang: setLang,
    apply: apply,
    STRINGS: STRINGS
  };

  function boot() {
    wireSwitcher();
    apply(getLang());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
