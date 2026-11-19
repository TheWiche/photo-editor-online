/**
 * Aviso ANTES de descargar modelos de IA. Se registra como «asker» en src/ai/downloadGuard.ts,
 * por lo que lo usa cualquier camino que llame a install() (Centro de módulos, panel IA,
 * ensureInstalled, preámbulo).
 */
import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../controls';
import { Icon } from '../icons';
import type { UiExtension } from '../extensions';
import { describeNet, getSkipOnWifi, isWifiLike, setDownloadAsker, setSkipOnWifi, type DownloadPlan } from '../../ai/downloadGuard';
import { fmtMB } from '../../ai/uiBus';
import './ai.css';

const fmtBytes = (b: number) => fmtMB(b / 1e6);

interface Pending {
  plan: DownloadPlan;
  resolve: (ok: boolean) => void;
}

function DownloadConfirm() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [dontAsk, setDontAsk] = useState(getSkipOnWifi());
  const ref = useRef<Pending | null>(null);
  ref.current = pending;

  useEffect(() => {
    const off = setDownloadAsker(
      (plan) =>
        new Promise<boolean>((resolve) => {
          setDontAsk(getSkipOnWifi());
          setPending({ plan, resolve });
        }),
    );
    return () => {
      off();
      ref.current?.resolve(false);
    };
  }, []);

  const answer = (ok: boolean) => {
    const p = ref.current;
    if (!p) return;
    if (ok && isWifiLike(p.plan.net)) setSkipOnWifi(dontAsk);
    setPending(null);
    p.resolve(ok);
  };

  const plan = pending?.plan;
  const wifi = plan ? isWifiLike(plan.net) : false;
  const afterFree = plan ? plan.storage.freeBytes - plan.totalMB * 1e6 : 0;
  const pctAfter = plan && plan.storage.quotaBytes ? Math.min(1, (plan.storage.usedBytes + plan.totalMB * 1e6) / plan.storage.quotaBytes) : 0;
  const pctNow = plan && plan.storage.quotaBytes ? Math.min(1, plan.storage.usedBytes / plan.storage.quotaBytes) : 0;
  const offline = plan ? !plan.net.online : false;

  return (
    <Dialog
      open={!!pending}
      onClose={() => answer(false)}
      title={plan && plan.items.length > 1 ? 'Descargar módulos de IA' : `Descargar «${plan?.items[0]?.nameEs ?? ''}»`}
      footer={
        <div className="aidl-foot">
          {wifi && (
            <label className="aidl-check">
              <input type="checkbox" checked={dontAsk} onChange={(e) => setDontAsk(e.target.checked)} />
              No volver a preguntar en Wi‑Fi
            </label>
          )}
          <span className="aidl-spacer" />
          <button type="button" className="btn" onClick={() => answer(false)}>Cancelar</button>
          <button type="button" className="btn btn-primary" data-testid="aidl-ok" onClick={() => answer(true)} disabled={offline || plan?.insufficient}>
            <Icon name="download" size={15} /> Descargar {plan ? fmtMB(plan.totalMB) : ''}
          </button>
        </div>
      }
    >
      {plan && (
        <div className="aidl">
          <p className="aidl-lead">
            Se descargará <strong>una sola vez</strong> y quedará guardado en este dispositivo. Después funciona sin
            internet y tus fotos nunca se suben a ningún servidor.
          </p>

          <ul className="aidl-items">
            {plan.items.map((i) => (
              <li key={i.id}>
                <span>{i.nameEs}{i.experimental && <em className="aidl-exp">experimental</em>}</span>
                <strong>~{fmtMB(i.mb)}</strong>
              </li>
            ))}
            {plan.runtimeMB > 0 && (
              <li className="aidl-runtime">
                <span>{plan.runtimeLabel}</span>
                <strong>~{fmtMB(plan.runtimeMB)}</strong>
              </li>
            )}
            <li className="aidl-total">
              <span>Total aproximado</span>
              <strong>~{fmtMB(plan.totalMB)}</strong>
            </li>
          </ul>

          {(plan.metered || offline) && (
            <div className="aidl-warn" role="alert">
              <Icon name="info" size={18} />
              <div>
                {offline ? (
                  <><strong>Estás sin conexión.</strong> Conéctate a internet para descargar.</>
                ) : (
                  <>
                    <strong>
                      {plan.net.saveData
                        ? 'Tienes activado el ahorro de datos.'
                        : plan.net.type === 'cellular'
                          ? 'Parece que usas datos móviles.'
                          : 'Tu conexión parece lenta.'}
                    </strong>{' '}
                    Esta descarga ocupa ~{fmtMB(plan.totalMB)} de tu plan de datos
                    {plan.net.downlink ? ` y podría tardar ~${Math.max(1, Math.round((plan.totalMB * 8) / plan.net.downlink / 60))} min` : ''}.
                    Si puedes, espera a estar en Wi‑Fi.
                  </>
                )}
              </div>
            </div>
          )}

          {plan.insufficient && (
            <div className="aidl-warn aidl-warn--danger" role="alert">
              <Icon name="info" size={18} />
              <div>
                <strong>No hay espacio suficiente.</strong> El navegador deja a este sitio ~{fmtBytes(plan.storage.freeBytes)} libres y
                hacen falta ~{fmtMB(plan.totalMB * 1.15)}. Elimina otros módulos en el Centro de módulos o libera espacio en el dispositivo.
              </div>
            </div>
          )}
          {plan.tight && (
            <div className="aidl-warn" role="status">
              <Icon name="info" size={18} />
              <div>Quedará poco espacio libre (~{fmtBytes(afterFree)}). Si el disco se llena, el navegador podría borrar los modelos.</div>
            </div>
          )}

          <div className="aidl-storage">
            <div className="aidl-storage-head">
              <span>Espacio para este sitio</span>
              <span>{plan.storage.supported ? `${fmtBytes(plan.storage.freeBytes)} libres de ${fmtBytes(plan.storage.quotaBytes)}` : 'El navegador no informa del espacio'}</span>
            </div>
            {plan.storage.supported && (
              <div className="aidl-meter" aria-hidden="true">
                <span className="aidl-meter-used" style={{ width: `${pctNow * 100}%` }} />
                <span className={`aidl-meter-new${plan.insufficient ? ' is-bad' : ''}`} style={{ left: `${pctNow * 100}%`, width: `${Math.max(0.6, (pctAfter - pctNow) * 100)}%` }} />
              </div>
            )}
            <p className="aidl-small">
              Red: {describeNet(plan.net)}
              {plan.backend && ` · Motor: ${plan.backend === 'webgpu' ? 'WebGPU (tarjeta gráfica)' : 'WebAssembly (CPU)'}`}
              {!plan.storage.persisted && ' · Al descargar se pedirá al navegador que proteja los modelos del borrado automático.'}
            </p>
          </div>
        </div>
      )}
    </Dialog>
  );
}

export default { overlays: [DownloadConfirm] } satisfies UiExtension;
