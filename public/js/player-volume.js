export function togglePlayerAudio(player, fallbackVolume = 50) {
  const enableAudio = player.isMuted() || player.getVolume() === 0;
  if (!enableAudio) {
    player.mute();
    return true;
  }

  player.unMute();
  if (player.getVolume() === 0) player.setVolume(fallbackVolume);
  return false;
}
