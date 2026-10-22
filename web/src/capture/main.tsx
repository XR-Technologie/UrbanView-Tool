import { createRoot } from 'react-dom/client';
import CaptureApp from './CaptureApp';
import './capture.css';

createRoot(document.getElementById('root')!).render(<CaptureApp />);

// Hors ligne : l'appli reste utilisable dans un bâtiment sans réseau
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
