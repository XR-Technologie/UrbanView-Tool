import { Renderer, type Variant } from './Renderer';
import { DEG, PI, angDiff, basis, clamp, dirOf, dot, ease, lerp, normAng, smooth } from './math';

export interface View { yaw: number; pitch: number; fov: number }
export interface PanoOptions { urlFor: (media: string, v: Variant) => string; hiRes?: boolean; interactive?: boolean }
export interface TransitionOpts { toward?: { yaw: number; pitch: number }; style?: 'zoom' | 'fade'; duration?: number }

interface Trans { media: string; yaw: number; pitch: number; fov: number; zoomA: number; zoomB: number; mix: number; blur: number; flash: number }
interface Anim { t0: number; ms: number; fn: (t: number) => void; res: () => void }

const FOV_MIN = 30, FOV_MAX = 100, PMAX = 88 * DEG;

/** Visionneuse 360 : caméra, contrôles, transitions, projection des points. */
export class PanoView {
  readonly el: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  cam = { yaw: 0, pitch: 0, fov: 75, stereo: 0 };
  media: string | null = null;
  T: Trans | null = null;
  busy = false;
  autorotate = false;
  w = 1;
  h = 1;
  /** Fin d'une interaction (glisser / zoom), une fois l'inertie retombée. */
  onViewChange?: (v: View) => void;
  /** Clic sans glisser (coordonnées écran). */
  onTap?: (clientX: number, clientY: number) => void;
  onInteract?: () => void;

  private r: Renderer;
  private spin = false;
  private anims = new Set<Anim>();
  private subs = new Set<() => void>();
  private vel = { x: 0, y: 0 };
  private dirty = true;
  private sig = '';
  private raf = 0;
  private last = performance.now();
  private lastInteract = 0;
  private tok = 0;
  private emitAt = 0;
  private ro: ResizeObserver;
  private pointers = new Map<number, { x: number; y: number }>();
  private drag: { x: number; y: number; sx: number; sy: number; moved: boolean } | null = null;
  private pinch: { d: number; fov: number } | null = null;
  private lastMove = 0;
  private interactive: boolean;

  constructor(el: HTMLElement, opts: PanoOptions) {
    this.el = el;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'pano-canvas';
    el.appendChild(this.canvas);
    const mobile = matchMedia('(pointer:coarse)').matches;
    this.r = new Renderer(this.canvas, opts.urlFor, () => { this.dirty = true; }, { mobile, hiRes: opts.hiRes !== false });
    this.w = el.clientWidth || 1;
    this.h = el.clientHeight || 1;
    this.ro = new ResizeObserver(() => { this.w = el.clientWidth || 1; this.h = el.clientHeight || 1; this.dirty = true; });
    this.ro.observe(el);
    this.interactive = opts.interactive !== false;
    if (this.interactive) {
      el.addEventListener('pointerdown', this.onDown);
      el.addEventListener('pointermove', this.onMove);
      el.addEventListener('pointerup', this.onUp);
      el.addEventListener('pointercancel', this.onUp);
      el.addEventListener('wheel', this.onWheel, { passive: false });
    }
    this.raf = requestAnimationFrame(this.frame);
  }

  /* ---------- API ---------- */
  subscribe(fn: () => void) { this.subs.add(fn); return () => { this.subs.delete(fn); }; }
  requestRender() { this.dirty = true; }
  preload(media: string) { this.r.ensure(media).catch(() => {}); }
  getView(): View { return { yaw: normAng(this.cam.yaw), pitch: this.cam.pitch, fov: Math.round(this.cam.fov * 10) / 10 }; }
  clear() { this.tok++; this.media = null; this.T = null; this.dirty = true; }

  setView(v: View) {
    this.cam.yaw = v.yaw;
    this.cam.pitch = v.pitch;
    this.cam.fov = v.fov || 75;
    this.vel.x = this.vel.y = 0;
    this.dirty = true;
  }

  /** Affiche une scène instantanément. */
  async show(media: string, view: View) {
    const tok = ++this.tok;
    while (this.busy) {
      await new Promise(r => setTimeout(r, 40));
      if (tok !== this.tok) return;
    }
    this.r.pin([media]);
    try { await this.r.ensure(media); } catch { return; }
    if (tok !== this.tok) return;
    this.media = media;
    this.spin = false;
    this.cam.stereo = 0;
    this.setView(view);
  }

  animateTo(v: View, ms = 700) {
    if (this.busy) return Promise.resolve();
    const y0 = this.cam.yaw, p0 = this.cam.pitch, f0 = this.cam.fov, dy = angDiff(y0, v.yaw);
    this.vel.x = this.vel.y = 0;
    this.lastInteract = performance.now();
    return this.animate(ms, t => {
      const e = ease.inOut(t);
      this.cam.yaw = y0 + dy * e;
      this.cam.pitch = lerp(p0, v.pitch, e);
      this.cam.fov = lerp(f0, v.fov || f0, e);
    });
  }

  /** Transition immersive : rotation vers le point, plongée + fondu vers la scène suivante. */
  async transition(media: string, view: View, o: TransitionOpts = {}): Promise<boolean> {
    if (this.busy) return false;
    if (!this.media) { await this.show(media, view); return true; }
    this.busy = true;
    this.tok++;
    this.vel.x = this.vel.y = 0;
    this.r.pin([media, this.media]);
    const ready = this.r.ensure(media);
    if (o.toward) {
      const y0 = this.cam.yaw, p0 = this.cam.pitch, dy = angDiff(y0, o.toward.yaw), tp = clamp(o.toward.pitch * 0.4, -0.3, 0.3);
      const dist = Math.hypot(dy, tp - p0);
      if (dist > 0.04) {
        await this.animate(clamp(dist * 420, 260, 750), t => {
          const e = ease.inOut(t);
          this.cam.yaw = y0 + dy * e;
          this.cam.pitch = lerp(p0, tp, e);
        });
      }
    }
    try { await ready; } catch { this.busy = false; return false; }
    const fade = o.style === 'fade';
    const D = clamp(o.duration ?? 1.3, 0.4, 4) * 1000;
    const T: Trans = this.T = { media, yaw: view.yaw, pitch: view.pitch, fov: view.fov || 75, zoomA: 1, zoomB: 1, mix: 0, blur: 0, flash: 0 };
    await this.animate(D, u => {
      if (fade) {
        T.mix = ease.inOut(u);
        T.zoomA = 1 + 0.12 * u;
        T.zoomB = 1.12 - 0.12 * ease.out(u);
        T.blur = Math.sin(u * PI) * 0.3;
      } else {
        T.zoomA = 1 + 2.4 * ease.in2(u);
        T.mix = smooth(0.28, 0.78, u);
        T.zoomB = 1 + 0.85 * (1 - ease.out(u));
        T.blur = Math.pow(Math.sin(u * PI), 1.4);
        T.flash = Math.sin(u * PI) * 0.035;
      }
    });
    this.media = media;
    this.T = null;
    this.cam.stereo = 0;
    this.setView(view);
    this.busy = false;
    this.lastInteract = performance.now();
    return true;
  }

  /** Intro « petite planète » : vue du dessus qui tourne lentement. */
  planetPrep(view: View) {
    this.cam.stereo = 1;
    this.cam.pitch = -PI / 2;
    this.cam.fov = 150;
    this.cam.yaw = view.yaw - 1.4;
    this.spin = true;
    this.dirty = true;
  }

  async planetGo(view: View) {
    this.spin = false;
    this.busy = true;
    const y0 = this.cam.yaw, p0 = this.cam.pitch, f0 = this.cam.fov, dy = angDiff(y0, view.yaw);
    await this.animate(2800, t => {
      const e = ease.inOut(t);
      this.cam.stereo = 1 - ease.inOut(clamp(t * 1.15, 0, 1));
      this.cam.pitch = lerp(p0, view.pitch, e);
      this.cam.yaw = y0 + dy * e;
      this.cam.fov = lerp(f0, view.fov || 75, e);
    });
    this.cam.stereo = 0;
    this.busy = false;
    this.dirty = true;
    this.lastInteract = performance.now();
  }

  /** Position écran d'une direction, ou null si hors champ. */
  project(yaw: number, pitch: number) {
    if (this.cam.stereo > 0.02) return null;
    const t = Math.tan(this.cam.fov * DEG / 2) / (this.T ? this.T.zoomA : 1);
    const { R, U, F } = basis(this.cam.yaw, this.cam.pitch);
    const d = dirOf(yaw, pitch);
    const z = dot(d, F);
    if (z < 0.08) return null;
    const a = this.w / this.h;
    return {
      x: (dot(d, R) / z / (t * a) + 1) * 0.5 * this.w,
      y: (1 - dot(d, U) / z / t) * 0.5 * this.h,
      z,
      zoom: Math.tan(37.5 * DEG) / t,
    };
  }

  screenToDir(clientX: number, clientY: number) {
    const rc = this.el.getBoundingClientRect();
    const px = (clientX - rc.left) / rc.width * 2 - 1, py = 1 - (clientY - rc.top) / rc.height * 2;
    const t = Math.tan(this.cam.fov * DEG / 2);
    const { R, U, F } = basis(this.cam.yaw, this.cam.pitch);
    const qx = px * (rc.width / rc.height) * t, qy = py * t;
    const d = [0, 1, 2].map(i => R[i] * qx + U[i] * qy + F[i]);
    const l = Math.hypot(d[0], d[1], d[2]);
    return { yaw: Math.atan2(d[0] / l, -d[2] / l), pitch: Math.asin(d[1] / l) };
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.el.removeEventListener('pointerdown', this.onDown);
    this.el.removeEventListener('pointermove', this.onMove);
    this.el.removeEventListener('pointerup', this.onUp);
    this.el.removeEventListener('pointercancel', this.onUp);
    this.el.removeEventListener('wheel', this.onWheel);
    this.anims.forEach(a => a.res());
    this.anims.clear();
    this.subs.clear();
    this.r.dispose();
    this.canvas.remove();
  }

  /* ---------- interne ---------- */
  private animate(ms: number, fn: (t: number) => void) {
    return new Promise<void>(res => { this.anims.add({ t0: performance.now(), ms, fn, res }); });
  }

  private touch() {
    this.lastInteract = performance.now();
    this.onInteract?.();
  }

  private onDown = (e: PointerEvent) => {
    if (e.button > 0) return;
    if ((e.target as Element).closest?.('[data-hs]')) return;
    this.el.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.touch();
    if (this.pointers.size === 1) {
      this.drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false };
      this.vel.x = this.vel.y = 0;
      this.el.classList.add('grabbing');
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, fov: this.cam.fov };
      if (this.drag) this.drag.moved = true;
    }
  };

  private onMove = (e: PointerEvent) => {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.lastInteract = performance.now();
    if (this.busy) return;
    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      this.cam.fov = clamp(this.pinch.fov * this.pinch.d / (Math.hypot(a.x - b.x, a.y - b.y) || 1), FOV_MIN, FOV_MAX);
      return;
    }
    const d = this.drag;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    d.x = e.clientX;
    d.y = e.clientY;
    if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 5) d.moved = true;
    const k = this.cam.fov * DEG / this.h;
    this.cam.yaw -= dx * k;
    this.cam.pitch = clamp(this.cam.pitch + dy * k, -PMAX, PMAX);
    this.vel.x = this.vel.x * 0.4 + dx * k * 0.6;
    this.vel.y = this.vel.y * 0.4 + dy * k * 0.6;
    this.lastMove = performance.now();
  };

  private onUp = (e: PointerEvent) => {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.pointers.size > 0) return;
    this.el.classList.remove('grabbing');
    const d = this.drag;
    this.drag = null;
    if (d && !d.moved) {
      this.vel.x = this.vel.y = 0;
      this.onTap?.(e.clientX, e.clientY);
      return;
    }
    if (performance.now() - this.lastMove > 70) this.vel.x = this.vel.y = 0;
    this.emitAt = performance.now();
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (this.busy) return;
    this.cam.fov = clamp(this.cam.fov * (1 + e.deltaY * 0.0011), FOV_MIN, FOV_MAX);
    this.touch();
    this.emitAt = performance.now() + 250;
  };

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(50, now - this.last);
    this.last = now;
    for (const a of [...this.anims]) {
      const t = clamp((now - a.t0) / a.ms, 0, 1);
      a.fn(t);
      if (t >= 1) { this.anims.delete(a); a.res(); }
    }
    if (!this.busy && !this.drag) {
      if (Math.abs(this.vel.x) + Math.abs(this.vel.y) > 1e-5) {
        this.cam.yaw -= this.vel.x;
        this.cam.pitch = clamp(this.cam.pitch + this.vel.y, -PMAX, PMAX);
        this.vel.x *= 0.92;
        this.vel.y *= 0.92;
      } else {
        this.vel.x = this.vel.y = 0;
      }
      if (this.spin) this.cam.yaw += dt * 0.00012;
      else if (this.autorotate && this.media && now - this.lastInteract > 4000) {
        this.cam.yaw += dt * 0.00007;
        this.cam.pitch *= 0.998;
      }
      if (this.emitAt && now >= this.emitAt && !this.vel.x && !this.vel.y) {
        this.emitAt = 0;
        this.onViewChange?.(this.getView());
      }
    }
    const c = this.cam;
    const sig = `${c.yaw.toFixed(5)}|${c.pitch.toFixed(5)}|${c.fov.toFixed(3)}|${c.stereo.toFixed(4)}|${this.w}x${this.h}`;
    if (!this.dirty && !this.T && sig === this.sig) return;
    this.dirty = false;
    this.sig = sig;
    const A = this.media ? this.r.get(this.media) : null;
    const T = this.T;
    const B = T ? this.r.get(T.media) : null;
    this.r.draw(
      A ? { tex: A, yaw: c.yaw, pitch: c.pitch, t: Math.tan(c.fov * DEG / 2) / (T ? T.zoomA : 1) } : null,
      T && B ? { tex: B, yaw: T.yaw, pitch: T.pitch, t: Math.tan(T.fov * DEG / 2) / T.zoomB } : null,
      T ? T.mix : 0, T ? T.blur : 0, c.stereo, T ? T.flash : 0,
    );
    this.subs.forEach(f => f());
  };
}
