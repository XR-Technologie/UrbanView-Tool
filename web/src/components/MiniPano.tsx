import { useEffect, useRef } from 'react';
import { PanoView } from '../engine/PanoView';
import type { Variant } from '../engine/Renderer';
import type { View } from '../types';

interface Props {
  media: string;
  view: View;
  urlFor: (media: string, v: Variant) => string;
  onChange: (v: View) => void;
  /** Incrémenter pour réappliquer `view` (ex. retour en automatique). */
  version?: number;
}

/** Petite visionneuse pour régler une vue (ex. vue d'arrivée d'un lien) en glissant. */
export function MiniPano({ media, view, urlFor, onChange, version = 0 }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const pv = useRef<PanoView | null>(null);
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    const v = new PanoView(host.current!, { urlFor, hiRes: false });
    v.onViewChange = vw => cb.current(vw);
    pv.current = v;
    return () => { v.destroy(); pv.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    pv.current?.show(media, view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media, version]);

  return (
    <div className="mini-pano">
      <div className="pano-gl" ref={host} />
      <span className="mini-cross" />
    </div>
  );
}
