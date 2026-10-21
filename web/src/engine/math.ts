export const PI = Math.PI;
export const TAU = PI * 2;
export const DEG = PI / 180;

export type Vec3 = [number, number, number];

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const angDiff = (a: number, b: number) => {
  let d = (b - a) % TAU;
  if (d > PI) d -= TAU;
  if (d < -PI) d += TAU;
  return d;
};
export const normAng = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export const ease = {
  inOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  out: (t: number) => 1 - Math.pow(1 - t, 3),
  in2: (t: number) => t * t,
};

/** Repère caméra (droite, haut, avant) pour un yaw / pitch donnés. */
export function basis(yaw: number, pitch: number): { R: Vec3; U: Vec3; F: Vec3 } {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  return { F: [sy * cp, sp, -cy * cp], R: [cy, 0, sy], U: [-sy * sp, cp, cy * sp] };
}
export const dirOf = (yaw: number, pitch: number): Vec3 => [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
