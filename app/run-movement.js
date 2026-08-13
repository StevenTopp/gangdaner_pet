const RUN_DISTANCE_AT_420_PX = 350;
const RUN_SPEED_AT_420_PX = 2800 / 30;
const MIN_RUN_SPEED_PX_PER_SECOND = 700 / 30;

function scaledRunDistance(sizePx) {
  return RUN_DISTANCE_AT_420_PX * (sizePx / 420);
}

function runSpeedPxPerSecond(sizePx) {
  return Math.max(MIN_RUN_SPEED_PX_PER_SECOND, RUN_SPEED_AT_420_PX * (sizePx / 420));
}

function chooseRunDirection(x, minX, maxX) {
  return maxX - x >= x - minX ? 1 : -1;
}

function createRunTrack(x, direction, minX, maxX, distance) {
  const screenSpan = Math.max(0, maxX - minX);
  const span = Math.min(Math.max(0, distance), screenSpan);
  const startX = Math.min(maxX, Math.max(minX, x));

  if (direction === 1) {
    const right = Math.min(maxX, startX + span);
    return { minX: right - span, maxX: right };
  }

  const left = Math.max(minX, startX - span);
  return { minX: left, maxX: left + span };
}

function advanceRunPosition(x, direction, distance, minX, maxX) {
  if (maxX <= minX || distance <= 0) return { x: minX, direction, reversed: false };

  let nextX = x + direction * distance;
  let nextDirection = direction;
  let reversed = false;

  // Reflect any overshoot instead of discarding it. This keeps both directions
  // at exactly the same speed, including the ticks that cross an endpoint.
  while (nextX > maxX || nextX < minX) {
    if (nextX > maxX) {
      nextX = maxX - (nextX - maxX);
      nextDirection = -1;
    } else {
      nextX = minX + (minX - nextX);
      nextDirection = 1;
    }
    reversed = true;
  }

  return { x: nextX, direction: nextDirection, reversed };
}

module.exports = {
  advanceRunPosition,
  chooseRunDirection,
  createRunTrack,
  runSpeedPxPerSecond,
  scaledRunDistance
};
