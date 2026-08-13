const assert = require("node:assert/strict");
const test = require("node:test");
const {
  advanceRunPosition,
  chooseRunDirection,
  createRunTrack,
  runSpeedPxPerSecond,
  scaledRunDistance
} = require("../app/run-movement");

test("left and right cover the same distance for the same elapsed time", () => {
  const speed = runSpeedPxPerSecond(420);
  const elapsedSeconds = [0.016, 0.041, 0.008, 0.033, 0.052, 0.019]
    .reduce((total, elapsed) => total + elapsed, 0);
  const distance = speed * elapsedSeconds;
  const right = advanceRunPosition(500, 1, distance, 0, 1000);
  const left = advanceRunPosition(500, -1, distance, 0, 1000);

  assert.ok(Math.abs((right.x - 500) - (500 - left.x)) < 1e-9);
});

test("a run started near an edge still gets a full stable track", () => {
  const x = 1476;
  const minX = 0;
  const maxX = 1500;
  const direction = chooseRunDirection(x, minX, maxX);
  const track = createRunTrack(x, direction, minX, maxX, scaledRunDistance(420));

  assert.equal(direction, -1);
  assert.deepEqual(track, { minX: 1126, maxX: 1476 });
});

test("endpoint overshoot is reflected without losing distance", () => {
  const movement = advanceRunPosition(99, 1, 4, 0, 100);

  assert.equal(movement.x, 97);
  assert.equal(movement.direction, -1);
});

test("a long run reverses only at track endpoints", () => {
  const track = { minX: 1126, maxX: 1476 };
  let x = track.maxX;
  let direction = -1;
  let reversals = 0;
  const distancePerTick = runSpeedPxPerSecond(420) * 0.016;

  for (let tick = 0; tick < 625; tick += 1) {
    const movement = advanceRunPosition(x, direction, distancePerTick, track.minX, track.maxX);
    if (movement.direction !== direction) reversals += 1;
    x = movement.x;
    direction = movement.direction;
  }

  assert.equal(reversals, 2);
  assert.ok(x >= track.minX && x <= track.maxX);
});
