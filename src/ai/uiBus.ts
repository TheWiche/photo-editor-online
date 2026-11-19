/**
 * Pequeño bus de eventos de la UI de IA (sin dependencias de React), para que el panel IA,
 * los menús y los overlays se comuniquen sin importarse entre sí.
 */

type Listener<T> = (v: T) => void;

function channel<T>() {
  const ls = new Set<Listener<T>>();
  return {
    emit: (v: T) => ls.forEach((l) => l(v)),
    on: (l: Listener<T>) => {
      ls.add(l);
      return () => {
        ls.delete(l);
      };
    },
  };
}

export type PortraitMode = 'bokeh' | 'parallax';

/** Abrir el diálogo «Modo retrato» / «Efecto 3D». */
export const portraitChannel = channel<PortraitMode>();
export const openPortrait = (mode: PortraitMode = 'bokeh') => portraitChannel.emit(mode);

/** Abrir de nuevo el preámbulo (introducción). */
export const onboardingChannel = channel<void>();
export const openOnboarding = () => onboardingChannel.emit(undefined);

/** Evento de ventana que se dispara al cerrar el preámbulo (el tour guiado arranca después). */
export const ONBOARDING_DONE_EVENT = 'onboarding:done';

const nf = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });

export function fmtMB(mb: number): string {
  return mb >= 1000 ? `${nf.format(mb / 1000)} GB` : `${nf.format(Math.round(mb))} MB`;
}
