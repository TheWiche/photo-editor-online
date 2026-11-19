import { Icon } from './icons';
import { useUI } from './uiStore';

export function Toasts() {
  const toasts = useUI((s) => s.toasts);
  const dismiss = useUI((s) => s.dismissToast);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <Icon name={t.kind === 'error' ? 'info' : t.kind === 'success' ? 'check' : 'info'} size={16} />
          <span>{t.text}</span>
          <button type="button" className="icon-btn icon-btn-sm" onClick={() => dismiss(t.id)} aria-label="Cerrar aviso"><Icon name="x" size={14} /></button>
        </div>
      ))}
    </div>
  );
}
