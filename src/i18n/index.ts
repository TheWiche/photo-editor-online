/**
 * i18n ligero (sin dependencias).
 *
 *   import { t, tn, useLang } from '../i18n';
 *   const { t, lang, setLang } = useLang();     // en componentes: se re-renderizan al cambiar de idioma
 *   t('projects.title')                          // fuera de React: función suelta (lee el idioma actual)
 *   t('save.done', { name })                     // interpolación {name}
 *   tn('projects.count', n)                      // plural: usa las claves «projects.count_one» / «projects.count_other»
 *
 * Diccionarios: es.ts (fuente de verdad y de tipos) y en.ts (debe tener las mismas claves; tsc avisa si falta alguna).
 * La elección se guarda en localStorage («estudio-foto:lang»). Ver MIGRACION.md para migrar el resto de la UI.
 */
import { useSyncExternalStore } from 'react';
import { en } from './en';
import { es, type DictKey } from './es';

export type Lang = 'es' | 'en';
export type { DictKey };
export const LANGS: { id: Lang; label: string }[] = [
  { id: 'es', label: 'Español' },
  { id: 'en', label: 'English' },
];

const DICTS: Record<Lang, Record<DictKey, string>> = { es, en };
const STORAGE_KEY = 'estudio-foto:lang';
const LOCALES: Record<Lang, string> = { es: 'es-ES', en: 'en-GB' };

function readStored(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v) { const p = JSON.parse(v); if (p === 'es' || p === 'en') return p; }
  } catch { /* sin almacenamiento */ }
  return 'es'; // la app completa aún está en español: es el valor por defecto hasta migrar toda la UI
}

let current: Lang = readStored();
const listeners = new Set<() => void>();
const applyDocLang = () => { try { document.documentElement.lang = current; } catch { /* SSR/tests */ } };
applyDocLang();

export const getLang = (): Lang => current;

export function setLang(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(lang)); } catch { /* ignorar */ }
  applyDocLang();
  listeners.forEach((l) => l());
}

export const onLangChange = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

function interpolate(s: string, params?: Record<string, string | number>): string {
  return params ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : s;
}

/** Traduce una clave. Si falta en el idioma actual cae al español y, como último recurso, a la propia clave. */
export function t(key: DictKey, params?: Record<string, string | number>): string {
  return interpolate(DICTS[current][key] ?? es[key] ?? key, params);
}

/** Plural simple: busca `${key}_one` (n === 1) o `${key}_other`. `{n}` se rellena solo. */
export function tn(key: string, n: number, params: Record<string, string | number> = {}): string {
  const k = (`${key}_${n === 1 ? 'one' : 'other'}`) as DictKey;
  return t(k, { n, ...params });
}

export function useLang() {
  const lang = useSyncExternalStore((cb) => onLangChange(cb), getLang, getLang);
  return { lang, setLang, t, tn };
}

export const locale = () => LOCALES[current];

export function formatDate(ts: number | Date, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }): string {
  try { return new Intl.DateTimeFormat(locale(), opts).format(ts); } catch { return new Date(ts).toLocaleString(); }
}

/** «hace 5 min» / «5 min ago». */
export function timeAgo(ts: number): string {
  const diff = Math.round((ts - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}
