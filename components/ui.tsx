'use client';

import React, {
  createContext, useCallback, useContext, useEffect, useRef, useState,
} from 'react';
import { Ico, type IconType } from './icons';
import { uid } from '@/lib/format';
import { UNSAVED_MSG } from '@/lib/defaults';

/* =========================================================================
   PRIMITIVES UI — reprises de index.html, à l'identique.
   ------------------------------------------------------------------------- */

type ToastFn = (msg: string, type?: 'ok' | 'err') => void;
const ToastCtx = createContext<ToastFn>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<{ id: string; msg: string; type: string }[]>([]);
  const push = useCallback<ToastFn>((msg, type = 'ok') => {
    const id = uid('t');
    setItems((s) => [...s, { id, msg, type }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">
        {items.map((t) => (
          <div key={t.id} className={'toast ' + t.type}>
            <span className="bar"></span>
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function StatusBadge({ s }: { s?: string }) {
  const map: Record<string, [string, string]> = {
    brouillon: ['b-draft', 'Brouillon'], envoye: ['b-part', 'Envoyée'], accepte: ['b-paid', 'Accepté'],
    attente: ['b-draft', 'Brouillon'], acompte: ['b-wait', 'Acompte reçu'], partielle: ['b-part', 'Paiement partiel'],
    payee: ['b-paid', 'Payée'], annulee: ['b-cancel', 'Annulée'],
  };
  const [cls, lab] = map[s || ''] || ['b-draft', s || '—'];
  return (
    <span className={'badge ' + cls}>
      <span className="dot"></span>
      {lab}
    </span>
  );
}

export function Field({
  label, hint, children,
}: { label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="field">
      <label>
        {label}
        {hint ? <span className="hint">{hint}</span> : null}
      </label>
      {children}
    </div>
  );
}

export const Input = (p: React.InputHTMLAttributes<HTMLInputElement>) => <input className="input" {...p} />;
export const Textarea = (p: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea className="input" {...p} />
);
export const Select = ({ children, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) => (
  <select className="input" {...p}>
    {children}
  </select>
);

/* ---- pile de fenêtres : le bouton « retour » ferme d'abord la fenêtre ouverte ---- */

export interface OverlayHost {
  registerOverlay: (close: () => void) => number;
  unregisterOverlay: (id: number) => void;
}
export const OverlayCtx = createContext<OverlayHost | null>(null);

export function useNavOverlay(closeFn: () => void) {
  const host = useContext(OverlayCtx);
  const ref = useRef(closeFn);
  ref.current = closeFn;
  useEffect(() => {
    if (!host) return;
    const id = host.registerOverlay(() => ref.current && ref.current());
    return () => host.unregisterOverlay(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/* Anti-fermeture accidentelle : le fond ne ferme que si le clic COMMENCE et FINIT dessus.
   (Avant : cliquer dans un champ puis glisser d'un millimètre — sélection de texte, doigt
   sur mobile — envoyait le clic au fond → le formulaire se fermait et la saisie était perdue.) */
export function useBackdropClose(onClose: () => void) {
  const down = useRef(false);
  return {
    onMouseDown: (e: React.MouseEvent) => { down.current = e.target === e.currentTarget; },
    onMouseUp: (e: React.MouseEvent) => {
      const ok = down.current && e.target === e.currentTarget;
      down.current = false;
      if (ok) onClose();
    },
  };
}

/* Garde anti-perte de saisie : tant qu'une modification n'est pas enregistrée,
   toute fermeture (croix, Annuler, fond, bouton retour Android) demande confirmation. */
export function useDirtyGuard(onClose: () => void) {
  const dirty = useRef(false);
  return {
    touch: () => { dirty.current = true; },
    reset: () => { dirty.current = false; },
    close: () => {
      if (dirty.current && !window.confirm(UNSAVED_MSG)) return;
      dirty.current = false;
      onClose();
    },
  };
}

export function Drawer({
  title, onClose, children, footer, wide,
}: {
  title: React.ReactNode; onClose: () => void; children: React.ReactNode;
  footer?: React.ReactNode; wide?: boolean;
}) {
  useNavOverlay(onClose);
  const backdrop = useBackdropClose(onClose);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = (e.target || {}) as HTMLElement;
      const tag = (t.tagName || '').toLowerCase();
      // le clavier (mobile inclus) ne ferme jamais un champ en cours de saisie
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable) return;
      onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="overlay" {...backdrop}>
      <div
        className="drawer"
        style={wide ? { width: 'min(960px,100%)' } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer-head">
          <h3>{title}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><Ico.x size={18} /></button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Modal({
  title, onClose, children, footer, small,
}: {
  title: React.ReactNode; onClose: () => void; children: React.ReactNode;
  footer?: React.ReactNode; small?: boolean;
}) {
  useNavOverlay(onClose);
  const backdrop = useBackdropClose(onClose);
  return (
    <div className="overlay modal-center" {...backdrop}>
      <div
        className="modal"
        style={small ? { width: 'min(440px,92%)' } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer-head">
          <h3>{title}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><Ico.x size={18} /></button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Confirm({
  title, message, danger, onYes, onClose, yes = 'Confirmer',
}: {
  title: string; message: React.ReactNode; danger?: boolean;
  onYes: () => void; onClose: () => void; yes?: string;
}) {
  return (
    <Modal
      small
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Annuler</button>
          <button
            className={'btn ' + (danger ? 'btn-danger' : 'btn-primary')}
            onClick={() => { onYes(); onClose(); }}
          >
            {yes}
          </button>
        </>
      }
    >
      <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>{message}</p>
    </Modal>
  );
}

export function Empty({
  icon, title, sub, action,
}: { icon?: IconType; title: string; sub?: React.ReactNode; action?: React.ReactNode }) {
  const Ic = icon || Ico.doc;
  return (
    <div className="empty">
      <Ic size={46} className="ic" />
      <h3>{title}</h3>
      <div>{sub}</div>
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}

export function Kpi({
  label, value, sub, icon, tone,
}: { label: string; value: React.ReactNode; sub?: React.ReactNode; icon?: IconType; tone?: string }) {
  const Ic = icon;
  return (
    <div className={'kpi ' + (tone || '')}>
      <span className="edge" />
      <div className="lab">{Ic && <Ic size={15} />}{label}</div>
      <div className="val tnum">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

/* Garde-fou global : une erreur de rendu dans une section affiche un message clair
   au lieu de démonter toute l'application (page blanche). */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode; zone?: string },
  { err: Error | null }
> {
  constructor(p: { children: React.ReactNode; zone?: string }) {
    super(p);
    this.state = { err: null };
  }
  static getDerivedStateFromError(err: Error) {
    return { err };
  }
  componentDidCatch(err: Error, info: React.ErrorInfo) {
    console.error('[CN][ErrorBoundary]', this.props.zone || '', err, info && info.componentStack);
  }
  render() {
    if (this.state.err) {
      return (
        <div
          className="card card-pad"
          style={{ margin: '14px 0', border: '1px solid #f3c0c0', background: '#fdecec', color: '#a3232b', fontSize: 13, lineHeight: 1.6 }}
        >
          <b>Une erreur est survenue dans cette section — le reste de l&apos;application continue de fonctionner.</b>
          <div style={{ marginTop: 6, fontFamily: 'monospace', fontSize: 11.5, whiteSpace: 'pre-wrap' }}>
            {String((this.state.err && this.state.err.message) || this.state.err)}
          </div>
          <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => this.setState({ err: null })}>
            Réessayer
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/* Champ éditable inline : ressemble à du texte, s'édite au clic */
export function EditableText({
  value, onChange, placeholder, multiline, className, style, minCh = 6,
}: {
  value?: string; onChange: (v: string) => void; placeholder?: string;
  multiline?: boolean; className?: string; style?: React.CSSProperties; minCh?: number;
}) {
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  useEffect(() => {
    if (multiline && ref.current) {
      ref.current.style.height = 'auto';
      ref.current.style.height = ref.current.scrollHeight + 'px';
    }
  });
  if (multiline)
    return (
      <textarea
        ref={ref}
        className={'ed ed-m ' + (className || '')}
        style={style}
        value={value || ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  const w = Math.max(minCh, ((value && value.length) || (placeholder && placeholder.length) || minCh) + 1);
  return (
    <input
      ref={ref}
      className={'ed ' + (className || '')}
      style={{ width: w + 'ch', ...style }}
      value={value || ''}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function ListEditor({
  label, items, onChange, ph,
}: { label: string; items?: string[]; onChange: (v: string[]) => void; ph?: string }) {
  const [v, setV] = useState('');
  const add = () => {
    if (v.trim()) {
      onChange([...(items || []), v.trim()]);
      setV('');
    }
  };
  return (
    <Field label={label}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <Input
          value={v}
          placeholder={ph}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); add(); }
          }}
        />
        <button className="btn" onClick={add}><Ico.plus size={15} /></button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
        {(items || []).map((x, i) => (
          <span key={i} className="chip">
            {x}
            <button onClick={() => onChange((items || []).filter((_, j) => j !== i))}>
              <Ico.x size={13} />
            </button>
          </span>
        ))}
      </div>
    </Field>
  );
}
