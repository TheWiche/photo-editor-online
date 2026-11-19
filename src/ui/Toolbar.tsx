import { useEditor } from '../core/store';
import { TOOLS } from '../core/tools';
import type { IconName } from './icons';
import { Icon } from './icons';
import { Tooltip } from './Tooltip';

const ICONS: Record<string, IconName> = {
  move: 'move', crop: 'crop', rotate: 'rotate', text: 'text', brush: 'brush', eraser: 'eraser', eyedropper: 'eyedropper', hand: 'hand',
};

/** Barra de herramientas izquierda (horizontal en móvil). */
export function Toolbar() {
  const tool = useEditor((s) => s.tool);
  const tempHand = useEditor((s) => s.tempHand);
  const setTool = useEditor((s) => s.setTool);
  const color = useEditor((s) => s.color);
  const setColor = useEditor((s) => s.setColor);
  const hasDoc = useEditor((s) => !!s.doc);

  return (
    <nav className="toolbar" aria-label="Herramientas" data-tour="toolbar">
      <div className="toolbar-tools" role="toolbar" aria-orientation="vertical" aria-label="Herramientas de edición">
        {TOOLS.map((t) => {
          const on = (tempHand ? 'hand' : tool) === t.id;
          return (
            <Tooltip key={t.id} title={t.label} desc={t.short} shortcut={t.shortcut} side="right">
              <button type="button" className={`tool-btn ${on ? 'is-on' : ''}`} aria-pressed={on}
                aria-label={`${t.label} (${t.shortcut})`} aria-keyshortcuts={t.shortcut}
                disabled={!hasDoc && t.id !== 'hand'} onClick={() => setTool(t.id)}>
                <Icon name={ICONS[t.id]} size={20} />
              </button>
            </Tooltip>
          );
        })}
      </div>
      <Tooltip title="Color activo" desc="Color del pincel y del texto. Haz clic para elegir otro o usa el cuentagotas (I)." side="right">
        <label className="color-well" style={{ background: color }}>
          <span className="sr-only">Color activo {color}</span>
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        </label>
      </Tooltip>
    </nav>
  );
}
