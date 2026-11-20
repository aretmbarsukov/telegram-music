/* Local browser prototype. Persisted data belongs only to this browser. */
import {
  buildQueue,
  firstPlayableIndex,
  nextPlayableIndex,
  previousPlayableIndex,
  shuffleUpcoming,
} from "./player-queue.js";
import { playerErrorDetails } from "./player-errors.js";
import { togglePlayerAudio } from "./player-volume.js";
import { initializeTelegramWebApp, haptic as bridgeHaptic } from "./telegram-bridge.js";
import "./api.js";
import "./store.js";
import "./ui-render.js";
import "./player.js";
const KEY = "luna-library-v1";
const palettes = [
  ["#723f62", "#bd6c91"],
  ["#413d70", "#8580c6"],
  ["#365c59", "#63a78f"],
  ["#734d3b", "#c58a5b"],
  ["#384b70", "#6e93c2"],
  ["#713c45", "#c9757b"],
];
const demo = {
  playlists: [
    {
      id: "demo-night",
      name: "Нічний вайб",
      created: Date.now() - 86400000 * 6,
      updated: Date.now() - 86400000,
      trackIds: ["60ItHLz5WEA", "jfKfPfyJRdk"],
    },
    {
      id: "demo-energy",
      name: "На повторі",
      created: Date.now() - 86400000 * 4,
      updated: Date.now() - 3600000,
      trackIds: ["9bZkp7q19f0", "kJQP7kiw5Fk"],
    },
    {
      id: "demo-focus",
      name: "На фоні",
      created: Date.now() - 86400000 * 2,
      updated: Date.now() - 7200000,
      trackIds: ["jfKfPfyJRdk"],
    },
  ],
  tracks: {
    "60ItHLz5WEA": {
      id: "60ItHLz5WEA",
      title: "Faded",
      channel: "Alan Walker",
      duration: "3:32",
    },
    jfKfPfyJRdk: {
      id: "jfKfPfyJRdk",
      title: "lofi hip hop radio — beats to relax / study to",
      channel: "Lofi Girl",
      duration: "LIVE",
    },
    "9bZkp7q19f0": {
      id: "9bZkp7q19f0",
      title: "Gangnam Style",
      channel: "officialpsy",
      duration: "4:13",
    },
    kJQP7kiw5Fk: {
      id: "kJQP7kiw5Fk",
      title: "Despacito",
      channel: "Luis Fonsi",
      duration: "4:42",
    },
  },
  favorites: ["60ItHLz5WEA"],
  recent: ["jfKfPfyJRdk", "9bZkp7q19f0"],
  queue: ["60ItHLz5WEA", "jfKfPfyJRdk", "9bZkp7q19f0", "kJQP7kiw5Fk"],
};
const telegram = window.Telegram?.WebApp;
const localApi =
  location.protocol !== "file:" &&
  ["localhost", "127.0.0.1"].includes(location.hostname);
const apiContext = Boolean(telegram?.initData || localApi);
let state;
if (apiContext)
  state = { playlists: [], tracks: {}, favorites: [], recent: [], queue: [], vibe: null };
else
  try {
    state = JSON.parse(localStorage.getItem(KEY)) || demo;
  } catch {
    state = demo;
  }
state.vibe = null;
let vibeLoading = false;
let musicSearchResults = [];
let musicSearchState = "idle";
let musicSearchError = "";
let musicSearchLoading = false;
const musicSearchSaving = new Set();
let vibeQueueActive = false,
  vibeQueueLoading = false,
  vibeQueueAdvanceWhenReady = false,
  vibeQueueSeen = new Set();
let currentId = null,
  currentPlaylist = null,
  repeatMode = "off",
  shuffle = false,
  ytPlayer = null,
  apiReady = false,
  toastTimer,
  apiMode = apiContext,
  apiHealth = null,
  bootstrapPromise = Promise.resolve(),
  queueIndex = -1,
  unavailableIds = new Set(),
  playbackMessage = "",
  loadedVideoId = null,
  playerApiTimer = null,
  autoplayRequested = false,
  viewHistory = ["home"],
  playerStreamRetries = new Map(),
  nativeAudio = null,
  directAudioMode = false,
  prefetchedNextIds = new Set();
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const tr = (key) => window.LunaI18n?.t?.(key) || key;
if (telegram) {
  initializeTelegramWebApp(telegram);
}
function haptic(kind = "light") {
  bridgeHaptic(telegram, kind);
}
function initializeNativeAudio() {
  nativeAudio = $("#native-audio-player");
  if (!nativeAudio) return;
  nativeAudio.addEventListener("timeupdate", handleNativeTimeUpdate);
  nativeAudio.addEventListener("ended", handleNativeEnded);
  nativeAudio.addEventListener("play", () => updateNativeMediaSessionState("playing"));
  nativeAudio.addEventListener("pause", () => updateNativeMediaSessionState("paused"));
  nativeAudio.addEventListener("error", () => {
    notify("Не вдалося відтворити аудіопотік.");
  });
}
initializeNativeAudio();
function updateTelegramBackButton(name) {
  const backButton = telegram?.BackButton;
  if (!backButton) return;
  if (name === "home") {
    backButton.hide();
    return;
  }
  backButton.show();
  backButton.offClick?.(handleTelegramBack);
  backButton.onClick?.(handleTelegramBack);
}
function handleTelegramBack() {
  haptic();
  const previous = viewHistory.at(-2);
  if (previous) {
    viewHistory.pop();
    showView(previous, false);
  } else {
    showView("home", false);
  }
}
function setConnection(message = "", kind = "") {
  const banner = $("#connection-banner"),
    badge = $("#connection-badge");
  if (banner) {
    banner.hidden = !message;
    banner.className = `connection-banner ${kind}`;
    banner.querySelector("span").textContent = message;
  }
  if (badge) {
    badge.classList.toggle("is-online", kind === "connected");
    badge.innerHTML = `<i></i>${kind === "connected" ? (apiHealth?.youtubeMockEnabled ? "API · демо YouTube" : "API під’єднано") : apiContext ? "Підключення API" : "Локальний прототип"}`;
  }
}
async function apiRequest(path, options = {}) {
  if (apiContext && !apiHealth) await bootstrapPromise;
  if (apiContext && !apiHealth) throw new Error("Сесію API не авторизовано");
  const headers = {
    ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {}),
  };
  if (telegram?.initData) headers.Authorization = `tma ${telegram.initData}`;
  else if (localApi && apiHealth?.devAuthEnabled)
    headers["x-dev-user-id"] = apiHealth.devAuthUserId;
  let response;
  try {
    response = await fetch(path, { ...options, headers });
  } catch {
    setConnection(
      "Не вдалося з’єднатися з API. Перевір сервер і базу даних.",
      "error",
    );
    throw new Error("Сервер недоступний");
  }
  const data =
    response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 || response.status >= 500)
      setConnection(data?.error || `Помилка API ${response.status}`, "error");
    throw new Error(data?.error || `Помилка API ${response.status}`);
  }
  return data;
}
async function loadApiLibrary() {
  if (!apiContext) {
    setConnection("Дані цього режиму зберігаються лише в браузері", "local");
    return;
  }
  setConnection("Підключаємося до бібліотеки…", "loading");
  try {
    const healthResponse = await fetch("/api/health");
    if (!healthResponse.ok)
      throw new Error(`API недоступний (${healthResponse.status})`);
    apiHealth = await healthResponse.json();
    directAudioMode = Boolean(apiHealth.audioProviderConfigured);
    if (!telegram?.initData && localApi && !apiHealth.devAuthEnabled)
      throw new Error(
        "Локальна авторизація вимкнена. Увімкни DEV_AUTH_ENABLED=true лише для розробки.",
      );
    if (!telegram?.initData && !localApi)
      throw new Error("Відкрий Mini App через Telegram для авторизації.");
    const me = await apiRequest("/api/me");
    const rows = await apiRequest("/api/playlists");
    state.playlists = rows.map((p) => ({
      id: p.id,
      name: p.name,
      artwork: p.artworkUrl || null,
      created: new Date(p.createdAt).getTime(),
      updated: new Date(p.updatedAt).getTime(),
      trackCount: p.trackCount || 0,
      trackIds: [],
      sourceId: p.youtube?.youtubeId || null,
      lastSync: p.youtube?.lastSuccessAt || null,
      syncStatus: p.youtube?.status || null,
      metadataStatus: p.youtube?.metadataStatus || null,
    }));
    const historyRows = await apiRequest("/api/history");
    state.recent = historyRows.map((row) => {
      state.tracks[row.videoId] = {
        id: row.videoId,
        title: row.title,
        channel: row.channel || "YouTube",
        thumbnail: row.thumbnail || "",
        duration: row.duration || "",
        availability: row.availability,
        metadataStatus: row.metadataStatus,
      };
      return row.videoId;
    });
    const favorites = await apiRequest("/api/favorites");
    state.favorites = favorites.map((row) => {
      state.tracks[row.videoId] = {
        id: row.videoId,
        title: row.title,
        channel: row.channel || "YouTube",
        thumbnail: row.thumbnail || "",
        duration: row.duration || "",
        availability: row.availability,
        metadataStatus: row.metadataStatus,
      };
      return row.videoId;
    });
    const account = $(".sidebar-bottom div");
    if (account)
      account.innerHTML = `<b>${esc(me.firstName || "Музична бібліотека")}</b><small>${esc(me.username ? `@${me.username}` : me.telegramId)}</small>`;
    setConnection("", "connected");
    render();
    updateTelegramBackButton("home");
    const params = new URLSearchParams(location.search);
    const deepLinkPlaylist = params.get("play");
    if (deepLinkPlaylist) {
      params.delete("play");
      const query = params.toString();
      history.replaceState(
        null,
        "",
        `${location.pathname}${query ? `?${query}` : ""}${location.hash}`,
      );
      void playPlaylist(deepLinkPlaylist);
    }
  } catch (e) {
    setConnection(`Не вдалося підключити бібліотеку: ${e.message}`, "error");
  }
}
bootstrapPromise = loadApiLibrary();
function save() {
  if (apiMode) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* Browser storage can be unavailable. */
  }
}
function esc(s = "") {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
function palette(s) {
  let n = 0;
  for (const c of s) n = (n * 31 + c.charCodeAt(0)) | 0;
  return palettes[Math.abs(n) % palettes.length];
}
function trackCountOf(p) {
  return p?.trackCount ?? p?.trackIds?.length ?? 0;
}
function backgroundPlaybackUrl(p) {
  if (p?.sourceId)
    return (
      "https://music.youtube.com/playlist?list=" + encodeURIComponent(p.sourceId)
    );
  const ids = (p?.trackIds || []).slice(0, 50);
  if (!ids.length) return null;
  return (
    "https://www.youtube.com/watch_videos?video_ids=" +
    ids.map(encodeURIComponent).join(",")
  );
}
function openExternalUrl(url) {
  try {
    if (telegram && typeof telegram.openLink === "function") {
      telegram.openLink(url);
      return;
    }
  } catch {
    /* Fall back to a regular browser tab. */
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
function cover(p, cls = "") {
  const [a, b] = palette(p.id),
    count = trackCountOf(p);
  return `<div class="cover ${cls}" style="background:radial-gradient(circle at 75% 22%,${b},transparent 44%),linear-gradient(135deg,${a},#201d2d)"><span class="cover-symbol">♫</span><span class="cover-title">${esc(p.name)}</span><span class="cover-count">${count} трек${count === 1 ? "" : "и"}</span></div>`;
}
function empty(text) {
  return `<div class="empty">${esc(text)}</div>`;
}
function renderMusicSearch() {
  const playlistSelect = $("#music-search-playlist"),
    resultsBox = $("#music-search-results"),
    submitButton = $("#music-search-form button[type='submit']");
  if (!playlistSelect || !resultsBox) return;
  const selectedId = playlistSelect.value;
  playlistSelect.innerHTML = state.playlists.length
    ? state.playlists
        .map((playlist) => `<option value="${esc(playlist.id)}">${esc(playlist.name)}</option>`)
        .join("")
    : `<option value="">${esc(tr("musicSearchNoPlaylist"))}</option>`;
  playlistSelect.value = state.playlists.some((playlist) => playlist.id === selectedId)
    ? selectedId
    : state.playlists[0]?.id || "";
  playlistSelect.disabled = !state.playlists.length;
  if (submitButton) submitButton.disabled = musicSearchLoading;

  const ids = musicSearchResults.map((track) => track.videoId).filter(Boolean);
  const rows = trackRows(ids, ids, null, null, playlistSelect.value);
  if (musicSearchLoading) {
    resultsBox.innerHTML = `<div class="search-skeleton" aria-label="${esc(tr("musicSearchLoading"))}">
      ${Array.from({ length: 5 }, () => '<div class="skeleton-row"><span class="skeleton-cover"></span><span class="skeleton-lines"><i></i><i></i></span></div>').join("")}
    </div>`;
  }
  else if (musicSearchState === "error") resultsBox.innerHTML = empty(musicSearchError);
  else if (musicSearchState === "unavailable") resultsBox.innerHTML = empty(tr("musicSearchRequiresApi"));
  else if (musicSearchState === "empty") resultsBox.innerHTML = empty(tr("musicSearchNoResults"));
  else resultsBox.innerHTML = rows || empty(tr("musicSearchHint"));
}
async function searchMusic() {
  if (musicSearchLoading) return;
  const query = $("#music-search-query").value.trim();
  if (query.length < 2) {
    notify(tr("musicSearchMinQuery"));
    return;
  }
  if (!apiContext) {
    musicSearchState = "unavailable";
    renderMusicSearch();
    return;
  }
  musicSearchLoading = true;
  musicSearchState = "loading";
  musicSearchResults = [];
  musicSearchError = "";
  renderMusicSearch();
  try {
    const data = await apiRequest(`/api/youtube/search?q=${encodeURIComponent(query)}`);
    musicSearchResults = Array.isArray(data?.tracks) ? data.tracks : [];
    for (const track of musicSearchResults) {
      if (!track.videoId) continue;
      state.tracks[track.videoId] = {
        id: track.videoId,
        title: track.title,
        channel: track.channel || "YouTube",
        thumbnail: track.thumbnail || "",
        duration: track.duration || "",
        availability: track.availability || "AVAILABLE",
        metadataStatus: "FRESH",
      };
    }
    musicSearchState = musicSearchResults.length ? "results" : "empty";
  } catch (error) {
    musicSearchState = "error";
    musicSearchError = error instanceof Error ? error.message : String(error);
  } finally {
    musicSearchLoading = false;
    renderMusicSearch();
  }
}
async function saveSearchTrack(videoId, playlistId) {
  const result = musicSearchResults.find((track) => track.videoId === videoId),
    playlist = state.playlists.find((item) => item.id === playlistId),
    saveKey = `${playlistId}:${videoId}`;
  if (!result || !playlist || musicSearchSaving.has(saveKey)) return;
  result.playlistIds ||= [];
  if (result.playlistIds.includes(playlistId)) return;
  musicSearchSaving.add(saveKey);
  renderMusicSearch();
  try {
    await apiRequest(`/api/playlists/${encodeURIComponent(playlistId)}/tracks`, {
      method: "POST",
      body: JSON.stringify({ videoId, title: result.title, channel: result.channel }),
    });
    result.playlistIds.push(playlistId);
    if (playlist.trackIds.length > 0 || playlist.trackCount === 0)
      playlist.trackIds.push(videoId);
    playlist.trackCount = (playlist.trackCount || 0) + 1;
    playlist.updated = Date.now();
    render();
    notify(tr("musicSearchAdded"));
  } catch (error) {
    if (error instanceof Error && /already exists/i.test(error.message)) {
      result.playlistIds.push(playlistId);
      render();
      notify(tr("musicSearchDuplicate"));
    } else {
      notify(error instanceof Error ? error.message : String(error));
    }
  } finally {
    musicSearchSaving.delete(saveKey);
    renderMusicSearch();
  }
}
function render() {
  renderSidebar();
  renderHome();
  renderMusicSearch();
  renderLibrary();
  renderFavs();
  renderRecent();
  renderVibe();
  renderPlayer();
  if (currentPlaylist && $("#view-playlist").classList.contains("active"))
    renderDetail();
}
function renderSidebar() {
  $("#side-playlists").innerHTML =
    state.playlists
      .map(
        (p) =>
          `<button class="side-playlist" data-playlist="${esc(p.id)}"><span class="side-dot" style="background:linear-gradient(135deg,${palette(p.id).join(",")})">♫</span>${esc(p.name)}</button>`,
      )
      .join("") ||
    '<small style="color:#777;padding:8px">Плейлистів поки немає</small>';
}
function card(p) {
  const count = trackCountOf(p);
  return `<article class="playlist-card" data-playlist="${esc(p.id)}">${cover(p)}<div class="card-meta"><b>${esc(p.name)}</b><span>${count} трек${count === 1 ? "" : "и"}</span></div></article>`;
}
function renderHome() {
  const recent = state.playlists
    .slice()
    .sort((a, b) => b.updated - a.updated)
    .slice(0, 4);
  $("#home-playlists").innerHTML =
    recent.map(card).join("") ||
    empty("Створи перший плейлист або додай трек.");
  $("#home-tracks").innerHTML =
    trackRows(state.recent.slice(0, 5)) ||
    empty("Після прослуховування треки з’являться тут.");
}
function renderLibrary() {
  const term = ($("#search")?.value || "").trim().toLocaleLowerCase("uk");
  const mode = $("#sort")?.value || "updated";
  let list = state.playlists.filter((p) =>
    p.name.toLocaleLowerCase("uk").includes(term),
  );
  if (mode === "name") list.sort((a, b) => a.name.localeCompare(b.name, "uk"));
  else if (mode === "count")
    list.sort((a, b) => trackCountOf(b) - trackCountOf(a));
  else list.sort((a, b) => b.updated - a.updated);
  $("#library-playlists").innerHTML =
    list.map(card).join("") ||
    empty(
      term
        ? "Нічого не знайдено. Спробуй інший запит."
        : "Твоя бібліотека чекає на першу добірку.",
    );
}
function formatDuration(value = "") {
  const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return value;
  const hours = Number(match[1] || 0),
    minutes = Number(match[2] || 0),
    seconds = Number(match[3] || 0);
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}
function thumbnailMarkup(track) {
  try {
    const url = new URL(track.thumbnail);
    if (
      url.protocol === "https:" &&
      (url.hostname === "i.ytimg.com" ||
        url.hostname === "img.youtube.com" ||
        url.hostname.endsWith(".ytimg.com"))
    )
      return `<img src="${esc(url.href)}" alt="" loading="lazy" referrerpolicy="no-referrer">`;
  } catch {
    /* Missing or malformed thumbnails use the local cover. */
  }
  return "♫";
}
function trackRows(ids, contextIds = null, itemIds = null, reasons = null, searchPlaylistId = null) {
  const unique = [...new Set(ids)].filter((id) => state.tracks[id]),
    context = esc(JSON.stringify(contextIds || []));
  return unique
    .map((id, i) => {
      const t = state.tracks[id],
        [a, b] = palette(id);
      const unavailable = t.availability && t.availability !== "AVAILABLE";
      const stale = ["STALE", "EXPIRED"].includes(t.metadataStatus);
      const removeItem = itemIds?.[id];
      const reason = reasons?.[id];
      const searchResult = searchPlaylistId
        ? musicSearchResults.find((track) => track.videoId === id)
        : null;
      const isSaved = searchResult?.playlistIds?.includes(searchPlaylistId);
      const isSaving = musicSearchSaving.has(`${searchPlaylistId}:${id}`);
      const saveButton = searchPlaylistId
        ? `<button class="search-save${isSaved ? " is-added" : ""}" data-search-add="${esc(id)}" data-search-playlist="${esc(searchPlaylistId)}" aria-label="${esc(tr(isSaved ? "musicSearchSaved" : "musicSearchAddTrack"))}" title="${esc(tr(isSaved ? "musicSearchSaved" : "musicSearchAddTrack"))}" ${isSaved || isSaving ? "disabled" : ""}>${isSaved ? "✓" : "＋"}</button>`
        : "";
      return `<div class="track-row${searchPlaylistId ? " search-result-row" : ""}"><span class="track-order">${String(i + 1).padStart(2, "0")}</span><div class="track-cover" style="background:linear-gradient(135deg,${a},${b})">${thumbnailMarkup(t)}</div><div class="track-info"><b>${esc(t.title)}</b><small>${unavailable ? "Недоступне відео" : stale ? "Метадані застаріли" : esc(t.channel || "YouTube")}${reason ? ` · ${esc(reason)}` : ""}</small></div><span class="track-duration">${esc(formatDuration(t.duration || ""))}</span>${removeItem ? `<button class="heart row-remove" data-remove-item="${esc(removeItem)}" data-remove-video="${esc(id)}" aria-label="Прибрати з плейлиста">×</button>` : ""}${saveButton}<button class="row-play" data-track="${esc(id)}" data-track-context='${context}' aria-label="Відтворити">▶</button><button class="heart ${state.favorites.includes(id) ? "is-fav" : ""}" data-favorite="${esc(id)}" aria-label="Улюблене">${state.favorites.includes(id) ? "♥" : "♡"}</button></div>`;
    })
    .join("");
}
function renderFavs() {
  $("#favorite-tracks").innerHTML =
    trackRows(state.favorites) ||
    empty("Тут поки немає улюблених треків. Натисни ♡ біля композиції.");
}
function renderRecent() {
  $("#recent-tracks").innerHTML =
    trackRows(state.recent) || empty("Прослухані треки з’являться тут.");
}
function renderVibe() {
  const box = $("#vibe-tracks");
  if (!box) return;
  const summary = $("#vibe-summary");
  const vibe = state.vibe;
  if (!vibe) {
    summary.innerHTML = "";
    box.innerHTML = empty(vibeLoading ? "Збираємо твій вайб…" : "Познач улюблені треки — і тут з’явиться персональна хвиля.");
    return;
  }
  const tracks = vibe.tracks || [];
  const seeds = vibe.seeds || {};
  summary.innerHTML =
    `<span class="vibe-pill">♥ ${Number(seeds.favorites) || 0}</span>` +
    `<span class="vibe-pill">✦ ${Number(seeds.channels) || 0} ${Number(seeds.channels) === 1 ? "канал" : "канали"}</span>` +
    (vibe.degraded ? '<span class="vibe-pill muted">Без пошуку</span>' : "");
  if (vibe.notice) summary.innerHTML += `<p class="vibe-notice">${esc(vibe.notice)}</p>`;
  const reasons = Object.fromEntries(tracks.map((row) => [row.videoId, row.reason]).filter(([, reason]) => reason));
  box.innerHTML =
    (tracks.length && trackRows(tracks.map((row) => row.videoId), tracks.map((row) => row.videoId), null, reasons)) ||
    empty("Познач кілька треків улюбленими — і вайб стане точним.");
}
function localVibe() {
  const ids = [...new Set([...state.favorites, ...state.recent])].filter((id) => state.tracks[id]);
  return {
    tracks: ids.map((videoId) => ({
      videoId,
      reason: state.favorites.includes(videoId) ? "З улюбленого" : "З історії",
    })),
    seeds: { favorites: state.favorites.length, channels: 0 },
    degraded: true,
    notice: "Локальний режим: добірка з улюблених треків та історії.",
  };
}
async function loadVibe(refresh = false) {
  if (vibeLoading) return;
  vibeLoading = true;
  renderVibe();
  try {
    if (apiContext) {
      const data = await apiRequest(`/api/vibe${refresh ? "?refresh=1" : ""}`);
      updateVibeData(data);
    } else {
      state.vibe = localVibe();
    }
  } catch (error) {
    state.vibe = {
      tracks: [],
      seeds: { favorites: state.favorites.length, channels: 0 },
      degraded: true,
      notice: error.message,
    };
  } finally {
    vibeLoading = false;
    renderVibe();
  }
}
function updateVibeData(data, append = false) {
  const incoming = Array.isArray(data?.tracks) ? data.tracks : [];
  const tracks = append ? [...(state.vibe?.tracks || []), ...incoming] : incoming;
  state.vibe = {
    tracks: [...new Map(tracks.map((row) => [row?.videoId, row])).values()].filter((row) => row?.videoId),
    seeds: data?.seeds || state.vibe?.seeds || {},
    degraded: Boolean(data?.degraded),
    notice: data?.notice || "",
  };
  for (const row of incoming) {
    if (!row?.videoId) continue;
    state.tracks[row.videoId] = {
      id: row.videoId,
      title: row.title || "YouTube video",
      channel: row.channel || "YouTube",
      thumbnail: row.thumbnail || "",
      duration: row.duration || "",
      availability: row.availability || "AVAILABLE",
      metadataStatus: null,
    };
  }
}
function renderDetail() {
  const p = state.playlists.find((x) => x.id === currentPlaylist);
  if (!p) {
    showView("library");
    return;
  }
  const tracks = p.trackIds || [];
  const backgroundUrl = backgroundPlaybackUrl(p);
  const metadataNote =
    p.metadataStatus === "STALE"
      ? "Метадані YouTube застаріли; старі зв’язки з композиціями збережені."
      : p.metadataStatus === "EXPIRED"
        ? "Кеш очищено; назва відновиться після наступної успішної синхронізації."
        : "";
  const syncLabel =
    {
      SUCCESS: "Успішно",
      RUNNING: "Виконується",
      FAILED: "Помилка",
      UNAVAILABLE: "Недоступний",
    }[p.syncStatus] || "Ще не синхронізувався";
  $("#playlist-detail").innerHTML =
    `<div class="playlist-hero">${cover(p)}<div><div class="eyebrow">${p.sourceId ? "YOUTUBE · СИНХРОНІЗОВАНИЙ" : "ТВОЯ ДОБІРКА"}</div><h1>${esc(p.name)}</h1><p>${tracks.length} трек${tracks.length === 1 ? "" : "и"} · Створено ${new Date(p.created).toLocaleDateString("uk-UA")}</p>${p.sourceId ? `<p>Синхронізація: <b class="sync-state ${esc(p.syncStatus || "")}">${syncLabel}</b> · Остання: ${p.lastSync ? new Date(p.lastSync).toLocaleString("uk-UA") : "ще не виконувалась"}</p>` : ""}${metadataNote ? `<p>${metadataNote}</p>` : ""}<div class="playlist-actions"><button class="primary" data-playlist-play="${esc(p.id)}" ${tracks.length ? "" : "disabled"}>▶ Слухати</button><button class="secondary" data-playlist-shuffle="${esc(p.id)}" ${tracks.length ? "" : "disabled"}>⤨ Перемішати</button>${backgroundUrl ? `<button class="secondary" data-bg-listen="${esc(backgroundUrl)}" title="Відкриє офіційний YouTube Music або YouTube. Фонове відтворення із заблокованим екраном забезпечує застосунок YouTube (потрібен YouTube Premium).">🎧 Слухати у фоні</button>` : ""}<button class="secondary" data-add-to="${esc(p.id)}">＋ Додати трек</button>${p.sourceId ? `<button class="secondary" data-sync="${esc(p.id)}" ${p.syncStatus === "RUNNING" ? "disabled" : ""}>${p.syncStatus === "RUNNING" ? "Синхронізуємо…" : "⟳ Синхронізувати"}</button>` : ""}<button class="secondary" data-rename="${esc(p.id)}">Перейменувати</button><button class="secondary" data-delete="${esc(p.id)}">Видалити</button></div></div></div><div class="track-list">${trackRows(tracks, tracks, p.itemIds || null) || empty("У цьому плейлисті ще немає композицій. Додай трек за посиланням YouTube.")}</div>`;
}
function renderVolumeControls() {
  const available = Boolean(apiReady && ytPlayer),
    muted = available ? ytPlayer.isMuted() : null;
  $$("[data-player-action=volume]").forEach((button) => {
    const compact = button.id === "volume-toggle";
    button.textContent = !available
      ? "◖ Звук"
      : muted
        ? compact
          ? "🔇"
          : "🔇 Увімкнути звук"
        : compact
          ? "🔊"
          : "🔊 Вимкнути звук";
    button.setAttribute(
      "aria-label",
      !available
        ? "Керування звуком"
        : muted
          ? "Увімкнути звук"
          : "Вимкнути звук",
    );
    button.classList.toggle("on", available && !muted);
  });
}
function renderPlayer() {
  const t = state.tracks[currentId],
    isFav = currentId && state.favorites.includes(currentId);
  const stageToggle = $("[data-player-action=toggle]"),
    isPlaying = Boolean(
      apiReady && ytPlayer && ytPlayer.getPlayerState() === 1,
    );
  if (stageToggle)
    stageToggle.textContent = isPlaying ? "Ⅱ Призупинити" : "▶ Відтворити";
  if (t) {
    $("#now-playing .now-meta").innerHTML =
      "<b>" +
      esc(t.title) +
      "</b><small>" +
      esc(t.channel || "YouTube") +
      "</small>";
    $("#player-track-title").textContent = t.title;
    $("#player-track-channel").textContent = t.channel || "YouTube";
    $("#now-fav").textContent = isFav ? "♥" : "♡";
    $("#now-fav").classList.toggle("is-fav", Boolean(isFav));
  } else {
    $("#now-playing .now-meta").innerHTML =
      "<b>Обери свій трек</b><small>YouTube плеєр</small>";
    $("#player-track-title").textContent = "Обери композицію";
    $("#player-track-channel").textContent = "YouTube";
  }
  $("#stage-favorite").textContent = isFav ? "♥ У обраному" : "♡ У обране";
  $("#stage-favorite").classList.toggle("is-fav", Boolean(isFav));
  $("#shuffle").classList.toggle("on", shuffle);
  const repeatButton = $("#repeat");
  repeatButton.classList.toggle("on", repeatMode !== "off");
  repeatButton.textContent = repeatMode === "one" ? "↻1" : "↻";
  repeatButton.setAttribute(
    "aria-label",
    repeatMode === "one"
      ? "Повтор одного треку"
      : repeatMode === "queue"
        ? "Повтор черги"
        : "Повтор вимкнено",
  );
  $$("[data-player-action=shuffle]").forEach((button) =>
    button.classList.toggle("on", shuffle),
  );
  $$("[data-player-action=repeat]").forEach((button) => {
    button.classList.toggle("on", repeatMode !== "off");
    if (button.id !== "repeat")
      button.textContent =
        "↻ Повтор: " +
        (repeatMode === "one"
          ? "одного"
          : repeatMode === "queue"
            ? "черги"
            : "вимкнено");
  });
  const link = $("#youtube-original"),
    music = $("#youtube-music");
  if (link) {
    link.hidden = !currentId;
    link.href = currentId
      ? "https://www.youtube.com/watch?v=" + encodeURIComponent(currentId)
      : "#";
  }
  if (music) {
    music.hidden = !currentId;
    music.href = currentId
      ? "https://music.youtube.com/watch?v=" + encodeURIComponent(currentId)
      : "#";
  }
  renderVolumeControls();
  $("#playback-message").textContent = playbackMessage;
  renderQueue();
  updatePlayerHost();
}
function renderQueue() {
  $("#queue-list").innerHTML =
    state.queue
      .map((id, i) =>
        state.tracks[id]
          ? `<div class="queue-item ${i === queueIndex ? "is-current" : ""}" ${i === queueIndex ? 'aria-current="true"' : ""}><span>${i + 1}. ${esc(state.tracks[id].title)}</span><button data-queue-remove="${esc(id)}" aria-label="Прибрати">×</button></div>`
          : "",
      )
      .join("") ||
    empty("Черга порожня. Запусти плейлист, щоб додати композиції.");
}
function showView(name, pushHistory = true) {
  $$(".view").forEach((v) => v.classList.remove("active"));
  const target = $("#view-" + name);
  if (target) target.classList.add("active");
  if (pushHistory && viewHistory.at(-1) !== name) viewHistory.push(name);
  if (pushHistory && viewHistory.at(-2) !== name) haptic();
  if (viewHistory.length > 20) viewHistory.shift();
  updateTelegramBackButton(name);
  $$(".nav-item, .mobile-nav-item").forEach((x) =>
    x.classList.toggle("active", x.dataset.view === name),
  );
  document.body.classList.toggle("is-player-view", name === "player");
  $("#crumb").textContent =
    {
      home: "Головна",
      library: "Моя бібліотека",
      favorites: "Улюблене",
      recent: "Нещодавні",
      vibe: "Мій вайб",
      playlist: "Плейлист",
      player: "Плеєр",
    }[name] || name;
  $("#crumb").removeAttribute("data-i18n");
  $("#crumb").dataset.locked = "1";
  if (name === "vibe" && !state.vibe) void loadVibe();
  updatePlayerHost();
  window.scrollTo(0, 0);
}
function updatePlayerHost() {
  const isPlayer = $("#view-player").classList.contains("active"),
    mini = Boolean(currentId && !isPlayer);
  document.body.classList.toggle("is-mini-player", mini);
  document.body.classList.toggle("is-player-view", isPlayer);
}
function updateMediaSession() {
  if (!("mediaSession" in navigator)) return;
  const track = currentId ? state.tracks[currentId] : null;
  if (!track) {
    navigator.mediaSession.metadata = null;
    return;
  }
  let artwork = [];
  try {
    const url = new URL(track.thumbnail);
    if (["https:", "http:"].includes(url.protocol)) artwork = [{ src: url.href, sizes: "512x512", type: "image/jpeg" }];
  } catch {
    /* Thumbnail is optional for Media Session metadata. */
  }
  if (typeof MediaMetadata !== "undefined") {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title || "YouTube track",
      artist: track.channel || "YouTube",
      album: currentPlaylist ? state.playlists.find((playlist) => playlist.id === currentPlaylist)?.name || "Luna" : "Luna",
      artwork,
    });
  }
  if (directAudioMode && nativeAudio) {
    navigator.mediaSession.playbackState = nativeAudio.paused ? "paused" : "playing";
  } else {
    navigator.mediaSession.playbackState =
      ytPlayer?.getPlayerState?.() === 1 ? "playing" : "paused";
  }
  const safeSet = (action, handler) => {
    try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* Unsupported action. */ }
  };
  safeSet("play", () => {
    haptic();
    if (directAudioMode && nativeAudio) nativeAudio.play().catch(() => notify("Не вдалося продовжити відтворення."));
    else if (ytPlayer && loadedVideoId === currentId) ytPlayer.playVideo();
  });
  safeSet("pause", () => {
    haptic();
    if (directAudioMode && nativeAudio) nativeAudio.pause();
    else ytPlayer?.pauseVideo?.();
  });
  safeSet("previoustrack", () => { haptic(); step(-1, "media-session"); });
  safeSet("nexttrack", () => { haptic(); step(1, "media-session"); });
  safeSet("seekto", (details) => {
    if (Number.isFinite(details.seekTime) && ((directAudioMode && nativeAudio) || ytPlayer?.seekTo)) {
      if (directAudioMode && nativeAudio) nativeAudio.currentTime = details.seekTime;
      else ytPlayer.seekTo(details.seekTime, true);
      haptic();
    }
  });
}
function updateNativeMediaSessionState(playbackState) {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.playbackState = playbackState;
  updateNativePositionState();
}
function updateNativePositionState() {
  if (!("mediaSession" in navigator) || !nativeAudio || !Number.isFinite(nativeAudio.duration)) return;
  try {
    navigator.mediaSession.setPositionState({
      duration: nativeAudio.duration,
      playbackRate: nativeAudio.playbackRate || 1,
      position: Math.min(nativeAudio.currentTime || 0, nativeAudio.duration),
    });
  } catch {
    /* Unsupported or temporary invalid position state. */
  }
}
function handleNativeTimeUpdate() {
  if (!directAudioMode || !nativeAudio) return;
  updateNativePositionState();
  $("#current-time").textContent = formatTime(nativeAudio.currentTime);
  $("#duration").textContent = Number.isFinite(nativeAudio.duration) ? formatTime(nativeAudio.duration) : "0:00";
  $("#progress-fill").style.width = nativeAudio.duration
    ? `${Math.min(100, (nativeAudio.currentTime / nativeAudio.duration) * 100)}%`
    : "0%";
  const remaining = nativeAudio.duration - nativeAudio.currentTime;
  if (!Number.isFinite(remaining) || remaining >= 20) return;
  if (queueIndex < 0 || queueIndex >= state.queue.length - 1) return;
  const nextId = state.queue[queueIndex + 1];
  if (!nextId || prefetchedNextIds.has(nextId)) return;
  prefetchedNextIds.add(nextId);
  apiRequest(`/api/tracks/${encodeURIComponent(nextId)}/prefetch`, {
    method: "POST",
  }).catch(() => prefetchedNextIds.delete(nextId));
}
function handleNativeEnded() {
  if (!directAudioMode) return;
  const nextIndex = nextPlayableIndex(state.queue, queueIndex, unavailableIds, repeatMode, "ended");
  if (nextIndex !== null) loadQueueIndex(nextIndex);
  else if (repeatMode === "queue") loadQueueIndex(firstPlayableIndex(state.queue, 0, unavailableIds));
  else playbackMessage = "Чергу завершено.";
  renderPlayer();
}
function notify(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}
function showModalError(message) {
  const error = $("#modal-error");
  if (error) {
    error.textContent = message;
    error.hidden = false;
  }
}
function openModal(title, copy, body, submitText, callback) {
  const d = $("#modal"),
    content = $("#modal-content");
  content.innerHTML = `<div class="eyebrow">LUNA · БІБЛІОТЕКА</div><h2 class="modal-title">${title}</h2><div class="modal-copy">${copy}</div>${body}<div id="modal-error" class="form-error" role="alert" hidden></div><div class="modal-actions"><button class="secondary" value="cancel">Скасувати</button><button class="primary" id="modal-submit" type="button">${submitText}</button></div>`;
  d.showModal();
  $("#modal-submit").onclick = async () => {
    const button = $("#modal-submit"),
      label = button.textContent;
    button.disabled = true;
    button.textContent = "Завантаження…";
    const error = $("#modal-error");
    if (error) {
      error.hidden = true;
      error.textContent = "";
    }
    try {
      const result = await callback();
      if (result !== false) d.close();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Сталася помилка";
      showModalError(message);
      notify(message);
    } finally {
      if (d.open) {
        button.disabled = false;
        if (button.textContent === "Завантаження…") button.textContent = label;
      }
    }
  };
  setTimeout(() => content.querySelector("input")?.focus(), 50);
}
function createPlaylist() {
  openModal(
    "Новий плейлист",
    "Дай своїй добірці назву. Кількість плейлистів не обмежена.",
    '<label class="field-label">НАЗВА</label><input class="field" id="playlist-name" maxlength="60" placeholder="Наприклад, Ранковий настрій">',
    "Створити",
    async () => {
      const name = $("#playlist-name").value.trim();
      if (!name) {
        notify("Введи назву плейлиста");
        return false;
      }
      let p = {
        id: "p-" + crypto.randomUUID(),
        name,
        created: Date.now(),
        updated: Date.now(),
        trackIds: [],
      };
      if (apiMode) {
        const created = await apiRequest("/api/playlists", {
          method: "POST",
          body: JSON.stringify({ name }),
        });
        p = {
          ...p,
          id: created.id,
          created: new Date(created.createdAt).getTime(),
        };
      }
      state.playlists.unshift(p);
      save();
      render();
      openPlaylist(p.id);
      notify("Плейлист створено");
    },
  );
}
function addTrackModal(target) {
  const options =
    '<option value="">Обери плейлист</option>' +
    state.playlists
      .map(
        (p) =>
          `<option value="${esc(p.id)}" ${p.id === target ? "selected" : ""}>${esc(p.name)}</option>`,
      )
      .join("");
  openModal(
    "Додати трек",
    "Встав посилання на YouTube відео та обери плейлист.",
    '<label class="field-label">ПОСИЛАННЯ НА ВІДЕО</label><input class="field" id="video-url" placeholder="https://youtu.be/…"><label class="field-label">НАЗВА ТРЕКУ</label><input class="field" id="video-title" maxlength="100" placeholder="Назва (можна залишити пустим)"><label class="field-label">ДОДАТИ ДО ПЛЕЙЛИСТА</label><select class="field" id="target-playlist">' +
      options +
      "</select>",
    "Додати",
    async () => {
      const url = $("#video-url").value.trim(),
        id = parseVideoId(url);
      if (!id) {
        showModalError(
          parsePlaylistId(url)
            ? "Це посилання на плейлист. Встав посилання на окреме відео."
            : "Неправильне посилання. Потрібен YouTube URL з ID відео.",
        );
        return false;
      }
      const p = state.playlists.find(
        (x) => x.id === $("#target-playlist").value,
      );
      if (!p) {
        showModalError("Обери плейлист для цього треку.");
        return false;
      }
      if ((p.trackIds || []).includes(id)) {
        showModalError("Цей трек уже є у плейлисті.");
        return false;
      }      let track = {
        id,
        title: $("#video-title").value.trim() || "YouTube відео",
        channel: "YouTube",
        thumbnail: "",
        duration: "",
      };
      if (apiMode) {
        const result = await apiRequest("/api/youtube/preview", {
          method: "POST",
          body: JSON.stringify({ url }),
        });
        if (result.kind !== "video") {
          showModalError(
            "Це посилання на плейлист. Встав посилання на окреме відео.",
          );
          return false;
        }
        track = {
          id,
          title: result.title,
          channel: result.channel || "YouTube",
          thumbnail: result.thumbnail || "",
          duration: result.duration || "",
        };
        await apiRequest(`/api/playlists/${encodeURIComponent(p.id)}/tracks`, {
          method: "POST",
          body: JSON.stringify({
            videoId: id,
            title: track.title,
            channel: track.channel,
          }),
        });
        await loadPlaylistDetail(p.id);
        p.trackCount = p.trackIds.length;
      } else {
        if (!state.tracks[id]) state.tracks[id] = track;
        p.trackIds.push(id);
        p.trackCount = p.trackIds.length;
        p.updated = Date.now();
      }
      save();
      render();
      if (currentPlaylist === p.id) renderDetail();
      notify("Трек додано");
    },
  );
}
function importModal() {
  let preview = null;
  openModal(
    "Імпортувати з YouTube",
    "Додай доступний публічний YouTube плейлист. Періодична синхронізація перевіряє зміни приблизно кожні 30 хвилин.",
    '<label class="field-label">ПОСИЛАННЯ НА ПЛЕЙЛИСТ</label><input class="field" id="playlist-url" placeholder="youtube.com/playlist?list=…"><div class="notice" id="import-preview" style="margin-top:13px">Плейлист буде синхронізуватися лише з YouTube до твоєї бібліотеки.</div>',
    "Перевірити",
    async () => {
      const url = $("#playlist-url").value.trim(),
        playlistId = parsePlaylistId(url);
      if (!playlistId) {
        showModalError(
          parseVideoId(url)
            ? "Це посилання на відео. Для імпорту потрібне посилання на плейлист."
            : "Неправильне посилання. Встав YouTube URL із параметром list=.",
        );
        return false;
      }
      if (!apiMode) {
        showModalError("API недоступне. Перевір підключення до сервера.");
        return false;
      }
      if (!preview) {
        preview = await apiRequest("/api/youtube/preview", {
          method: "POST",
          body: JSON.stringify({ url }),
        });
        if (preview.kind !== "playlist") {
          showModalError(
            "Це посилання на відео. Для імпорту потрібне посилання на плейлист.",
          );
          return false;
        }
        $("#import-preview").textContent =
          `${preview.title} · близько ${preview.itemCount} композицій`;
        $("#modal-submit").textContent = "Імпортувати";
        return false;
      }
      const created = await apiRequest("/api/youtube/import", {
        method: "POST",
        body: JSON.stringify({ url }),
      });
      const p = {
        id: created.id,
        name: created.name,
        created: Date.now(),
        updated: Date.now(),
        trackCount: created.trackCount,
        trackIds: [],
        sourceId: created.sourcePlaylistId,
      };
      state.playlists.unshift(p);
      save();
      render();
      openPlaylist(p.id);
      notify(`Імпортовано: ${created.trackCount} треків`);
    },
  );
  const input = $("#playlist-url");
  if (input)
    input.addEventListener("input", () => {
      preview = null;
      const submit = $("#modal-submit");
      if (submit) submit.textContent = "Перевірити";
      const note = $("#import-preview");
      if (note)
        note.textContent =
          "Плейлист буде синхронізуватися лише з YouTube до твоєї бібліотеки.";
    });
}
function parseVideoId(raw) {
  try {
    const u = new URL(raw.trim());
    let id = "";
    if (["youtu.be"].includes(u.hostname))
      id = u.pathname.split("/").filter(Boolean)[0] || "";
    else if (
      [
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "music.youtube.com",
      ].includes(u.hostname)
    ) {
      id = u.searchParams.get("v") || "";
      if (!id) {
        const m = u.pathname.match(/\/(?:embed|shorts)\/([^/?]+)/);
        if (m) id = m[1];
      }
    }
    return /^[\w-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}
function parsePlaylistId(raw) {
  try {
    const u = new URL(raw.trim());
    if (
      ![
        "youtube.com",
        "www.youtube.com",
        "music.youtube.com",
        "m.youtube.com",
      ].includes(u.hostname)
    )
      return null;
    const id = u.searchParams.get("list");
    return id && /^[\w-]+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}
async function loadPlaylistDetail(id) {
  if (!apiMode) return;
  const data = await apiRequest(`/api/playlists/${encodeURIComponent(id)}`);
  const p = state.playlists.find((x) => x.id === id);
  if (!p) return;
  p.name = data.name;
  p.trackIds = data.items.map((i) => i.track.id);
  p.trackCount = p.trackIds.length;
  p.itemIds = {};
  p.sourceId = data.youtube?.youtubeId || null;
  p.lastSync = data.youtube?.lastSuccessAt || null;
  p.syncStatus = data.youtube?.status || null;
  p.metadataStatus = data.youtube?.metadataStatus || null;
  for (const item of data.items) {
    const t = item.track;
    p.itemIds[t.id] = item.id;
    state.tracks[t.id] = {
      id: t.id,
      title: t.title,
      channel: t.channel || "YouTube",
      thumbnail: t.thumbnail || "",
      duration: t.duration || "",
      availability: t.availability,
      metadataStatus: t.metadataStatus,
    };
  }
  save();
}
async function openPlaylist(id) {
  currentPlaylist = id;
  showView("playlist");
  $("#playlist-detail").innerHTML =
    '<div class="empty loading-state">Завантажуємо плейлист…</div>';
  if (apiMode) {
    try {
      await loadPlaylistDetail(id);
    } catch (e) {
      $("#playlist-detail").innerHTML =
        `<div class="empty error-state">Не вдалося завантажити плейлист: ${esc(e.message)}</div>`;
      return;
    }
  }
  renderDetail();
}
async function toggleFav(id) {
  if (!id) return;
  haptic();
  const wasFav = state.favorites.includes(id);
  try {
    if (apiMode)
      await apiRequest(`/api/favorites/${encodeURIComponent(id)}`, {
        method: wasFav ? "DELETE" : "POST",
      });
    if (wasFav) state.favorites = state.favorites.filter((x) => x !== id);
    else state.favorites.unshift(id);
    state.vibe = null;
    save();
    render();
    if ($("#view-vibe").classList.contains("active")) void loadVibe();
  } catch (error) {
    notify(`Не вдалося оновити обране: ${error.message}`);
  }
}
function addCurrentToPlaylist() {
  if (!currentId) return notify("Спочатку обери трек");
  if (!state.playlists.length) return notify("Спочатку створи плейлист");
  const options = state.playlists
    .map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`)
    .join("");
  openModal(
    "Додати в плейлист",
    "Збережи цю композицію у своїй добірці.",
    '<label class="field-label">ПЛЕЙЛИСТ</label><select class="field" id="player-target-playlist">' +
      options +
      "</select>",
    "Додати",
    async () => {
      const p = state.playlists.find(
          (item) => item.id === $("#player-target-playlist").value,
        ),
        track = state.tracks[currentId];
      if (!p || !track) {
        showModalError("Обери плейлист.");
        return false;
      }
      if ((p.trackIds || []).includes(currentId)) {
        showModalError("Цей трек уже є у плейлисті.");
        return false;
      }
      if (apiMode) {
        await apiRequest(`/api/playlists/${encodeURIComponent(p.id)}/tracks`, {
          method: "POST",
          body: JSON.stringify({
            videoId: currentId,
            title: track.title,
            channel: track.channel || "YouTube",
          }),
        });
        await loadPlaylistDetail(p.id);
      } else {
        p.trackIds.push(currentId);
        p.trackCount = p.trackIds.length;
        p.updated = Date.now();
      }
      save();
      render();
      if (currentPlaylist === p.id) renderDetail();
      notify(`Додано в «${p.name}»`);
    },
  );
}
function runPlayerAction(action) {
  if (action === "volume") {
    if (!apiReady || !ytPlayer) {
      playbackMessage =
        "Звук буде доступний після завантаження YouTube-плеєра.";
      renderPlayer();
      return;
    }
    const muted = togglePlayerAudio(ytPlayer);
    playbackMessage = muted
      ? "Звук вимкнено."
      : "Звук увімкнено на YouTube-плеєрі.";
    renderPlayer();
    return;
  }
  if (action === "favorite") {
    toggleFav(currentId);
    return;
  }
  if (action === "add-playlist") {
    addCurrentToPlaylist();
    return;
  }
  if (action === "next") {
    haptic();
    step(1);
    return;
  }
  if (action === "previous") {
    haptic();
    step(-1);
    return;
  }
  if (action === "shuffle") {
    haptic();
    shuffle = !shuffle;
    if (queueIndex >= 0) state.queue = shuffleUpcoming(state.queue, queueIndex);
    renderPlayer();
    return;
  }
  if (action === "repeat") {
    repeatMode =
      repeatMode === "off" ? "queue" : repeatMode === "queue" ? "one" : "off";
    renderPlayer();
    return;
  }
  if (action === "toggle") {
    haptic();
    if (!currentId) {
      notify("Обери композицію зі списку");
      return;
    }
    if (!directAudioMode && (!apiReady || !ytPlayer)) {
      playbackMessage =
        "Плеєр YouTube ще завантажується. Спробуй кнопку ще раз за мить.";
      renderPlayer();
      return;
    }
    if (directAudioMode && nativeAudio) {
      if (nativeAudio.paused) nativeAudio.play().catch(() => notify("Не вдалося відтворити аудіопотік."));
      else nativeAudio.pause();
    } else if (ytPlayer.getPlayerState() === 1) ytPlayer.pauseVideo();
    else if (loadedVideoId === currentId) ytPlayer.playVideo();
    else {
      loadedVideoId = currentId;
      ytPlayer.loadVideoById(currentId);
    }
  }
}
function isUnavailable(id) {
  return (
    unavailableIds.has(id) ||
    Boolean(
      state.tracks[id]?.availability &&
        state.tracks[id].availability !== "AVAILABLE",
    )
  );
}
function selectQueue(queue, index, isVibe = false) {
  state.queue = queue;
  queueIndex = index;
  vibeQueueActive = Boolean(isVibe && apiContext);
  vibeQueueLoading = false;
  vibeQueueAdvanceWhenReady = false;
  vibeQueueSeen = new Set(vibeQueueActive ? queue : []);
  currentId = null;
  if (index === null) {
    playbackMessage = "У черзі немає доступних для відтворення відео.";
    render();
    showView("player");
    return;
  }
  loadQueueIndex(index);
}
function loadQueueIndex(index) {
  const id = state.queue[index];
  if (!id) return;
  queueIndex = index;
  currentId = id;
  playerStreamRetries.delete(id);
  updateMediaSession();
  lastRecordedTrackId = null;
  autoplayRequested = true;
  playbackMessage = apiReady ? "" : "Завантажуємо офіційний YouTube плеєр…";
  render();
  showView("player");
  if (directAudioMode && nativeAudio) {
    nativeAudio.src = `/api/tracks/${encodeURIComponent(id)}/audio-stream`;
    nativeAudio.load();
    nativeAudio.play().catch(() => {
      playbackMessage = "Натисни ▶, щоб дозволити відтворення.";
      renderPlayer();
    });
    updateMediaSession();
  } else if (apiReady) {
    loadedVideoId = id;
    ytPlayer.loadVideoById(id);
  }
}
function playTrack(id, contextIds = null, isVibe = false) {
  if (!state.tracks[id]) return;
  const built = buildQueue(contextIds?.length ? contextIds : [id], id, shuffle);
  unavailableIds = new Set([
    ...unavailableIds,
    ...built.queue.filter(isUnavailable),
  ]);
  selectQueue(
    built.queue,
    firstPlayableIndex(built.queue, built.currentIndex, unavailableIds),
    isVibe,
  );
}
async function playPlaylist(id, shouldShuffle = false) {
  let p = state.playlists.find((x) => x.id === id);
  if (!p) return;
  if (apiMode && !(p.trackIds || []).length && trackCountOf(p) > 0) {
    try {
      await loadPlaylistDetail(id);
      p = state.playlists.find((x) => x.id === id);
    } catch (e) {
      notify(`Не вдалося завантажити плейлист: ${e.message}`);
      return;
    }
  }
  if (!p || !(p.trackIds || []).length) {
    notify("У плейлисті поки немає треків");
    return;
  }
  shuffle = shouldShuffle;
  const built = buildQueue(p.trackIds, null, shouldShuffle);
  unavailableIds = new Set([
    ...unavailableIds,
    ...built.queue.filter(isUnavailable),
  ]);
  selectQueue(
    built.queue,
    firstPlayableIndex(built.queue, built.currentIndex, unavailableIds),
  );
}
function step(dir, reason = "manual") {
  if (!state.queue.length) {
    notify("Черга порожня");
    return;
  }
  if (dir < 0 && ytPlayer && apiReady && ytPlayer.getCurrentTime() > 3) {
    ytPlayer.seekTo(0, true);
    return;
  }
  const index =
    dir > 0
      ? nextPlayableIndex(
          state.queue,
          queueIndex,
          unavailableIds,
          repeatMode,
          reason,
        )
      : previousPlayableIndex(
          state.queue,
          queueIndex,
          unavailableIds,
          repeatMode,
        );
  if (index === null) {
    if (dir > 0 && vibeQueueActive) {
      playbackMessage = "Шукаємо наступні треки для твого вайбу…";
      renderPlayer();
      void extendVibeQueue(true);
      return;
    }
    if (reason === "ended") playbackMessage = "Чергу завершено.";
    else
      notify(dir > 0 ? "Наступного треку немає" : "Попереднього треку немає");
    renderPlayer();
    return;
  }
  loadQueueIndex(index);
  if (dir > 0 && vibeQueueActive && state.queue.length - index <= 4) {
    void extendVibeQueue(false);
  }
}
async function extendVibeQueue(advanceAtEnd = false) {
  if (!vibeQueueActive || !apiContext) return;
  if (vibeQueueLoading) {
    if (advanceAtEnd) vibeQueueAdvanceWhenReady = true;
    return;
  }
  vibeQueueLoading = true;
  vibeQueueAdvanceWhenReady = advanceAtEnd;
  const activeQueue = state.queue;
  try {
    const exclude = [...vibeQueueSeen].slice(-500);
    const query = new URLSearchParams({ exclude: exclude.join(",") });
    const data = await apiRequest(`/api/vibe?${query}`);
    if (state.queue !== activeQueue || !vibeQueueActive) return;
    const incoming = Array.isArray(data?.tracks) ? data.tracks : [];
    const nextTracks = incoming.filter(
      (row) => row?.videoId && !vibeQueueSeen.has(row.videoId),
    );
    if (!nextTracks.length) {
      if (data?.hasMore) {
        playbackMessage = "Нові результати ще завантажуються. Натисни ▶|, щоб продовжити пошук.";
      } else {
        vibeQueueActive = false;
        playbackMessage = "Нові треки для цієї хвилі закінчилися. Онови добірку у вкладці «Вайб».";
      }
      renderPlayer();
      return;
    }
    updateVibeData({ ...data, tracks: nextTracks }, true);
    for (const row of nextTracks) {
      vibeQueueSeen.add(row.videoId);
      state.queue.push(row.videoId);
    }
    renderPlayer();
    if (vibeQueueAdvanceWhenReady) {
      const next = firstPlayableIndex(state.queue, queueIndex + 1, unavailableIds);
      if (next !== null) loadQueueIndex(next);
    }
  } catch (error) {
    playbackMessage = `Не вдалося поповнити чергу вайбу: ${error.message}`;
    renderPlayer();
  } finally {
    vibeQueueLoading = false;
    vibeQueueAdvanceWhenReady = false;
  }
}
function handlePlayerError(code) {
  const details = playerErrorDetails(code),
    id = currentId;
  console.error("YouTube player error", Number(code));
  if (id && !playerStreamRetries.has(id) && ytPlayer && apiReady) {
    playerStreamRetries.set(id, true);
    playbackMessage = "Оновлюємо потік треку…";
    notify("Потік тимчасово недоступний. Повторюю один раз.");
    renderPlayer();
    setTimeout(() => {
      if (currentId === id && ytPlayer) {
        loadedVideoId = id;
        ytPlayer.loadVideoById(id);
      }
    }, 450);
    return;
  }
  if (!details.skip) {
    playbackMessage = details.message;
    notify(details.message);
    renderPlayer();
    return;
  }
  if (id) {
    unavailableIds.add(id);
    if (state.tracks[id]) state.tracks[id].availability = "UNAVAILABLE";
  }
  playbackMessage = details.message;
  render();
  const next = nextPlayableIndex(
    state.queue,
    queueIndex,
    unavailableIds,
    repeatMode,
    "error",
  );
  if (next === null) {
    if (vibeQueueActive) {
      playbackMessage = "Шукаємо наступні треки для твого вайбу…";
      renderPlayer();
      void extendVibeQueue(true);
      return;
    }
    playbackMessage += ` У черзі немає інших доступних треків.`;
    renderPlayer();
    return;
  }
  setTimeout(() => loadQueueIndex(next), 900);
}
let lastRecordedTrackId = null;
function recordPlayback(id) {
  if (lastRecordedTrackId === id) return;
  lastRecordedTrackId = id;
  state.recent = [id, ...state.recent.filter((x) => x !== id)].slice(0, 30);
  save();
  render();
  if (apiMode)
    apiRequest("/api/history", {
      method: "POST",
      body: JSON.stringify({ videoId: id }),
    }).catch((error) =>
      notify(`Не вдалося зберегти історію: ${error.message}`),
    );
}
async function removePlaylistItem(playlistId, itemId, videoId) {
  const p = state.playlists.find((x) => x.id === playlistId);
  if (!p || !itemId) return;
  if (apiMode) {
    try {
      await apiRequest(
        `/api/playlists/${encodeURIComponent(playlistId)}/tracks/${encodeURIComponent(itemId)}`,
        { method: "DELETE" },
      );
    } catch (e) {
      notify(`Не вдалося прибрати трек: ${e.message}`);
      return;
    }
    await loadPlaylistDetail(playlistId);
  } else {
    p.trackIds = (p.trackIds || []).filter((id) => id !== videoId);
    p.trackCount = p.trackIds.length;
    p.updated = Date.now();
    delete p.itemIds?.[videoId];
  }
  save();
  render();
  if (currentPlaylist === playlistId) renderDetail();
  notify("Трек прибрано з плейлиста");
}
async function deletePlaylist(id) {
  const p = state.playlists.find((x) => x.id === id);
  if (!p) return;
  openModal(
    "Видалити плейлист",
    `«${p.name}» буде видалено з твоєї бібліотеки.`,
    '<div class="form-error">Цю дію не можна скасувати.</div>',
    "Видалити",
    async () => {
      if (apiMode)
        await apiRequest(`/api/playlists/${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
      state.playlists = state.playlists.filter((x) => x.id !== id);
      save();
      render();
      showView("library");
      notify("Плейлист видалено");
    },
  );
}
function renamePlaylist(id) {
  const p = state.playlists.find((x) => x.id === id);
  if (!p) return;
  openModal(
    "Перейменувати",
    "Обери нову назву плейлиста.",
    '<label class="field-label">НАЗВА</label><input class="field" id="playlist-name" maxlength="60" value="' +
      esc(p.name) +
      '">',
    "Зберегти",
    async () => {
      const n = $("#playlist-name").value.trim();
      if (!n) {
        notify("Назва не може бути порожня");
        return false;
      }
      if (apiMode)
        await apiRequest(`/api/playlists/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify({ name: n }),
        });
      p.name = n;
      p.updated = Date.now();
      save();
      render();
      renderDetail();
      notify("Назву оновлено");
    },
  );
}
async function syncPlaylist(id) {
  const p = state.playlists.find((x) => x.id === id);
  if (!p || !apiMode) return;
  p.syncStatus = "RUNNING";
  renderDetail();
  try {
    const r = await apiRequest(
      `/api/playlists/${encodeURIComponent(id)}/sync`,
      { method: "POST" },
    );
    await loadPlaylistDetail(id);
    render();
    renderDetail();
    notify(`Синхронізацію завершено · +${r.added} −${r.removed}`);
  } catch (e) {
    p.syncStatus = "FAILED";
    renderDetail();
    notify(`Помилка синхронізації: ${e.message}`);
  }
}
document.addEventListener("click", (e) => {
  const t = e.target.closest("button,[data-view],[data-playlist]");
  if (!t) return;
  if (t.dataset.view) {
    showView(t.dataset.view);
    if (t.dataset.view === "library") renderLibrary();
    return;
  }
  if (t.dataset.playerAction) {
    runPlayerAction(t.dataset.playerAction);
    return;
  }
  if (t.dataset.playlist) {
    openPlaylist(t.dataset.playlist);
    return;
  }
  if (t.dataset.vibeRefresh !== undefined) {
    void loadVibe(true);
    return;
  }
  if (t.dataset.vibePlay !== undefined) {
    const ids = (state.vibe?.tracks || [])
      .map((row) => row.videoId)
      .filter((id) => state.tracks[id]);
    if (!ids.length) {
      notify("Спочатку познач кілька улюблених треків");
      return;
    }
    playTrack(ids[0], ids, true);
    return;
  }
  if (t.dataset.searchAdd) {
    void saveSearchTrack(t.dataset.searchAdd, t.dataset.searchPlaylist);
    return;
  }
  if (
    t.dataset.action === "create" ||
    t.id === "create-button" ||
    t.id === "side-add"
  ) {
    createPlaylist();
    return;
  }
  if (t.dataset.action === "reload") {
    location.reload();
    return;
  }
  if (t.dataset.action === "add-track") {
    addTrackModal();
    return;
  }
  if (t.dataset.action === "import") {
    importModal();
    return;
  }
  if (t.dataset.track) {
    let context = [];
    try {
      context = JSON.parse(t.dataset.trackContext || "[]");
    } catch {
      /* Ignore malformed playlist context. */
    }
    playTrack(t.dataset.track, context);
    return;
  }
  if (t.dataset.favorite) {
    toggleFav(t.dataset.favorite);
    return;
  }
  if (t.dataset.playlistPlay) {
    playPlaylist(t.dataset.playlistPlay, false);
    return;
  }
  if (t.dataset.playlistShuffle) {
    playPlaylist(t.dataset.playlistShuffle, true);
    return;
  }
  if (t.dataset.bgListen) {
    openExternalUrl(t.dataset.bgListen);
    return;
  }
  if (t.dataset.addTo) {
    addTrackModal(t.dataset.addTo);
    return;
  }
  if (t.dataset.delete) {
    deletePlaylist(t.dataset.delete);
    return;
  }
  if (t.dataset.rename) {
    renamePlaylist(t.dataset.rename);
    return;
  }
  if (t.dataset.sync) {
    syncPlaylist(t.dataset.sync);
    return;
  }
  if (t.dataset.removeItem) {
    removePlaylistItem(
      currentPlaylist,
      t.dataset.removeItem,
      t.dataset.removeVideo,
    );
    return;
  }
  if (t.dataset.queueRemove) {
    const removedIndex = state.queue.indexOf(t.dataset.queueRemove);
    state.queue = state.queue.filter((id) => id !== t.dataset.queueRemove);
    if (removedIndex < queueIndex) queueIndex--;
    else if (removedIndex === queueIndex) {
      currentId = null;
      const next = firstPlayableIndex(
        state.queue,
        Math.max(0, queueIndex),
        unavailableIds,
      );
      if (next !== null) loadQueueIndex(next);
    }
    renderPlayer();
    return;
  }
  if (t.id === "hero-play") {
    const first = state.playlists.find((p) => trackCountOf(p) > 0);
    first
      ? void playPlaylist(first.id)
      : notify("Створи плейлист і додай до нього музику");
    return;
  }
  if (t.id === "now-fav" && currentId) {
    toggleFav(currentId);
    return;
  }
  if (t.id === "player-toggle") {
    haptic();
    if (!currentId) {
      notify("Обери композицію зі списку");
      return;
    }
    if (!directAudioMode && (!apiReady || !ytPlayer)) {
      playbackMessage =
        "Плеєр YouTube ще завантажується. Спробуй кнопку ще раз за мить.";
      renderPlayer();
      return;
    }
    if (directAudioMode && nativeAudio) {
      if (nativeAudio.paused) nativeAudio.play().catch(() => notify("Не вдалося відтворити аудіопотік."));
      else nativeAudio.pause();
    } else if (ytPlayer.getPlayerState() === 1) ytPlayer.pauseVideo();
    else if (loadedVideoId === currentId) ytPlayer.playVideo();
    else {
      loadedVideoId = currentId;
      ytPlayer.loadVideoById(currentId);
    }
    return;
  }
  if (t.id === "next") {
    haptic();
    step(1);
    return;
  }
  if (t.id === "previous") {
    haptic();
    step(-1);
    return;
  }
  if (t.id === "shuffle") {
    shuffle = !shuffle;
    if (queueIndex >= 0) state.queue = shuffleUpcoming(state.queue, queueIndex);
    renderPlayer();
    return;
  }
  if (t.id === "repeat") {
    repeatMode =
      repeatMode === "off" ? "queue" : repeatMode === "queue" ? "one" : "off";
    renderPlayer();
    return;
  }
  if (t.id === "queue-toggle") {
    showView("player");
    return;
  }
});
$("#search").addEventListener("input", renderLibrary);
$("#sort").addEventListener("change", renderLibrary);
$("#music-search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void searchMusic();
});
$("#music-search-playlist").addEventListener("change", renderMusicSearch);
window.addEventListener("luna:lang", renderMusicSearch);
function initializeYouTubePlayer() {
  const youtubeApi = window["YT"];
  if (ytPlayer || !youtubeApi?.Player) return;
  clearTimeout(playerApiTimer);
  ytPlayer = new youtubeApi.Player("youtube-player", {
    width: 1280,
    height: 720,
    playerVars: { playsinline: 1, origin: location.origin, controls: 0 },
    events: {
      onReady: () => {
        apiReady = true;
        if (currentId) {
          loadedVideoId = currentId;
          if (autoplayRequested) {
            ytPlayer.loadVideoById(currentId);
            playbackMessage = "Запускаємо обраний плейлист…";
          } else {
            ytPlayer.cueVideoById(currentId);
            playbackMessage = "Відео готове. Натисни ▶, щоб почати відтворення.";
          }
          autoplayRequested = false;
          renderPlayer();
        }
        setInterval(() => {
          renderVolumeControls();
          if (
            !ytPlayer ||
            !currentId ||
            ytPlayer.getPlayerState() !== youtubeApi.PlayerState.PLAYING
          )
            return;
          const duration = ytPlayer.getDuration() || 0,
            current = ytPlayer.getCurrentTime() || 0;
          $("#current-time").textContent = formatTime(current);
          $("#duration").textContent = duration ? formatTime(duration) : "LIVE";
          $("#progress-fill").style.width = duration
            ? `${Math.min(100, (current / duration) * 100)}%`
            : "0%";
        }, 1000);
      },
      onStateChange: (e) => {
        if (e.data === youtubeApi.PlayerState.ENDED) step(1, "ended");
        if (e.data === youtubeApi.PlayerState.PLAYING) {
          $("#player-toggle").textContent = "Ⅱ";
          playbackMessage = "Відтворюється через офіційний YouTube-плеєр.";
          updateMediaSession();
          renderPlayer();
          if (currentId) recordPlayback(currentId);
        } else if (e.data === youtubeApi.PlayerState.PAUSED) {
          $("#player-toggle").textContent = "▶";
          playbackMessage = "Відео на паузі.";
          updateMediaSession();
          renderPlayer();
        } else if (e.data === youtubeApi.PlayerState.ENDED) {
          $("#player-toggle").textContent = "▶";
          updateMediaSession();
        }
      },
      onError: (e) => handlePlayerError(e.data),
      onAutoplayBlocked: () => {
        playbackMessage =
          "Браузер заблокував запуск. Натисни ▶ у плеєрі, щоб відтворити відео.";
        renderPlayer();
      },
    },
  });
}
window.onYouTubeIframeAPIReady = initializeYouTubePlayer;
function failYouTubeApi() {
  if (apiReady) return;
  console.error("YouTube IFrame Player API failed to load");
  playbackMessage =
    "Не вдалося завантажити YouTube-плеєр. Перевір з’єднання та спробуй оновити Mini App.";
  renderPlayer();
}
function loadYouTubeIframeApi() {
  if (window["YT"]?.Player) {
    initializeYouTubePlayer();
    return;
  }
  const script = document.createElement("script");
  script.src = "https://www.youtube.com/iframe_api";
  script.async = true;
  script.dataset.youtubeIframeApi = "true";
  script.onerror = failYouTubeApi;
  playerApiTimer = setTimeout(failYouTubeApi, 15000);
  document.head.append(script);
}
loadYouTubeIframeApi();
function formatTime(seconds) {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden && ytPlayer && apiReady) ytPlayer.pauseVideo();
});
window.addEventListener("pagehide", () => {
  if (ytPlayer && apiReady) ytPlayer.pauseVideo();
});
document.addEventListener("error", (event) => {
  if (!(event.target instanceof HTMLImageElement)) return;
  const cover = event.target.closest(".track-cover, .mini-cover");
  if (cover) {
    cover.classList.add("image-fallback");
    event.target.remove();
  }
}, true);
function syncTelegramViewport() {
  const stableHeight = window.Telegram?.WebApp?.viewportStableHeight;
  if (stableHeight) document.documentElement.style.setProperty("--tg-viewport-stable-height", `${stableHeight}px`);
  else document.documentElement.style.removeProperty("--tg-viewport-stable-height");
}
window.Telegram?.WebApp?.onEvent?.("viewportChanged", syncTelegramViewport);
syncTelegramViewport();
render();
const initialView = new URLSearchParams(location.search).get("view");
if (["home", "library", "favorites", "recent", "vibe"].includes(initialView))
  showView(initialView);
