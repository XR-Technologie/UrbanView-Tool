import { createRoot } from 'react-dom/client';
import { TourPlayer } from './components/TourPlayer';
import { normalizeDoc, type TourDoc } from './types';
import './styles.css';

declare global {
  interface Window { __TOUR__?: TourDoc }
}

const root = createRoot(document.getElementById('root')!);
if (window.__TOUR__) root.render(<TourPlayer tour={normalizeDoc(window.__TOUR__)} mediaBase="media" />);
else root.render(<div className="center-msg">Visite introuvable (tour.js manquant).</div>);
