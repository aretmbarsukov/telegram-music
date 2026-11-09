/* Playlist fix — API items[].track mapping */
import { buildQueue, firstPlayableIndex, nextPlayableIndex, previousPlayableIndex, shuffleUpcoming } from './player-queue.js';
import { playerErrorDetails } from './player-errors.js';
import { togglePlayerAudio } from './player-volume.js';

const telegram = window.Telegram?.WebApp;
const localApi = location.protocol !== 'file:' && ['localhost','127.0.0.1'].includes(location.hostname);
const apiContext = Boolean(telegram?.initData || localApi);
let state = { playlists: [], tracks: {}, favorites: [], recent: [], queue: [] };
let currentId = null, currentPlaylist = null, repeatMode = 'off', shuffle = false;
let ytPlayer = null, apiReady = false, toastTimer, apiMode = apiContext, apiHealth = null;
let bootstrapPromise = Promise.resolve(), queueIndex = -1, unavailableIds = new Set();
let playbackMessage = '', loadedVideoId = null, playerApiTimer = null;

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
if (telegram) { telegram.ready(); telegram.expand(); }

function setConnection(message = '', kind = '') {
  const banner = $('#connection-banner'), badge = $('#connection-badge');
  if (banner) {
    banner.hidden = !message;
    banner.className = `connection-banner ${kind}`;
    const span = banner.querySelector('span');
    if (span) span.textContent = message;
  }
  if (badge) {
    badge.classList.toggle('is-online', kind === 'connected');
    const label = kind === 'connected'
      ? (apiHealth?.youtubeMockEnabled ? 'API · demo' : 'API подключено')
      : (apiContext ? 'Подключение…' : 'Локальный режим');
    badge.innerHTML = `<i></i> ${label}`;
  }
}

async function apiRequest(path, options = {}) {
  if (apiContext && !apiHealth) await bootstrapPromise;
  if (apiContext && !apiHealth) throw new Error('Сессия API не авторизована');
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (telegram?.initData) headers.Authorization = `tma ${telegram.initData}`;
  else if (localApi && apiHealth?.devAuthEnabled) headers['x-dev-user-id'] = apiHealth.devAuthUserId;
  let response;
  try {
    response = await fetch(path, { ...options, headers });
  } catch {
    setConnection('Не удалось соединиться с API.', 'error');
    throw new Error('Сервер недоступен');
  }
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 || response.status >= 500)
      setConnection(data?.error || `API ${response.status}`, 'error');
    throw new Error(data?.error || `API ${response.status}`);
  }
  return data;
}

function esc(s = '') {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

async function loadApiLibrary() {
  if (!apiContext) {
    setConnection('local', 'local');
    return;
  }
  setConnection('...', 'loading');
  try {
    const healthResponse = await fetch('/api/health');
    if (!healthResponse.ok) throw new Error(`API (${healthResponse.status})`);
    apiHealth = await healthResponse.json();
    if (!telegram?.initData && localApi && !apiHealth.devAuthEnabled)
      throw new Error('dev auth off');
    if (!telegram?.initData && !localApi)
      throw new Error('Open via Telegram Mini App');
    const me = await apiRequest('/api/me');
    const rows = await apiRequest('/api/playlists');
    state.playlists = rows.map(p => ({
      id: p.id, name: p.name, artwork: p.artworkUrl || null,
      created: new Date(p.createdAt).getTime(), updated: new Date(p.updatedAt).getTime(),
      trackCount: p.trackCount || 0, trackIds: [],
      sourceId: p.youtube?.youtubeId || null, lastSync: p.youtube?.lastSuccessAt || null,
      syncStatus: p.youtube?.status || null, metadataStatus: p.youtube?.metadataStatus || null
    }));
    const history = await apiRequest('/api/history');
    state.recent = history.map(row => {
      state.tracks[row.videoId] = {
        id: row.videoId, title: row.title, channel: row.channel || 'YouTube',
        thumbnail: row.thumbnail || '', duration: row.duration || '',
        availability: row.availability, metadataStatus: row.metadataStatus
      };
      return row.videoId;
    });
    const favorites = await apiRequest('/api/favorites');
    state.favorites = favorites.map(row => {
      state.tracks[row.videoId] = {
        id: row.videoId, title: row.title, channel: row.channel || 'YouTube',
        thumbnail: row.thumbnail || '', duration: row.duration || '',
        availability: row.availability, metadataStatus: row.metadataStatus
      };
      return row.videoId;
    });
    const account = $('.sidebar-bottom div');
    if (account) {
      account.innerHTML = `<b>${esc(me.firstName || 'Luna')}</b><small>${esc(me.username ? '@' + me.username : String(me.telegramId || ''))}</small>`;
    }
    setConnection('', 'connected');
    render();
  } catch (e) {
    setConnection(String(e.message || e), 'error');
  }
}

bootstrapPromise = loadApiLibrary();

function notify(msg) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function empty(text) {
  return `<div class="empty"><p class="empty-text">${esc(text)}</p></div>`;
}

function renderSidebar() {
  const el = $('#side-playlists');
  if (!el) return;
  el.innerHTML = state.playlists.map(p =>
    `<button class="side-playlist" data-playlist="${esc(p.id)}"><span class="side-dot">♫</span>${esc(p.name)}</button>`
  ).join('') || '<small style="color:#777;padding:8px">-</small>';
}

function renderHome() {
  const hp = $('#home-playlists'), ht = $('#home-tracks');
  if (hp) {
    hp.innerHTML = state.playlists.slice(0, 4).map(p =>
      `<article class="playlist-card" data-playlist="${esc(p.id)}"><div class="cover"><span class="cover-symbol">♫</span><span class="cover-title">${esc(p.name)}</span></div><div class="card-meta"><b>${esc(p.name)}</b><span>${p.trackCount || 0}</span></div></article>`
    ).join('') || empty('Пока пусто');
  }
  if (ht) {
    ht.innerHTML = state.recent.slice(0, 5).map((id, i) => {
      const t = state.tracks[id]; if (!t) return '';
      return `<div class="track-row"><span class="track-order">${String(i + 1).padStart(2, '0')}</span><div class="track-cover">♫</div><div class="track-info"><b>${esc(t.title)}</b><small>${esc(t.channel || 'YouTube')}</small></div><button type="button" class="row-play" data-track="${esc(id)}">▶</button></div>`;
    }).join('') || empty('История пуста');
  }
}

function renderLibrary() {
  const el = $('#library-playlists');
  if (!el) return;
  el.innerHTML = state.playlists.map(p =>
    `<article class="playlist-card" data-playlist="${esc(p.id)}"><div class="cover"><span class="cover-symbol">♫</span><span class="cover-title">${esc(p.name)}</span></div><div class="card-meta"><b>${esc(p.name)}</b><span>${p.trackCount || 0}</span></div></article>`
  ).join('') || empty('Библиотека пуста');
}

function renderFavs() {
  const el = $('#favorite-tracks');
  if (!el) return;
  el.innerHTML = state.favorites.map((id, i) => {
    const t = state.tracks[id]; if (!t) return '';
    return `<div class="track-row"><span class="track-order">${String(i + 1).padStart(2, '0')}</span><div class="track-cover">♫</div><div class="track-info"><b>${esc(t.title)}</b><small>${esc(t.channel || '')}</small></div><button type="button" class="row-play" data-track="${esc(id)}" data-track-context='${esc(JSON.stringify(state.favorites))}'>▶</button></div>`;
  }).join('') || empty('Избранное пусто');
}

function renderRecent() {
  const el = $('#recent-tracks');
  if (!el) return;
  el.innerHTML = state.recent.map((id, i) => {
    const t = state.tracks[id]; if (!t) return '';
    return `<div class="track-row"><span class="track-order">${String(i + 1).padStart(2, '0')}</span><div class="track-cover">♫</div><div class="track-info"><b>${esc(t.title)}</b><small>${esc(t.channel || '')}</small></div><button type="button" class="row-play" data-track="${esc(id)}" data-track-context='${esc(JSON.stringify(state.recent))}'>▶</button></div>`;
  }).join('') || empty('История пуста');
}

function renderPlayer() {
  const t = state.tracks[currentId];
  const meta = $('#now-playing .now-meta');
  if (meta) {
    if (t) meta.innerHTML = `<b>${esc(t.title)}</b><small>${esc(t.channel || 'YouTube')}</small>`;
    else meta.innerHTML = `<b>Выбери трек</b><small>▶</small>`;
  }
  const title = $('#player-track-title');
  if (title) title.textContent = t ? t.title : 'Выбери композицию';
  const ch = $('#player-track-channel');
  if (ch) ch.textContent = t ? (t.channel || 'YouTube') : 'YouTube';
  updatePlayerHost();
}

function render() {
  renderSidebar(); renderHome(); renderLibrary(); renderFavs(); renderRecent(); renderPlayer();
}

function showView(name) {
  $$('.view').forEach(v => v.classList.remove('active'));
  const view = $('#view-' + name);
  if (view) view.classList.add('active');
  $$('.nav-item,.mobile-nav-item').forEach(x => x.classList.toggle('active', x.dataset.view === name));
  document.body.classList.toggle('is-player-view', name === 'player');
  const crumb = $('#crumb');
  if (crumb) crumb.textContent = name;
  updatePlayerHost();
  window.scrollTo(0, 0);
  if (window.LunaNav && typeof window.LunaNav.showView === 'function' && name !== 'playlist' && name !== 'player') {
    /* nav.js may also update; keep in sync */
  }
}

function updatePlayerHost() {
  const isPlayer = $('#view-player')?.classList.contains('active');
  const mini = Boolean(currentId && !isPlayer);
  document.body.classList.toggle('is-mini-player', mini);
  document.body.classList.toggle('is-player-view', Boolean(isPlayer));
}

async function openPlaylist(id) {
  currentPlaylist = id;
  showView('playlist');
  const box = $('#playlist-detail');
  if (box) box.innerHTML = '<div class="empty"><p class="empty-text">Загрузка…</p></div>';
  try {
    const detail = await apiRequest('/api/playlists/' + encodeURIComponent(id));
    const p = state.playlists.find(x => x.id === id);
    const items = detail?.items || detail?.tracks || [];
    if (p) {
      p.trackIds = items.map(i => {
        const tr = i.track || i;
        const vid = tr.id || tr.videoId || i.videoId;
        if (!vid) return null;
        state.tracks[vid] = {
          id: vid,
          title: tr.title || 'YouTube',
          channel: tr.channel || 'YouTube',
          thumbnail: tr.thumbnail || '',
          duration: tr.duration || '',
          availability: tr.availability,
          metadataStatus: tr.metadataStatus
        };
        return vid;
      }).filter(Boolean);
      if (detail.name) p.name = detail.name;
      p.trackCount = p.trackIds.length;
    }
  } catch (e) {
    notify(e.message || String(e));
    if (box) box.innerHTML = '<div class="empty"><p class="empty-text">' + esc(e.message || 'Ошибка') + '</p></div>';
    return;
  }
  const p = state.playlists.find(x => x.id === id);
  if (!box) return;
  if (!p) {
    box.innerHTML = '<div class="empty"><p class="empty-text">Плейлист не найден</p></div>';
    return;
  }
  const tracks = p.trackIds || [];
  const ctx = esc(JSON.stringify(tracks));
  const rows = tracks.map((tid, i) => {
    const t = state.tracks[tid];
    if (!t) return '';
    const thumb = t.thumbnail
      ? '<img src="' + esc(t.thumbnail) + '" alt="" loading="lazy" referrerpolicy="no-referrer">'
      : '♫';
    return '<div class="track-row">'
      + '<span class="track-order">' + String(i + 1).padStart(2, '0') + '</span>'
      + '<div class="track-cover">' + thumb + '</div>'
      + '<div class="track-info"><b>' + esc(t.title) + '</b><small>' + esc(t.channel || '') + '</small></div>'
      + '<button type="button" class="row-play" data-track="' + esc(tid) + '" data-track-context=\'' + ctx + '\' aria-label="Play">▶</button>'
      + '</div>';
  }).join('');
  box.innerHTML = '<div class="playlist-hero"><div class="cover"><span class="cover-symbol">♫</span><span class="cover-title">' + esc(p.name) + '</span></div>'
    + '<div><div class="eyebrow">PLAYLIST</div><h1>' + esc(p.name) + '</h1><p>' + tracks.length + ' треков</p>'
    + (tracks.length ? '<div class="playlist-actions"><button type="button" class="primary" data-playlist-play="' + esc(p.id) + '">▶ Слушать</button></div>' : '')
    + '</div></div><div class="track-list">' + (rows || empty('В плейлисте нет треков')) + '</div>';
}

function loadYouTubeApi() {
  return new Promise(resolve => {
    if (window.YT && window.YT.Player) return resolve();
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (prev) prev(); resolve(); };
    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
    }
  });
}

async function ensurePlayer() {
  await loadYouTubeApi();
  if (ytPlayer) return ytPlayer;
  ytPlayer = new YT.Player('youtube-player', {
    width: '100%', height: '100%',
    playerVars: { controls: 0, disablekb: 1, fs: 0, modestbranding: 1, rel: 0, playsinline: 1 },
    events: {
      onReady: () => { apiReady = true; },
      onStateChange: (e) => {
        if (e.data === 0) playNext();
        renderPlayer();
      },
      onError: (e) => {
        playbackMessage = playerErrorDetails(e.data) || 'error';
        notify(playbackMessage);
        playNext();
      }
    }
  });
  return ytPlayer;
}

async function playTrack(id, contextIds) {
  currentId = id;
  if (Array.isArray(contextIds) && contextIds.length) {
    state.queue = contextIds.filter(Boolean);
    queueIndex = state.queue.indexOf(id);
  } else {
    state.queue = [id];
    queueIndex = 0;
  }
  showView('player');
  await ensurePlayer();
  // wait briefly for onReady if needed
  if (!apiReady) {
    await new Promise(r => setTimeout(r, 400));
  }
  if (ytPlayer) {
    try {
      ytPlayer.loadVideoById(id);
      loadedVideoId = id;
      ytPlayer.playVideo();
    } catch (e) {
      notify(String(e.message || e));
    }
  }
  try { await apiRequest('/api/history', { method: 'POST', body: JSON.stringify({ videoId: id }) }); } catch {}
  if (!state.recent.includes(id)) state.recent.unshift(id);
  renderPlayer();
}

function playNext() {
  if (!state.queue.length) return;
  const next = nextPlayableIndex(state.queue, queueIndex, unavailableIds, repeatMode === 'queue');
  if (next < 0) return;
  queueIndex = next;
  playTrack(state.queue[queueIndex], state.queue);
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-view],[data-playlist],[data-playlist-play],[data-track],[data-player-action],[data-action]');
  if (!t) return;
  if (t.dataset.view) {
    if (window.LunaNav) window.LunaNav.showView(t.dataset.view);
    else showView(t.dataset.view);
  }
  if (t.dataset.playlist) openPlaylist(t.dataset.playlist);
  if (t.dataset.playlistPlay) {
    const pl = state.playlists.find(x => x.id === t.dataset.playlistPlay);
    if (pl && pl.trackIds && pl.trackIds.length) playTrack(pl.trackIds[0], pl.trackIds);
  }
  if (t.dataset.track) {
    let ctx = null;
    try { ctx = JSON.parse(t.dataset.trackContext || 'null'); } catch {}
    playTrack(t.dataset.track, ctx);
  }
  if (t.dataset.playerAction === 'toggle' && ytPlayer && apiReady) {
    const st = ytPlayer.getPlayerState();
    if (st === 1) ytPlayer.pauseVideo(); else ytPlayer.playVideo();
  }
  if (t.dataset.playerAction === 'next') playNext();
  if (t.dataset.playerAction === 'previous') {
    const prev = previousPlayableIndex(state.queue, queueIndex, unavailableIds, repeatMode === 'queue');
    if (prev >= 0) { queueIndex = prev; playTrack(state.queue[queueIndex], state.queue); }
  }
  if (t.dataset.playerAction === 'volume' && ytPlayer && apiReady) togglePlayerAudio(ytPlayer);
});

render();
