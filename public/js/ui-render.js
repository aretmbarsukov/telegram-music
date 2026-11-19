export function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

export function createNotifier(element, getTimer, setTimer) {
  return (message) => {
    if (!element) return;
    element.textContent = message;
    element.classList.add("show");
    clearTimeout(getTimer());
    setTimer(setTimeout(() => element.classList.remove("show"), 2600));
  };
}
