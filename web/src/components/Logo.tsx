import type { CSSProperties } from 'react';

/** Logo Urbanview 360 XR (anneau arc-en-ciel), version empilée. */
export function UrbanviewLogo({ size = 200 }: { size?: number }) {
  return (
    <div className="uv-logo" style={{ '--sz': `${size}px` } as CSSProperties}>
      <span className="uv-ring" />
      <span className="uv-t1">URBAN VIEW</span>
      <span className="uv-t2">360<b>XR</b></span>
    </div>
  );
}

/** Version horizontale pour les barres d'outils. */
export function UrbanviewInline() {
  return (
    <div className="uv-inline">
      <span className="uv-mark"><span className="uv-ring" /><b>360</b></span>
      <span className="uv-word"><b>URBAN VIEW</b><small>360 <i>XR</i></small></span>
    </div>
  );
}
