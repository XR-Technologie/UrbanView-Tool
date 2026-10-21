import { basis } from './math';

export type Variant = 'low' | 'mid' | 'full';

export interface DrawCam { tex: WebGLTexture; yaw: number; pitch: number; t: number }

interface Entry { low: WebGLTexture | null; hi: WebGLTexture | null; ready: Promise<void>; t: number }

const VS = `#version 300 es
out vec2 vP;
void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2))*2.0-1.0;vP=p;gl_Position=vec4(p,0.0,1.0);}`;

/* Projection équirectangulaire calculée par pixel :
   rectiligne ↔ stéréographique (petite planète), fondu entre deux panoramas,
   flou de mouvement radial pendant les transitions. */
const FS = `#version 300 es
precision highp float;
in vec2 vP; out vec4 o;
uniform sampler2D uA,uB;
uniform vec3 uRA,uUA,uFA,uRB,uUB,uFB;
uniform float uTA,uTB,uAsp,uMix,uBlur,uStereo,uFlash;
const float PI=3.141592653589793;
vec3 ray(vec2 p,vec3 R,vec3 U,vec3 F,float t){
  vec2 q=p*vec2(uAsp,1.0)*t;
  vec3 c=normalize(vec3(q,-1.0));
  if(uStereo>0.0){vec2 s=q*0.5;float d=dot(s,s);vec3 st=vec3(2.0*s,d-1.0)/(1.0+d);c=normalize(mix(c,st,uStereo));}
  return R*c.x+U*c.y-F*c.z;
}
vec4 tap(sampler2D tx,vec3 d){
  vec2 uv=vec2(atan(d.x,-d.z)/(2.0*PI)+0.5,acos(clamp(d.y,-1.0,1.0))/PI);
  vec2 gx=dFdx(uv),gy=dFdy(uv);
  gx.x-=floor(gx.x+0.5);gy.x-=floor(gy.x+0.5);
  return textureGrad(tx,uv,gx,gy);
}
vec4 pano(sampler2D tx,vec2 p,vec3 R,vec3 U,vec3 F,float t){
  vec4 c=tap(tx,ray(p,R,U,F,t));
  if(uBlur>0.001){
    for(int i=1;i<8;i++){c+=tap(tx,ray(p*(1.0-uBlur*0.04*float(i)),R,U,F,t));}
    c/=8.0;
  }
  return c;
}
void main(){
  vec4 c=vec4(0.0);
  if(uMix<0.999) c=pano(uA,vP,uRA,uUA,uFA,uTA);
  if(uMix>0.001){vec4 b=pano(uB,vP,uRB,uUB,uFB,uTB);c=uMix<0.999?mix(c,b,uMix):b;}
  c.rgb+=uFlash;
  o=vec4(c.rgb,1.0);
}`;

const UNIFORMS = ['uA', 'uB', 'uRA', 'uUA', 'uFA', 'uRB', 'uUB', 'uFB', 'uTA', 'uTB', 'uAsp', 'uMix', 'uBlur', 'uStereo', 'uFlash'] as const;

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  readonly hiVariant: Variant;
  private prog: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private u = {} as Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;
  private aniso: EXT_texture_filter_anisotropic | null;
  private maxTex: number;
  private cache = new Map<string, Entry>();
  private pinned = new Set<string>();
  private maxCache: number;
  private disposed = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private urlFor: (media: string, v: Variant) => string,
    private onUpdate: () => void,
    opts: { mobile: boolean; hiRes: boolean },
  ) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 non supporté par ce navigateur');
    this.gl = gl;
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.hiVariant = !opts.hiRes ? 'low' : opts.mobile || this.maxTex < 8192 ? 'mid' : 'full';
    this.maxCache = opts.hiRes ? (opts.mobile ? 3 : 6) : 4;
    this.aniso = gl.getExtension('EXT_texture_filter_anisotropic');

    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'program');
    this.prog = p;
    for (const n of UNIFORMS) this.u[n] = gl.getUniformLocation(p, n);
    this.vao = gl.createVertexArray()!;
  }

  /** Charge un panorama : basse définition d'abord (résout la promesse), puis haute définition. */
  ensure(media: string): Promise<void> {
    let e = this.cache.get(media);
    if (!e) {
      const entry: Entry = { low: null, hi: null, t: performance.now(), ready: Promise.resolve() };
      entry.ready = this.upload(this.urlFor(media, 'low')).then(tex => {
        if (this.disposed) return;
        entry.low = tex;
        this.onUpdate();
        if (this.hiVariant === 'low') return;
        this.upload(this.urlFor(media, this.hiVariant)).then(hi => {
          if (this.disposed || this.cache.get(media) !== entry) { this.gl.deleteTexture(hi); return; }
          entry.hi = hi;
          this.onUpdate();
        }).catch(() => {});
      });
      entry.ready.catch(() => { if (this.cache.get(media) === entry) this.cache.delete(media); });
      this.cache.set(media, entry);
      e = entry;
      this.prune();
    }
    e.t = performance.now();
    return e.ready;
  }

  get(media: string): WebGLTexture | null {
    const e = this.cache.get(media);
    return e ? e.hi || e.low : null;
  }

  pin(list: string[]) { this.pinned = new Set(list); }

  private prune() {
    if (this.cache.size <= this.maxCache) return;
    const victims = [...this.cache.entries()].filter(([k]) => !this.pinned.has(k)).sort((a, b) => a[1].t - b[1].t);
    while (this.cache.size > this.maxCache && victims.length) {
      const [k, e] = victims.shift()!;
      this.cache.delete(k);
      e.ready.then(() => { if (e.low) this.gl.deleteTexture(e.low); if (e.hi) this.gl.deleteTexture(e.hi); }).catch(() => {});
    }
  }

  private async upload(url: string): Promise<WebGLTexture> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    let src: ImageBitmap | HTMLCanvasElement = await createImageBitmap(await res.blob());
    if (src.width > this.maxTex || src.height > this.maxTex) {
      const s = Math.min(this.maxTex / src.width, this.maxTex / src.height);
      const cv = document.createElement('canvas');
      cv.width = Math.round(src.width * s);
      cv.height = Math.round(src.height * s);
      const x = cv.getContext('2d')!;
      x.imageSmoothingQuality = 'high';
      x.drawImage(src, 0, 0, cv.width, cv.height);
      (src as ImageBitmap).close();
      src = cv;
    }
    if (this.disposed) throw new Error('disposed');
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (this.aniso) {
      gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(this.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    }
    if ('close' in src) src.close();
    return tex;
  }

  draw(A: DrawCam | null, B: DrawCam | null, mix: number, blur: number, stereo: number, flash: number) {
    const gl = this.gl, c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    gl.viewport(0, 0, w, h);
    if (!A) { gl.clearColor(0.02, 0.04, 0.08, 1); gl.clear(gl.COLOR_BUFFER_BIT); return; }
    const u = this.u;
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    const a = basis(A.yaw, A.pitch), b = B ? basis(B.yaw, B.pitch) : a;
    gl.uniform3fv(u.uRA, a.R); gl.uniform3fv(u.uUA, a.U); gl.uniform3fv(u.uFA, a.F);
    gl.uniform3fv(u.uRB, b.R); gl.uniform3fv(u.uUB, b.U); gl.uniform3fv(u.uFB, b.F);
    gl.uniform1f(u.uTA, A.t);
    gl.uniform1f(u.uTB, B ? B.t : A.t);
    gl.uniform1f(u.uAsp, w / h);
    gl.uniform1f(u.uMix, B ? mix : 0);
    gl.uniform1f(u.uBlur, blur);
    gl.uniform1f(u.uStereo, stereo);
    gl.uniform1f(u.uFlash, flash);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, A.tex); gl.uniform1i(u.uA, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, B ? B.tex : A.tex); gl.uniform1i(u.uB, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose() {
    this.disposed = true;
    for (const e of this.cache.values()) {
      if (e.low) this.gl.deleteTexture(e.low);
      if (e.hi) this.gl.deleteTexture(e.hi);
    }
    this.cache.clear();
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
