/**
 * PUNTOS DE EXTENSIÓN de la UI. Cada agente añade SUS archivos en src/ui/ext/*.tsx
 * (no edita App/RightPanel/TopBar). Cada archivo hace `export default { ... } satisfies UiExtension`.
 */
import type { ComponentType } from 'react';
import type { IconName } from './icons';

export interface ExtTab { id: string; label: string; icon: IconName; Component: ComponentType }
export interface ExtMenuItem { label: string; icon?: IconName; shortcut?: string; onSelect(): void; disabled?: boolean }
export interface ExtMenu { id: string; label: string; icon?: IconName; items: ExtMenuItem[] | (() => ExtMenuItem[]) }

export interface UiExtension {
  /** Pestañas del panel derecho. */
  tabs?: ExtTab[];
  /** Menús de la barra superior (junto a «Archivo»/«Ayuda»). */
  menus?: ExtMenu[];
  /** Componentes siempre montados en App (diálogos, banners, onboarding, atajos globales). */
  overlays?: ComponentType[];
}

const mods = import.meta.glob<{ default: UiExtension }>('./ext/*.tsx', { eager: true });
const all = Object.values(mods).map((m) => m.default).filter(Boolean);

export const extTabs: ExtTab[] = all.flatMap((e) => e.tabs ?? []);
export const extMenus: ExtMenu[] = all.flatMap((e) => e.menus ?? []);
export const extOverlays: ComponentType[] = all.flatMap((e) => e.overlays ?? []);
