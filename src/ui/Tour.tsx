import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import { useUI } from './uiStore';

interface Step { target: string | null; title: string; body: string }

export const TOUR_STEPS: Step[] = [
  { target: null, title: 'Te damos la bienvenida a Estudio Foto', body: 'Un editor de fotos completo que funciona en tu navegador. Tus imágenes no salen de tu dispositivo. Este tour dura menos de un minuto.' },
  { target: 'file', title: '1. Abre una imagen', body: 'Desde «Archivo» puedes abrir fotos, crear un lienzo o probar con una imagen de ejemplo. También puedes arrastrarlas aquí o pegarlas con Ctrl+V.' },
  { target: 'toolbar', title: '2. Herramientas', body: 'Mover, recortar, rotar, texto, pincel, borrador, cuentagotas y mano. Cada una tiene su tecla (V, C, R, T, B, E, I, H). Pasa el ratón por encima para ver qué hace.' },
  { target: 'canvas', title: '3. El lienzo', body: 'Usa la rueda o pellizca para hacer zoom y mantén Espacio para desplazarte. El recuadro «¿Qué hace?» explica la herramienta activa paso a paso.' },
  { target: 'panel', title: '4. Capas, Ajustes y Filtros', body: 'Todo es no destructivo: los ajustes y filtros se pueden cambiar o quitar en cualquier momento, y las capas se apilan como hojas transparentes.' },
  { target: 'ai', title: '5. Herramientas IA', body: 'Descarga modelos que funcionan sin conexión para quitar fondos, ampliar resolución o leer texto. Sólo se descargan si tú lo pides.' },
  { target: 'export', title: '6. Exporta tu trabajo', body: 'Guarda en PNG, JPG o WebP eligiendo calidad y tamaño (Ctrl+S). Puedes volver a ver este tour desde «Ayuda».' },
];

function findTarget(name: string | null): HTMLElement | null {
  if (!name) return null;
  const els = [...document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)];
  return els.find((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.top < window.innerHeight && r.bottom > 0 && getComputedStyle(el).visibility !== 'hidden';
  }) ?? null;
}

/** Tour guiado de primera visita, escrito a mano (sin dependencias). */
export function Tour() {
  const open = useUI((s) => s.tourOpen);
  const endTour = useUI((s) => s.endTour);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const [cardPos, setCardPos] = useState<{ left: number; top: number } | null>(null);
  const step = TOUR_STEPS[i];
  const last = i === TOUR_STEPS.length - 1;

  useEffect(() => { if (open) setI(0); }, [open]);

  const measure = useCallback(() => {
    const el = findTarget(step?.target ?? null);
    setRect(el ? el.getBoundingClientRect() : null);
  }, [step]);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open, measure]);

  useLayoutEffect(() => {
    if (!open || !card.current) return;
    const c = card.current.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight, m = 12;
    if (!rect) { setCardPos({ left: (vw - c.width) / 2, top: (vh - c.height) / 2 }); return; }
    const spaces = { right: vw - rect.right, left: rect.left, bottom: vh - rect.bottom, top: rect.top };
    let left: number, top: number;
    if (spaces.right > c.width + 2 * m && rect.height < vh * 0.9) { left = rect.right + m; top = rect.top + rect.height / 2 - c.height / 2; }
    else if (spaces.left > c.width + 2 * m && rect.height < vh * 0.9) { left = rect.left - c.width - m; top = rect.top + rect.height / 2 - c.height / 2; }
    else if (spaces.bottom > c.height + 2 * m) { left = rect.left + rect.width / 2 - c.width / 2; top = rect.bottom + m; }
    else if (spaces.top > c.height + 2 * m) { left = rect.left + rect.width / 2 - c.width / 2; top = rect.top - c.height - m; }
    else { left = (vw - c.width) / 2; top = rect.top + rect.height / 2 - c.height / 2; }
    setCardPos({ left: Math.min(Math.max(m, left), vw - c.width - m), top: Math.min(Math.max(m, top), vh - c.height - m) });
  }, [open, rect, i]);

  useEffect(() => {
    if (!open) return;
    card.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); endTour(false); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); setI((n) => Math.min(n + 1, TOUR_STEPS.length - 1)); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); setI((n) => Math.max(0, n - 1)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, i, endTour]);

  if (!open || !step) return null;
  const pad = 6;
  return (
    <div className="tour" role="presentation">
      {rect ? (
        <div className="tour-spot" style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />
      ) : <div className="tour-dim" />}
      <div ref={card} className="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body" tabIndex={-1}
        style={cardPos ? { left: cardPos.left, top: cardPos.top } : { visibility: 'hidden' }}>
        <div className="tour-progress" aria-label={`Paso ${i + 1} de ${TOUR_STEPS.length}`}>
          {TOUR_STEPS.map((_, n) => <span key={n} className={n === i ? 'is-on' : n < i ? 'is-done' : ''} />)}
        </div>
        <h2 id="tour-title">{step.title}</h2>
        <p id="tour-body">{step.body}</p>
        <div className="tour-actions">
          <button type="button" className="link-btn" onClick={() => endTour(false)}>Saltar tour</button>
          <span className="topbar-spacer" />
          {i > 0 && <button type="button" className="btn btn-sm" onClick={() => setI(i - 1)}>Atrás</button>}
          <button type="button" className="btn btn-primary btn-sm" autoFocus
            onClick={() => (last ? endTour(true) : setI(i + 1))}>
            {last ? <><Icon name="check" size={15} /> Empezar</> : 'Siguiente'}
          </button>
        </div>
      </div>
    </div>
  );
}
