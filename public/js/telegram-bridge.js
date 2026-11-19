export function initializeTelegramWebApp(webApp) {
  if (!webApp) return null;
  webApp.ready?.();
  webApp.expand?.();
  webApp.disableVerticalSwipes?.();
  return webApp;
}

export function haptic(webApp, kind = "light") {
  try { webApp?.HapticFeedback?.impactOccurred?.(kind); } catch { /* Optional. */ }
}

export function updateBackButton(webApp, name, onBack) {
  const backButton = webApp?.BackButton;
  if (!backButton) return;
  if (name === "home") {
    backButton.hide();
    return;
  }
  backButton.offClick?.(onBack);
  backButton.onClick?.(onBack);
  backButton.show();
}
