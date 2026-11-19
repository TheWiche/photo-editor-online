import { pickFiles } from './files';
import { Icon } from './icons';
import { openSample } from './TopBar';
import { useUI } from './uiStore';

/** Pantalla de bienvenida (sin documento abierto). */
export function Welcome() {
  const { openDialog, startTour } = useUI.getState();
  return (
    <div className="welcome">
      <div className="welcome-card">
        <span className="brand-mark brand-mark-lg" aria-hidden="true" />
        <h1>Edita tus fotos en el navegador</h1>
        <p className="welcome-sub">Capas, ajustes, filtros y herramientas de IA que se ejecutan en tu dispositivo. Nada se sube a ningún servidor.</p>
        <button type="button" className="dropzone" onClick={() => pickFiles('new')}>
          <Icon name="upload" size={30} />
          <strong>Abrir imagen</strong>
          <span>o arrástrala aquí · también puedes pegarla con <kbd>Ctrl</kbd> + <kbd>V</kbd></span>
          <span className="muted">JPG, PNG, WebP, GIF, AVIF…</span>
        </button>
        <div className="welcome-actions">
          <button type="button" className="btn" onClick={() => openDialog('new')}><Icon name="plus" size={16} /> Nuevo lienzo</button>
          <button type="button" className="btn" onClick={() => { void openSample(); }}><Icon name="image" size={16} /> Imagen de ejemplo</button>
          <button type="button" className="btn" onClick={startTour}><Icon name="info" size={16} /> Tour guiado</button>
        </div>
        <ul className="welcome-features">
          <li><Icon name="layers" size={16} /> Capas con modos de fusión</li>
          <li><Icon name="sliders" size={16} /> Ajustes no destructivos</li>
          <li><Icon name="sparkles" size={16} /> IA local y sin conexión</li>
        </ul>
      </div>
    </div>
  );
}
