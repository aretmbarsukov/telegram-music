export function updateMediaSession({ navigatorRef, track, playlistName, playerState, haptic, step, seek }) {
  if (!("mediaSession" in navigatorRef)) return;
  if (!track) {
    navigatorRef.mediaSession.metadata = null;
    return;
  }
  let artwork = [];
  try {
    const url = new URL(track.thumbnail);
    if (["https:", "http:"].includes(url.protocol)) artwork = [{ src: url.href, sizes: "512x512", type: "image/jpeg" }];
  } catch { /* Artwork is optional. */ }
  if (typeof MediaMetadata !== "undefined") {
    navigatorRef.mediaSession.metadata = new MediaMetadata({
      title: track.title || "YouTube track",
      artist: track.channel || "YouTube",
      album: playlistName || "Luna",
      artwork,
    });
  }
  navigatorRef.mediaSession.playbackState = playerState === 1 ? "playing" : "paused";
  const setHandler = (action, handler) => {
    try { navigatorRef.mediaSession.setActionHandler(action, handler); } catch { /* Unsupported action. */ }
  };
  setHandler("play", () => haptic());
  setHandler("pause", () => haptic());
  setHandler("previoustrack", () => { haptic(); step(-1); });
  setHandler("nexttrack", () => { haptic(); step(1); });
  setHandler("seekto", (details) => {
    if (Number.isFinite(details.seekTime)) { seek(details.seekTime); haptic(); }
  });
}
