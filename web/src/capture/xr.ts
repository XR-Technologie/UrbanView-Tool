/**
 * Suivi AR (WebXR « immersive-ar », Chrome Android + ARCore).
 * Fournit à chaque image : le point visé au sol (hit-test), la position et la direction du téléphone.
 * Dessine des anneaux au sol (points relevés, réticule) par-dessus la caméra.
 */

export type V3 = [number, number, number];

export interface Ring { p: V3; r: number; color: [number, number, number, number] }

export interface FrameInfo {
  /** Point du sol visé par le centre de l'écran (repère local de la session). */
  floor: V3 | null;
  /** Position du téléphone. */
  pos: V3 | null;
  /** Direction de visée du téléphone (vecteur unitaire). */
  fwd: V3 | null;
  /** false = suivi perdu (position estimée). */
  tracking: boolean;
}

/** Applique un quaternion (x, y, z, w) à un vecteur. */
export function rotateByQuat(q: { x: number; y: number; z: number; w: number }, v: V3): V3 {
  const { x, y, z, w } = q;
  const ix = w * v[0] + y * v[2] - z * v[1];
  const iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0];
  const iw = -x * v[0] - y * v[1] - z * v[2];
  return [
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x,
  ];
}

export async function arSupported() {
  try { return !!navigator.xr && await navigator.xr.isSessionSupported('immersive-ar'); } catch { return false; }
}

const VS = `
attribute vec2 a;
uniform mat4 proj, view;
uniform vec3 center;
uniform float radius;
void main() { gl_Position = proj * view * vec4(center + vec3(a.x * radius, 0.0, a.y * radius), 1.0); }`;
const FS = `
precision mediump float;
uniform vec4 color;
void main() { gl_FragColor = color; }`;

export class ArTracker {
  rings: Ring[] = [];
  onFrame: (f: FrameInfo) => void = () => {};
  onEnd: () => void = () => {};

  private constructor(
    private session: XRSession,
    private gl: WebGLRenderingContext,
    private space: XRReferenceSpace,
    private hitSource: XRHitTestSource | null,
    private prog: WebGLProgram,
    private ringVerts: number,
  ) {
    session.addEventListener('end', () => this.onEnd());
    session.requestAnimationFrame(this.frame);
  }

  static async start(overlay: HTMLElement): Promise<ArTracker> {
    const xr = navigator.xr;
    if (!xr) throw new Error('Réalité augmentée indisponible');
    const session = await xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root: overlay },
    } as XRSessionInit);
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl', { xrCompatible: true, alpha: true, antialias: true }) as WebGLRenderingContext | null;
      if (!gl) throw new Error('WebGL indisponible');
      await session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });
      const space = await session.requestReferenceSpace('local');
      const viewer = await session.requestReferenceSpace('viewer');
      const hitSource = (await session.requestHitTestSource?.({ space: viewer })) ?? null;

      const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
      const prog = gl.createProgram()!;
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      // anneau : bande de triangles entre r = 0.78 et r = 1
      const N = 48, v: number[] = [];
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
        v.push(c, s, c * 0.78, s * 0.78);
      }
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
      return new ArTracker(session, gl, space, hitSource, prog, (N + 1) * 2);
    } catch (e) {
      await session.end().catch(() => {});
      throw e;
    }
  }

  end() { return this.session.end().catch(() => {}); }

  private frame = (_t: number, frame: XRFrame) => {
    const { session, gl, space, prog } = this;
    session.requestAnimationFrame(this.frame);
    const layer = session.renderState.baseLayer!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const pose = frame.getViewerPose(space);
    let floor: V3 | null = null;
    if (this.hitSource) {
      for (const h of frame.getHitTestResults(this.hitSource)) {
        const p = h.getPose(space);
        if (!p) continue;
        const n = rotateByQuat(p.transform.orientation, [0, 1, 0]);
        if (n[1] < 0.8) continue; // surfaces horizontales seulement (sol)
        const q = p.transform.position;
        floor = [q.x, q.y, q.z];
        break;
      }
    }

    if (pose) {
      gl.useProgram(prog);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      const loc = gl.getAttribLocation(prog, 'a');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      const uProj = gl.getUniformLocation(prog, 'proj'), uView = gl.getUniformLocation(prog, 'view');
      const uC = gl.getUniformLocation(prog, 'center'), uR = gl.getUniformLocation(prog, 'radius'), uCol = gl.getUniformLocation(prog, 'color');
      const rings = floor ? [...this.rings, { p: floor, r: 0.12, color: [1, 1, 1, 0.95] as Ring['color'] }] : this.rings;
      for (const view of pose.views) {
        const vp = layer.getViewport(view)!;
        gl.viewport(vp.x, vp.y, vp.width, vp.height);
        gl.uniformMatrix4fv(uProj, false, view.projectionMatrix);
        gl.uniformMatrix4fv(uView, false, view.transform.inverse.matrix);
        for (const r of rings) {
          gl.uniform3fv(uC, r.p);
          gl.uniform1f(uR, r.r);
          gl.uniform4fv(uCol, r.color);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, this.ringVerts);
        }
      }
    }

    const t = pose?.transform;
    this.onFrame({
      floor,
      pos: t ? [t.position.x, t.position.y, t.position.z] : null,
      fwd: t ? rotateByQuat(t.orientation, [0, 0, -1]) : null,
      tracking: !!pose && !pose.emulatedPosition,
    });
  };
}

/* ------------------------------------------------------------------ */
/* Boussole (indicative) : cap de la direction de visée du téléphone    */
/* ------------------------------------------------------------------ */

interface OrientationSensorLike extends EventTarget { quaternion: number[] | null; start(): void; stop(): void }
declare const AbsoluteOrientationSensor: { new (o?: { frequency?: number; referenceFrame?: string }): OrientationSensorLike } | undefined;

/** Démarre la boussole ; renvoie une fonction qui donne le cap actuel de la visée (ou null). */
export function startCompass(): { heading: () => number | null; stop: () => void } {
  try {
    if (typeof AbsoluteOrientationSensor === 'undefined') throw 0;
    const s = new AbsoluteOrientationSensor({ frequency: 20 });
    s.addEventListener('error', () => {});
    s.start();
    return {
      heading: () => {
        const q = s.quaternion;
        if (!q) return null;
        // repère Terre : x = est, y = nord, z = haut ; la caméra arrière regarde vers −z de l'appareil
        const v = rotateByQuat({ x: q[0], y: q[1], z: q[2], w: q[3] }, [0, 0, -1]);
        if (Math.hypot(v[0], v[1]) < 0.5) return null; // téléphone trop incliné
        return ((Math.atan2(v[0], v[1]) * 180) / Math.PI + 360) % 360;
      },
      stop: () => s.stop(),
    };
  } catch {
    return { heading: () => null, stop: () => {} };
  }
}
