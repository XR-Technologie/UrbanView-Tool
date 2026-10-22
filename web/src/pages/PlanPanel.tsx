import { Icon } from '../components/Icon';
import { sceneOfPoint, type TourPlan } from '../plan';
import type { TourData } from '../types';
import { Field, thumbOf } from './EditorPanels';

const LENS = [0, 90, 180, 270];

/** Panneau du relevé : liaison photos ↔ points, objectif, calage sur la carte. */
export function PlanPanel({ data, plan, selected, onImport, onAutoMatch, onUnlink, onAnchor, onRotation, onLens, onBridges, onRemove }: {
  data: TourData;
  plan: TourPlan | undefined;
  selected: string | null;
  onImport: (f: File) => void;
  onAutoMatch: () => void;
  onUnlink: (pointId: string) => void;
  onAnchor: (pointId: string) => void;
  onRotation: (deg: number) => void;
  onLens: (deg: number) => void;
  onBridges: () => void;
  onRemove: () => void;
}) {
  const importBtn = (label?: string) => (
    <label className={'btn' + (label ? ' pri wide' : '')} style={label ? { marginTop: 0 } : undefined}>
      <Icon n="upload" />{label}
      <input type="file" accept=".uvplan,.json,.txt,application/json,text/plain" hidden onChange={e => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = ''; }} />
    </label>
  );

  if (!plan) {
    return (
      <>
        <div className="insp-head"><span className="insp-ic"><Icon n="plan" /></span><b>Relevé</b></div>
        <section className="insp-sec">{importBtn('Importer un relevé')}</section>
      </>
    );
  }

  const linked = plan.points.filter(p => sceneOfPoint(data, p.id)).length;
  const pt = plan.points.find(p => p.id === selected) ?? null;
  const ptScene = pt ? sceneOfPoint(data, pt.id) : null;
  const ref = plan.points.find(p => p.id === plan.anchor?.pointId);
  const anchorTarget = pt ?? ref ?? plan.points.find(p => sceneOfPoint(data, p.id)) ?? plan.points[0];

  return (
    <>
      <div className="insp-head">
        <span className="insp-ic"><Icon n="plan" /></span>
        <b className="grow ellipsis">{plan.name}</b>
        <span className={'tag' + (linked === plan.points.length ? ' ok' : '')}>{linked}/{plan.points.length}</span>
        <button className="ibtn danger" onClick={onRemove}><Icon n="trash" /></button>
      </div>

      <section className="insp-sec">
        {pt ? (
          <div className="rl-sel">
            <span className="rl-badge">{pt.n}</span>
            {ptScene ? <img src={thumbOf(ptScene)} alt="" /> : <span className="rl-none"><Icon n="image" /></span>}
            <span className="grow ellipsis">{ptScene?.name ?? 'Cliquez une photo'}</span>
            {ptScene && <button className="ibtn sm" onClick={() => onUnlink(pt.id)}><Icon n="close" /></button>}
          </div>
        ) : (
          <div className="muted sm">Point puis photo, ou glisser la photo sur le point</div>
        )}
        <div className="row2">
          <button className="btn" onClick={onAutoMatch}><Icon n="wand" />Auto</button>
          {importBtn()}
        </div>
      </section>

      <section className="insp-sec">
        <div className="insp-h">Objectif <span className="count">{plan.lensOffset}°</span></div>
        <div className="seg">
          {LENS.map(v => <button key={v} className={plan.lensOffset === v ? 'on' : ''} onClick={() => onLens(v)}>{v}°</button>)}
        </div>
        <input type="range" min={-180} max={180} value={plan.lensOffset > 180 ? plan.lensOffset - 360 : plan.lensOffset} onChange={e => onLens((+e.target.value + 360) % 360)} style={{ width: '100%', marginTop: 10 }} />
      </section>

      <section className="insp-sec">
        <div className="insp-h">
          Carte
          {ref && <span className="tag ok">Point {ref.n}</span>}
        </div>
        <button className="btn wide" style={{ marginTop: 0 }} onClick={() => onAnchor(anchorTarget.id)}>
          <Icon n="anchor" />Caler le point {anchorTarget.n}
        </button>
        {plan.anchor && (
          <>
            <Field label={`Rotation · ${Math.round(plan.anchor.rotation)}°`}>
              <input type="range" min={0} max={359.5} step={0.5} value={plan.anchor.rotation} onChange={e => onRotation(+e.target.value)} />
            </Field>
            <button className="btn wide" onClick={onBridges}><Icon n="link" />Ponts du parcours</button>
          </>
        )}
      </section>
    </>
  );
}
