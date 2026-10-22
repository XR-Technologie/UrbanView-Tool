import { useState, type ReactNode } from 'react';
import type { PanoView } from '../engine/PanoView';
import { Icon } from '../components/Icon';
import { MiniPano } from '../components/MiniPano';
import {
  arrivalFor, isLink, mediaUrl, sceneById,
  type Geo, type InfoHotspot, type LinkHotspot, type Scene, type TourData, type TourSettings,
} from '../types';

export const URL_FOR = (m: string, v: string) => mediaUrl('/media', m, v);
export const thumbOf = (s: Scene) => mediaUrl('/media', s.media, 'thumb', s.thumbV);

export function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return <div className="field"><label>{label}</label>{children}</div>;
}

export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <span>{label}</span>
      <input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} />
      <i />
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* Lien entre deux scènes : destination + vue d'arrivée propre au lien */
/* ------------------------------------------------------------------ */
export function LinkPanel({ data, scene, h, edit, onDelete, onTest, onBacklink }: {
  data: TourData;
  scene: Scene;
  h: LinkHotspot;
  edit: (fn: (h: LinkHotspot) => void) => void;
  onDelete: () => void;
  onTest: () => void;
  onBacklink: () => void;
}) {
  const [ver, setVer] = useState(0);
  const others = data.scenes.filter(s => s.id !== scene.id);
  const target = sceneById(data, h.target);
  const hasBack = !!target?.hotspots.some(x => isLink(x) && x.target === scene.id);

  return (
    <>
      <div className="insp-head">
        <span className="insp-ic"><Icon n="ring" /></span>
        <b>Lien</b>
        <div className="grow" />
        <button className="ibtn danger" title="Supprimer (Suppr)" onClick={onDelete}><Icon n="trash" /></button>
      </div>

      <section className="insp-sec">
        <div className="insp-h">Destination</div>
        {others.length ? (
          <div className="tgrid">
            {others.map(o => (
              <button
                key={o.id}
                className={o.id === h.target ? 'on' : ''}
                title={o.name}
                onClick={() => { edit(x => { x.target = o.id; x.arrival = null; }); setVer(v => v + 1); }}
              >
                <img src={thumbOf(o)} alt="" draggable={false} />
                <span>{o.name}</span>
              </button>
            ))}
          </div>
        ) : <p className="muted sm">Ajoutez une autre photo 360°.</p>}
      </section>

      {target && (
        <section className="insp-sec">
          <div className="insp-h">
            Vue d'arrivée
            {!h.arrival && <span className="tag">{hasBack ? 'Auto · alignée' : 'Auto'}</span>}
            <div className="grow" />
            {h.arrival && (
              <button className="ibtn sm" title="Revenir en automatique" onClick={() => { edit(x => { x.arrival = null; }); setVer(v => v + 1); }}>
                <Icon n="reset" />
              </button>
            )}
          </div>
          <MiniPano
            key={target.id}
            media={target.media}
            view={arrivalFor(data, scene.id, h)}
            version={ver}
            urlFor={URL_FOR}
            onChange={v => edit(x => { x.arrival = v; })}
          />
        </section>
      )}

      <section className="insp-sec">
        <div className="seg">
          <button className={h.style === 'floor' ? 'on' : ''} onClick={() => edit(x => { x.style = 'floor'; })} title="Cercle au sol"><Icon n="ring" />Sol</button>
          <button className={h.style === 'pin' ? 'on' : ''} onClick={() => edit(x => { x.style = 'pin'; })} title="Pastille"><Icon n="arrowUp" />Pastille</button>
        </div>
        {target && (
          <div className="row2">
            <button className="btn" disabled={hasBack} onClick={onBacklink} title="Ajoute le lien inverse dans la scène de destination">
              <Icon n={hasBack ? 'check' : 'back'} />Retour
            </button>
            <button className="btn" onClick={onTest}><Icon n="play" />Tester</button>
          </div>
        )}
      </section>
    </>
  );
}

/* ------------------------------------------------------------------ */
export function InfoPanel({ h, edit, onDelete }: {
  h: InfoHotspot;
  edit: (fn: (h: InfoHotspot) => void) => void;
  onDelete: () => void;
}) {
  return (
    <>
      <div className="insp-head">
        <span className="insp-ic"><Icon n="info" /></span>
        <b>Info</b>
        <div className="grow" />
        <button className="ibtn danger" title="Supprimer (Suppr)" onClick={onDelete}><Icon n="trash" /></button>
      </div>
      <section className="insp-sec">
        <Field label="Titre"><input className="in" value={h.title} onChange={e => edit(x => { x.title = e.target.value; })} /></Field>
        <Field label="Texte"><textarea className="in" rows={4} value={h.text} onChange={e => edit(x => { x.text = e.target.value; })} /></Field>
        <Field label="Lien"><input className="in" placeholder="https://" value={h.url} onChange={e => edit(x => { x.url = e.target.value; })} /></Field>
      </section>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Scène : nom + vues de départ (une par défaut + une par provenance) */
/* ------------------------------------------------------------------ */
export function ScenePanel({ data, scene, pv, isStart, rename, setDefaultView, editLink, onSetStart, onDelete, heading, setGeo, onPlaceOnMap, onNorthHere }: {
  data: TourData;
  scene: Scene;
  pv: PanoView | null;
  isStart: boolean;
  rename: (name: string) => void;
  setDefaultView: () => void;
  editLink: (sceneId: string, hsId: string, fn: (h: LinkHotspot) => void) => void;
  onSetStart: () => void;
  onDelete: () => void;
  heading: number | null;
  setGeo: (fn: (g: Geo) => Geo | undefined) => void;
  onPlaceOnMap: () => void;
  onNorthHere?: () => void;
}) {
  const incoming = data.scenes.flatMap(src =>
    src.hotspots.filter((h): h is LinkHotspot => isLink(h) && h.target === scene.id).map(h => ({ src, h })),
  );

  return (
    <>
      <div className="insp-head">
        <img className="insp-thumb" src={thumbOf(scene)} alt="" />
        <input className="in name" value={scene.name} onChange={e => rename(e.target.value)} />
      </div>

      <section className="insp-sec">
        <div className="insp-h">Vues de départ <span className="count">{incoming.length + 1}</span></div>
        <div className="views">
          <div className="view-row">
            <span className="vr-ic"><Icon n="home" /></span>
            <span className="vr-name">Par défaut</span>
            <button className="ibtn sm" title="Voir" onClick={() => pv?.animateTo(scene.view)}><Icon n="eye" /></button>
            <button className="ibtn sm" title="Utiliser la vue actuelle" onClick={setDefaultView}><Icon n="target" /></button>
          </div>
          {incoming.map(({ src, h }) => (
            <div className="view-row" key={h.id}>
              <img src={thumbOf(src)} alt="" />
              <span className="vr-name" title={`Depuis ${src.name}`}>{src.name}</span>
              {!h.arrival && <span className="tag">Auto</span>}
              <button className="ibtn sm" title="Voir" onClick={() => pv?.animateTo(arrivalFor(data, src.id, h))}><Icon n="eye" /></button>
              <button className="ibtn sm" title="Utiliser la vue actuelle" onClick={() => { const v = pv?.getView(); if (v) editLink(src.id, h.id, x => { x.arrival = v; }); }}>
                <Icon n="target" />
              </button>
              {h.arrival && (
                <button className="ibtn sm" title="Automatique" onClick={() => editLink(src.id, h.id, x => { x.arrival = null; })}><Icon n="reset" /></button>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="insp-sec">
        <div className="insp-h">
          Position
          {scene.geo && scene.geo.heading == null && <span className="tag">{heading != null ? 'Cap auto' : 'Cap ?'}</span>}
        </div>
        {scene.geo ? (
          <>
            <div className="geo-row">
              <Icon n="pin" />
              <span>{scene.geo.lat.toFixed(6)}, {scene.geo.lng.toFixed(6)}</span>
              <button className="ibtn sm" title="Retirer de la carte" onClick={() => setGeo(() => undefined)}><Icon n="close" /></button>
            </div>
            <Field label={`Cap · ${heading != null ? `${Math.round(heading)}°` : '—'}`}>
              <input type="range" min={0} max={359} value={Math.round(heading ?? 0)} onChange={e => setGeo(g => ({ ...g, heading: +e.target.value }))} />
            </Field>
            <div className="row2" style={{ marginTop: 0 }}>
              <button className="btn" disabled={!onNorthHere} onClick={onNorthHere} title="La vue actuelle regarde vers le nord"><Icon n="compass" />Nord ici</button>
              <button className="btn" disabled={scene.geo.heading == null} onClick={() => setGeo(g => ({ ...g, heading: null }))} title="Cap déduit des ponts"><Icon n="wand" />Auto</button>
            </div>
          </>
        ) : (
          <button className="btn wide" style={{ marginTop: 0 }} onClick={onPlaceOnMap}><Icon n="pin" />Placer sur la carte</button>
        )}
      </section>

      <section className="insp-sec">
        <div className="row2" style={{ marginTop: 0 }}>
          <button className={'btn' + (isStart ? ' on' : '')} onClick={onSetStart}><Icon n="star" />Accueil</button>
          <button className="btn danger" onClick={onDelete}><Icon n="trash" />Supprimer</button>
        </div>
      </section>
    </>
  );
}

/* ------------------------------------------------------------------ */
export function SettingsPanel({ data, set, setStart }: {
  data: TourData;
  set: <K extends keyof TourSettings>(k: K, v: TourSettings[K]) => void;
  setStart: (id: string) => void;
}) {
  const st = data.settings;
  const onLogo = async (f: File) => {
    const bmp = await createImageBitmap(f);
    const s = Math.min(1, 240 / bmp.height, 720 / bmp.width);
    const cv = document.createElement('canvas');
    cv.width = Math.round(bmp.width * s);
    cv.height = Math.round(bmp.height * s);
    cv.getContext('2d')!.drawImage(bmp, 0, 0, cv.width, cv.height);
    bmp.close();
    set('logo', cv.toDataURL('image/png'));
  };

  return (
    <>
      <div className="insp-head"><span className="insp-ic"><Icon n="settings" /></span><b>Réglages</b></div>
      <section className="insp-sec">
        <Field label="Logo">
          {st.logo ? (
            <div className="logo-box">
              <img src={st.logo} alt="" />
              <button className="ibtn sm" title="Retirer" onClick={() => set('logo', '')}><Icon n="close" /></button>
            </div>
          ) : (
            <label className="btn"><Icon n="upload" />Importer
              <input hidden type="file" accept="image/*" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onLogo(f); }} />
            </label>
          )}
        </Field>
        <Field label="Couleur">
          <div className="color-row">
            <input type="color" value={st.accent} onChange={e => set('accent', e.target.value)} />
            <span className="muted">{st.accent.toUpperCase()}</span>
          </div>
        </Field>
        <Field label="Accueil">
          <select className="in" value={data.startScene ?? ''} onChange={e => setStart(e.target.value)}>
            {data.scenes.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
      </section>
      <section className="insp-sec">
        <Field label="Bouton">
          <input className="in" placeholder="Texte" value={st.ctaLabel} onChange={e => set('ctaLabel', e.target.value)} />
          <input className="in" placeholder="https://" value={st.ctaUrl} onChange={e => set('ctaUrl', e.target.value)} />
        </Field>
      </section>
      <section className="insp-sec">
        <Field label="Transition">
          <div className="seg">
            <button className={st.transition === 'zoom' ? 'on' : ''} onClick={() => set('transition', 'zoom')}>Plongée</button>
            <button className={st.transition === 'fade' ? 'on' : ''} onClick={() => set('transition', 'fade')}>Fondu</button>
          </div>
        </Field>
        <Field label={`Durée · ${st.duration.toFixed(1)} s`}>
          <input type="range" min={0.6} max={2.5} step={0.1} value={st.duration} onChange={e => set('duration', parseFloat(e.target.value))} />
        </Field>
        <Toggle label="Intro planète" value={st.intro} onChange={v => set('intro', v)} />
        <Toggle label="Rotation auto" value={st.autorotate} onChange={v => set('autorotate', v)} />
      </section>
    </>
  );
}
