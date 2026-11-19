/** localStorage con try/catch (modo privado, almacenamiento bloqueado, vistas previas…). */
export function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`estudio-foto:${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: unknown): void {
  try {
    localStorage.setItem(`estudio-foto:${key}`, JSON.stringify(value));
  } catch {
    /* sin almacenamiento: se ignora */
  }
}
