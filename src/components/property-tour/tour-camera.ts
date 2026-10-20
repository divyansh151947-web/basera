import { easeInOutCubic, lerp } from "./tour-env";
import { CAMERA_PRESETS } from "./tour-types";
import type { CameraPreset, TourLocationId, TourVec3 } from "./tour-types";

/**
 * Cinematic camera flight controller (framework-free, deterministic).
 * Interpolates position + look-target with easing and a gentle vertical arc
 * (architectural dolly feel, never shake). Reduced-motion callers pass
 * durationMs 0 for instant jumps. Fully unit-testable with a fake clock.
 */

export interface Flight {
  from: CameraPreset;
  to: CameraPreset;
  durationMs: number;
  elapsedMs: number;
  arcHeight: number;
  done: boolean;
}

export function startFlight(from: CameraPreset, toId: TourLocationId, durationMs: number): Flight {
  return { from, to: CAMERA_PRESETS[toId], durationMs: Math.max(0, durationMs), elapsedMs: 0, arcHeight: 0.9, done: durationMs <= 0 };
}

export function stepFlight(flight: Flight, deltaMs: number): { pos: TourVec3; look: TourVec3; done: boolean } {
  if (flight.done || flight.durationMs <= 0) {
    flight.done = true;
    return { pos: { ...flight.to.pos }, look: { ...flight.to.look }, done: true };
  }
  flight.elapsedMs += deltaMs;
  const t = easeInOutCubic(flight.elapsedMs / flight.durationMs);
  const arc = Math.sin(Math.min(1, flight.elapsedMs / flight.durationMs) * Math.PI) * flight.arcHeight;
  const pos = {
    x: lerp(flight.from.pos.x, flight.to.pos.x, t),
    y: lerp(flight.from.pos.y, flight.to.pos.y, t) + arc,
    z: lerp(flight.from.pos.z, flight.to.pos.z, t),
  };
  const look = {
    x: lerp(flight.from.look.x, flight.to.look.x, t),
    y: lerp(flight.from.look.y, flight.to.look.y, t),
    z: lerp(flight.from.look.z, flight.to.look.z, t),
  };
  if (flight.elapsedMs >= flight.durationMs) {
    flight.done = true;
    return { pos: { ...flight.to.pos }, look: { ...flight.to.look }, done: true };
  }
  return { pos, look, done: false };
}

export const FLIGHT_MS = 2800;
export const DOOR_DOLLY_MS = 4000;
