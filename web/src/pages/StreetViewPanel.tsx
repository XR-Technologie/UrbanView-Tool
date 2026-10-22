import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { bridges, headingOf } from '../geo';
import type { GoogleStatus, SvState, TourData } from '../types';
import { Field } from './EditorPanels';

const STATUS: Record<string, [string, string]> = {
  PUBLISHED: ['En ligne', 'ok'],
  PENDING: ['En traitement', 'wait'],
  REJECTED_UNKNOWN: ['Refusée', 'bad'],
  UNSPECIFIED_MAPS_PUBLISH_STATUS: ['En traitement', 'wait'],
};

/** Panneau Street View : compte Google, vérifications, publication et suivi. */
export function StreetViewPanel({ tourId, data, flush, notify }: {
  tourId: string;
  data: TourData;
  flush: () => Promise<void>;
  notify: (m: string) => void;
}) {
  const [g, setG] = useState<GoogleStatus | null>(null);
  const [sv, setSv] = useState<SvState>({ job: null, photos: [] });
  const [editCreds, setEditCreds] = useState(false);
  const [cid, setCid] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const waitAuth = useRef<number | undefined>(undefined);

  useEffect(() => {
    api.googleStatus().then(s => { setG(s); setCid(s.clientId); }).catch(e => setErr((e as Error).message));
    api.sv(tourId).then(setSv).catch(() => {});
    return () => clearInterval(waitAuth.current);
  }, [tourId]);

  // Suivi de la publication
  useEffect(() => {
    if (!sv.job?.running) return;
    const t = setInterval(() => {
      api.sv(tourId).then(s => {
        setSv(s);
        if (!s.job?.running) notify(s.job?.error ? 'Publication interrompue' : 'Publication terminée');
      }).catch(() => {});
    }, 1500);
    return () => clearInterval(t);
  }, [sv.job?.running, tourId, notify]);

  const saveCreds = async () => {
    setErr('');
    try { const s = await api.googleConfig(cid, secret); setG(s); setEditCreds(false); setSecret(''); }
    catch (e) { setErr((e as Error).message); }
  };

  const connect = () => {
    window.open(api.googleAuthUrl(location.pathname), '_blank');
    clearInterval(waitAuth.current);
    let n = 0;
    waitAuth.current = window.setInterval(async () => {
      const s = await api.googleStatus().catch(() => null);
      if (s?.connected || ++n > 150) { clearInterval(waitAuth.current); if (s) setG(s); }
    }, 2000);
  };

  const run = async (fn: () => Promise<SvState>) => {
    setErr('');
    setBusy(true);
    try { setSv(await fn()); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  const publish = (mode: 'all' | 'connections') => run(async () => {
    await flush();
    const headings: Record<string, number> = {};
    for (const s of data.scenes) { const h = headingOf(data, s); if (h != null) headings[s.id] = h; }
    return api.svPublish(tourId, mode, headings);
  });

  const placed = data.scenes.filter(s => s.geo);
  const oriented = placed.filter(s => headingOf(data, s) != null);
  const lowRes = data.scenes.filter(s => s.width * s.height < 7.5e6);
  const nBridges = bridges(data).length;
  const byScene = new Map(sv.photos.map(p => [p.sceneId, p]));
  const job = sv.job;
  const connected = !!g?.connected;
  const configured = !!g?.configured;

  return (
    <>
      <div className="insp-head"><span className="insp-ic"><Icon n="globe" /></span><b>Street View</b></div>

      <section className="insp-sec">
        <div className="insp-h">Compte Google
          <div className="grow" />
          {connected && <span className="tag ok">Connecté</span>}
        </div>
        {(!configured || editCreds) ? (
          <>
            <Field label="Client ID OAuth"><input className="in" value={cid} onChange={e => setCid(e.target.value)} placeholder="….apps.googleusercontent.com" /></Field>
            <Field label="Client secret"><input className="in" type="password" value={secret} onChange={e => setSecret(e.target.value)} placeholder={configured ? '•••••• (inchangé)' : ''} /></Field>
            <div className="row2" style={{ marginTop: 0 }}>
              <a className="btn ghost" href="https://console.cloud.google.com/apis/library/streetviewpublish.googleapis.com" target="_blank" rel="noopener"><Icon n="external" />Console</a>
              <button className="btn pri" disabled={!cid.trim() || (!configured && !secret.trim())} onClick={saveCreds}>Enregistrer</button>
            </div>
            <p className="hint">API « Street View Publish » activée + identifiant OAuth de type « Application de bureau ».</p>
          </>
        ) : connected ? (
          <div className="row2" style={{ marginTop: 0 }}>
            <button className="btn" onClick={() => setEditCreds(true)}><Icon n="settings" />Identifiants</button>
            <button className="btn danger" onClick={() => api.googleLogout().then(setG)}>Déconnecter</button>
          </div>
        ) : (
          <div className="row2" style={{ marginTop: 0 }}>
            <button className="btn" onClick={() => setEditCreds(true)}><Icon n="settings" />Identifiants</button>
            <button className="btn pri" onClick={connect}><Icon n="globe" />Se connecter</button>
          </div>
        )}
      </section>

      <section className="insp-sec">
        <div className="insp-h">Vérification</div>
        <ul className="checks">
          <li className={placed.length === data.scenes.length ? 'ok' : placed.length ? 'warn' : 'bad'}><Icon n="pin" />Placées sur la carte<b>{placed.length}/{data.scenes.length}</b></li>
          <li className={oriented.length === placed.length && placed.length ? 'ok' : 'warn'}><Icon n="compass" />Orientées<b>{oriented.length}/{placed.length}</b></li>
          <li className={nBridges ? 'ok' : 'warn'}><Icon n="link" />Ponts<b>{nBridges}</b></li>
          <li className={lowRes.length ? 'bad' : 'ok'}><Icon n="image" />Résolution ≥ 7,5 Mpx<b>{data.scenes.length - lowRes.length}/{data.scenes.length}</b></li>
        </ul>
      </section>

      <section className="insp-sec">
        <button className="btn pri wide" style={{ marginTop: 0 }} disabled={!connected || !placed.length || busy || !!job?.running} onClick={() => publish('all')}>
          <Icon n="upload" />Publier sur Street View
        </button>
        <div className="row2">
          <button className="btn" disabled={!connected || !sv.photos.length || busy || !!job?.running} onClick={() => publish('connections')} title="Met à jour positions, caps et ponts sans renvoyer les photos">
            <Icon n="link" />Ponts
          </button>
          <button className="btn" disabled={!connected || !sv.photos.length || busy} onClick={() => run(() => api.svRefresh(tourId))}><Icon n="reset" />Statuts</button>
        </div>

        {job && (job.running || job.error || job.finishedAt) && (
          <div className="sv-job">
            <div className="sv-step">{job.running && <span className="spinner sm" />}{job.step}</div>
            {job.running && <div className="rt-bar"><i style={{ width: `${Math.round((job.done / Math.max(1, job.total)) * 100)}%` }} /></div>}
            {job.error && <p className="err">{job.error}</p>}
          </div>
        )}
        {err && <p className="err" style={{ marginTop: 10 }}>{err}</p>}
      </section>

      {placed.length > 0 && (
        <section className="insp-sec">
          <div className="insp-h">Photos</div>
          <div className="views">
            {placed.map(s => {
              const p = byScene.get(s.id);
              const [label, cls] = p ? (STATUS[p.status ?? ''] ?? ['Envoyée', 'wait']) : ['Non publiée', ''];
              const outdated = p && p.media !== s.media;
              return (
                <div className="view-row" key={s.id}>
                  <span className="vr-name">{s.name}</span>
                  <span className={`tag ${outdated ? 'warn' : cls}`}>{outdated ? 'Modifiée' : label}</span>
                  {p?.shareLink && <a className="ibtn sm" href={p.shareLink} target="_blank" rel="noopener" title="Ouvrir dans Google Maps"><Icon n="external" /></a>}
                </div>
              );
            })}
          </div>
          {sv.photos.length > 0 && (
            <button className="btn danger wide" disabled={busy || !!job?.running}
              onClick={() => confirm('Retirer toutes les photos de cette visite de Google Street View ?') && run(() => api.svUnpublish(tourId))}>
              <Icon n="trash" />Retirer de Street View
            </button>
          )}
        </section>
      )}
    </>
  );
}
