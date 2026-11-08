export function buildQueue(ids, startId = null, shouldShuffle = false, random = Math.random) {
  const queue = [...new Set(ids)];
  if (!queue.length) return { queue, currentIndex: -1 };
  const startIndex = startId == null ? 0 : Math.max(0, queue.indexOf(startId));
  const rotated = [...queue.slice(startIndex), ...queue.slice(0, startIndex)];
  if (!shouldShuffle) return { queue: rotated, currentIndex: 0 };
  const [current, ...upcoming] = rotated;
  return { queue: [current, ...shuffleList(upcoming, random)], currentIndex: 0 };
}

export function shuffleUpcoming(queue, currentIndex, random = Math.random) {
  if (currentIndex < 0 || currentIndex >= queue.length) return [...queue];
  return [...queue.slice(0, currentIndex + 1), ...shuffleList(queue.slice(currentIndex + 1), random)];
}

export function nextPlayableIndex(queue, currentIndex, unavailable = new Set(), repeatMode = 'off', reason = 'manual') {
  if (!queue.length) return null;
  const currentId = queue[currentIndex];
  if (reason === 'ended' && repeatMode === 'one' && currentId && !unavailable.has(currentId)) return currentIndex;
  for (let offset = 1; offset <= queue.length; offset++) {
    let index = currentIndex + offset;
    if (index >= queue.length) {
      if (repeatMode !== 'queue') return null;
      index %= queue.length;
    }
    if (!unavailable.has(queue[index])) return index;
  }
  return null;
}

export function previousPlayableIndex(queue, currentIndex, unavailable = new Set(), repeatMode = 'off') {
  if (!queue.length || currentIndex < 0) return null;
  for (let offset = 1; offset <= queue.length; offset++) {
    let index = currentIndex - offset;
    if (index < 0) {
      if (repeatMode !== 'queue') return null;
      index = (index % queue.length + queue.length) % queue.length;
    }
    if (!unavailable.has(queue[index])) return index;
  }
  return null;
}

export function firstPlayableIndex(queue, fromIndex, unavailable = new Set()) {
  for (let offset = 0; offset < queue.length; offset++) {
    const index = (fromIndex + offset) % queue.length;
    if (!unavailable.has(queue[index])) return index;
  }
  return null;
}

function shuffleList(items, random) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const target = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled;
}
