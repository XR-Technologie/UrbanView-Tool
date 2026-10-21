import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import { TourPlayer } from '../components/TourPlayer';
import { normalizeDoc, type TourDoc } from '../types';

export default function ViewerPage() {
  const { id = '' } = useParams();
  const [doc, setDoc] = useState<TourDoc | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.tour(id).then(d => setDoc(normalizeDoc(d))).catch(e => setErr((e as Error).message));
  }, [id]);

  if (err) return <div className="center-msg">{err}</div>;
  if (!doc) return <div className="center-msg"><span className="spinner" /></div>;
  return <TourPlayer tour={doc} mediaBase="/media" />;
}
