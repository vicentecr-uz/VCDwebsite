export type Vec = { x: number; y: number };
export type Bounds = { min: number; x: number; y: number };

/** Lens release — decided from /proto/lens-momentum
 *  Direction: cubic ease-out coast, bumper wall (spring foam + slap at the stops)
 *  friction 10/s, threshold 150 px/s, stiffness 240, restitution 0.4
 *  Rejected: exponential cutoff (kinked at 0); linear slide; clamp wall (dumped leftover speed); spring-only (no slap) */
export const LENS_INERTIA = {
  friction: 10,
  threshold: 150,
  stiffness: 240,
  restitution: 0.4,
  speed: 1,
};

export function speedOf(velocity: Vec) {
  return Math.hypot(velocity.x, velocity.y);
}

export function direction(velocity: Vec): Vec {
  const speed = speedOf(velocity);
  if (speed <= 0) return { x: 0, y: 0 };
  return { x: velocity.x / speed, y: velocity.y / speed };
}

export function createEaseOut(initial: Vec, friction = LENS_INERTIA.friction) {
  const start = speedOf(initial);
  const heading = direction(initial);
  let t = 0;
  return {
    step(dt: number, nextFriction = friction) {
      const duration = 3 / Math.max(0.05, nextFriction);
      t += dt / duration;
      if (t >= 1 || start <= 0) return { velocity: { x: 0, y: 0 }, done: true };
      const remain = 1 - t;
      const speed = start * remain * remain;
      return { velocity: { x: heading.x * speed, y: heading.y * speed }, done: speed < 0.05 };
    },
  };
}

export function inWall(position: Vec, bounds: Bounds) {
  const slop = 0.4;
  return (
    position.x < bounds.min - slop ||
    position.x > bounds.x + slop ||
    position.y < bounds.min - slop ||
    position.y > bounds.y + slop
  );
}

function integrateAxis(
  pos: number,
  vel: number,
  min: number,
  max: number,
  dt: number,
  reach: number,
  stiffness: number,
  damping: number,
  restitution: number,
) {
  const edge = Math.max(min, Math.min(max, pos));
  const pen = pos - edge;
  if (pen === 0) return { pos: pos + vel * dt, vel };
  vel += (-stiffness * pen - damping * vel) * dt;
  pos += vel * dt;
  const nextEdge = Math.max(min, Math.min(max, pos));
  const nextPen = pos - nextEdge;
  if (Math.abs(nextPen) > reach) {
    pos = nextEdge + Math.sign(nextPen) * reach;
    if (vel * nextPen > 0) vel = -vel * restitution;
  }
  return { pos, vel };
}

export function stepContact(
  position: Vec,
  velocity: Vec,
  dt: number,
  bounds: Bounds,
  reach: number,
  stiffness = LENS_INERTIA.stiffness,
  restitution = LENS_INERTIA.restitution,
) {
  const k = Math.max(1, stiffness);
  const damping = 2 * Math.sqrt(k) * 0.52;
  const steps = Math.max(1, Math.ceil(dt / 0.006));
  const h = dt / steps;
  let pos = { ...position };
  let vel = { ...velocity };
  for (let i = 0; i < steps; i++) {
    const x = integrateAxis(pos.x, vel.x, bounds.min, bounds.x, h, reach, k, damping, restitution);
    const y = integrateAxis(pos.y, vel.y, bounds.min, bounds.y, h, reach, k, damping, restitution);
    pos = { x: x.pos, y: y.pos };
    vel = { x: x.vel, y: y.vel };
  }
  return { position: pos, velocity: vel };
}
