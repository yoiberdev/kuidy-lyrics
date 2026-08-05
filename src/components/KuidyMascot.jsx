import { useId } from 'react';

export default function KuidyMascot({ size = 20, animated = true, palette }) {
  // Colores por defecto (violeta/fucsia/coral). Si llega paleta del álbum, la usamos.
  const c1 = palette?.accent || '#c4b5fd';
  const c2 = palette?.muted || '#f0abfc';
  const c3 = '#fda4af';
  // Los ids SVG son globales al documento: useId garantiza que dos mascotas con
  // paletas distintas no compartan gradiente. Sin los ":" que url(#) no admite.
  const id = `kg-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={animated ? 'kuidy-bob' : ''}
      style={{ overflow: 'visible' }}
    >
      <defs>
        <linearGradient id={id} x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={c1} />
          <stop offset="0.55" stopColor={c2} />
          <stop offset="1" stopColor={c3} />
        </linearGradient>
        <radialGradient id={`${id}-glow`} cx="50%" cy="55%" r="55%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.35)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </radialGradient>
      </defs>

      {/* Halo suave detrás */}
      <ellipse cx="16" cy="29" rx="9" ry="1.6" fill="rgba(0,0,0,0.18)" />

      {/* Cuerpo blob redondeado */}
      <path
        d="M16 3.5
           C 23.5 3.5, 28 9, 28 16
           C 28 22.5, 24 28.5, 16 28.5
           C 8 28.5, 4 22.5, 4 16
           C 4 9, 8.5 3.5, 16 3.5 Z"
        fill={`url(#${id})`}
      />

      {/* Reflejo de cristal */}
      <ellipse cx="13" cy="11" rx="6" ry="3.5" fill={`url(#${id}-glow)`} />

      {/* Ojos */}
      <ellipse cx="11.6" cy="16" rx="2" ry="2.6" fill="#1a1025" />
      <ellipse cx="20.4" cy="16" rx="2" ry="2.6" fill="#1a1025" />
      {/* Brillito de los ojos */}
      <circle cx="12.4" cy="14.9" r="0.7" fill="white" />
      <circle cx="21.2" cy="14.9" r="0.7" fill="white" />

      {/* Mejillas rosadas */}
      <ellipse cx="8.5" cy="20" rx="1.7" ry="1" fill="rgba(253,164,175,0.65)" />
      <ellipse cx="23.5" cy="20" rx="1.7" ry="1" fill="rgba(253,164,175,0.65)" />

      {/* Sonrisita */}
      <path
        d="M13.2 21.2 Q 16 23.4 18.8 21.2"
        stroke="#1a1025"
        strokeWidth="1.2"
        strokeLinecap="round"
        fill="none"
      />

      {/* Notita musical flotante */}
      <g className={animated ? 'kuidy-note' : ''}>
        <circle cx="27" cy="8" r="1.5" fill={c3} />
        <rect x="28.2" y="3.4" width="0.8" height="4.8" rx="0.4" fill={c3} />
      </g>
    </svg>
  );
}
