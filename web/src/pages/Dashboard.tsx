import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { UrbanviewInline, UrbanviewLogo } from '../components/Logo';
import type { TourSummary } from '../types';

export default function Dashboard() {
  const nav = useNavigate();
  const [tours, setTours] = useState<TourSummary[] | null>(null);
  const [err, setErr] = useState('');

  const load = () => api.tours().then(setTours).catch(e => setErr((e as Error).message));
  useEffect(() => { load(); }, []);

  const create = async () => {
    try {
      const t = await api.createTour('Nouvelle visite');
      nav(`/edit/${t.id}`);
    } catch (e) { setErr((e as Error).message); }
  };

  const remove = async (t: TourSummary) => {
    if (!confirm(`Supprimer « ${t.title} » ?`)) return;
    await api.deleteTour(t.id);
    load();
  };

  return (
    <div className="dash">
      <header className="dash-top">
        <UrbanviewInline />
        <div className="grow" />
        <button className="btn pri" onClick={create}><Icon n="plus" />Nouvelle visite</button>
      </header>
      <main className="dash-main">
        {err && <p className="err">{err}</p>}
        {!tours && !err && <div className="center-msg"><span className="spinner" /></div>}
        {tours && !tours.length && (
          <button className="dash-empty" onClick={create}>
            <UrbanviewLogo size={200} />
            <span className="btn pri big"><Icon n="plus" />Créer une visite</span>
          </button>
        )}
        <div className="dash-grid">
          {tours?.map(t => (
            <article key={t.id} className="tcard" onClick={() => nav(`/edit/${t.id}`)}>
              <div className="tcard-img">
                {t.cover ? <img src={t.cover} alt="" /> : <Icon n="image" size={30} />}
                <span className="tcard-count"><Icon n="layers" />{t.sceneCount}</span>
              </div>
              <div className="tcard-foot">
                <b>{t.title}</b>
                <a className="ibtn" href={`/tour/${t.id}`} target="_blank" rel="noopener" title="Voir" onClick={e => e.stopPropagation()}><Icon n="eye" /></a>
                <button className="ibtn danger" title="Supprimer" onClick={e => { e.stopPropagation(); remove(t); }}><Icon n="trash" /></button>
              </div>
            </article>
          ))}
        </div>
      </main>
    </div>
  );
}
