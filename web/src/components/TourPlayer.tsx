import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { PanoView } from '../engine/PanoView';
import { arrivalFor, mediaUrl, sceneById, startSceneOf, type Hotspot, type InfoHotspot, type Scene, type TourDoc } from '../types';
import { HotspotLayer } from './HotspotLayer';
import { Icon } from './Icon';
import { UrbanviewInline, UrbanviewLogo } from './Logo';

/** Lecteur public (page /tour/:id et export autonome). */
export function TourPlayer({ tour, mediaBase }: { tour: TourDoc; mediaBase: string }) {
  const data = tour.data;
  const st = data.settings;
  const glRef = useRef<HTMLDivElement>(null);
  const [pv, setPv] = useState<PanoView | null>(null);
  const [sceneId, setSceneId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [started, setStarted] = useState(false);
  const [strip, setStrip] = useState(false);
  const [info, setInfo] = useState<InfoHotspot | null>(null);
  const [rotate, setRotate] = useState(st.autorotate);
  const [copied, setCopied] = useState(false);
  const scene = sceneById(data, sceneId);

  useEffect(() => {
    const v = new PanoView(glRef.current!, { urlFor: (m, va) => mediaUrl(mediaBase, m, va) });
    v.onInteract = () => setInfo(null);
    setPv(v);
    document.title = tour.title;
    const first = sceneById(data, decodeURIComponent(location.hash.slice(1))) ?? startSceneOf(data);
    if (first) {
      v.show(first.media, first.view).then(() => {
        if (st.intro) v.planetPrep(first.view);
        setSceneId(first.id);
        setReady(true);
      });
    }
    return () => v.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (pv) pv.autorotate = started && rotate; }, [pv, started, rotate]);

  // Pré-chargement des scènes voisines
  useEffect(() => {
    if (!pv || !scene) return;
    const t = setTimeout(() => {
      for (const h of scene.hotspots) {
        const s = h.type === 'link' ? sceneById(data, h.target) : null;
        if (s) pv.preload(s.media);
      }
    }, 600);
    return () => clearTimeout(t);
  }, [pv, scene, data]);

  const start = async () => {
    setStarted(true);
    if (st.intro && pv && scene) await pv.planetGo(scene.view);
  };

  const goTo = async (target: Scene, h?: Hotspot) => {
    if (!pv || !scene || pv.busy || target.id === scene.id) return;
    setInfo(null);
    const view = h && h.type === 'link' ? arrivalFor(data, scene.id, h) : target.view;
    const ok = await pv.transition(target.media, view, { toward: h, style: st.transition, duration: st.duration });
    if (ok) {
      setSceneId(target.id);
      try { history.replaceState(null, '', '#' + target.id); } catch { /* file:// */ }
    }
  };

  const activate = (h: Hotspot) => {
    if (h.type === 'info') { setInfo(h); return; }
    const t = sceneById(data, h.target);
    if (t) goTo(t, h);
  };

  const share = async () => {
    const url = location.href;
    if (navigator.share && matchMedia('(pointer:coarse)').matches) { navigator.share({ title: tour.title, url }).catch(() => {}); return; }
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* refusé */ }
  };

  const fullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };

  return (
    <div className="player" style={{ '--accent': st.accent } as CSSProperties}>
      <div className="pano-wrap">
        <div className="pano-gl" ref={glRef} />
        {scene && <HotspotLayer pv={pv} hotspots={scene.hotspots} onActivate={activate} />}
      </div>

      <div className={'pl-ui' + (started ? ' on' : '')}>
        <div className="pl-brand">{st.logo ? <img src={st.logo} alt={tour.title} /> : <UrbanviewInline />}</div>

        <div className="pl-actions">
          {st.ctaLabel && <a className="pl-cta" href={st.ctaUrl || undefined} target="_blank" rel="noopener">{st.ctaLabel}</a>}
          <div className="pl-tools glass">
            {data.scenes.length > 1 && (
              <button className={strip ? 'on' : ''} onClick={() => setStrip(s => !s)} title="Espaces"><Icon n="grid" /></button>
            )}
            <button className={rotate ? 'on' : ''} onClick={() => setRotate(r => !r)} title="Rotation"><Icon n="rotate" /></button>
            <button onClick={share} title="Partager"><Icon n={copied ? 'check' : 'share'} /></button>
            <button onClick={fullscreen} title="Plein écran"><Icon n="expand" /></button>
          </div>
        </div>

        <div className={'pl-strip glass' + (strip ? ' open' : '')}>
          {data.scenes.map(s => (
            <button key={s.id} className={s.id === sceneId ? 'on' : ''} onClick={() => goTo(s)}>
              <img src={mediaUrl(mediaBase, s.media, 'thumb', s.thumbV)} alt="" draggable={false} />
              <span>{s.name}</span>
            </button>
          ))}
        </div>

        <div className={'pl-info glass' + (info ? ' open' : '')}>
          {info && (
            <>
              <button className="ibtn pl-x" onClick={() => setInfo(null)}><Icon n="close" /></button>
              <h3>{info.title}</h3>
              {info.text && <p>{info.text}</p>}
              {info.url && <a className="btn pri" href={info.url} target="_blank" rel="noopener"><Icon n="external" />Ouvrir</a>}
            </>
          )}
        </div>
      </div>

      <div className={'pl-intro' + (started ? ' gone' : '')}>
        {st.logo ? <img className="pl-intro-logo" src={st.logo} alt="" /> : <UrbanviewLogo size={220} />}
        <button className="pl-enter" disabled={!ready} onClick={start}>
          {ready ? <><Icon n="play" />Entrer</> : <span className="spinner sm" />}
        </button>
      </div>
    </div>
  );
}
