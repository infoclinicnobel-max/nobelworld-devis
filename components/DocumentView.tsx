'use client';

import React, { useEffect } from 'react';
import { Drawer } from './ui';
import { Ico } from './icons';
import { DevisDoc } from './DevisDoc';
import { useApp } from './AppContext';
import { pdfFileName } from '@/lib/format';
import { paidFor } from '@/lib/calc';
import type { DocRecord } from '@/lib/types';

export function DocumentView({
  record, type, onClose, list, onChange,
}: {
  record: DocRecord;
  type: 'devis' | 'facture';
  onClose: () => void;
  list?: DocRecord[];
  onChange?: (d: DocRecord) => void;
}) {
  const { data } = useApp();
  const s = data.parametres;
  const isF = type === 'facture';
  // Navigation dans l'ordre exact de la liste affichée (filtres/recherche conservés)
  const items = Array.isArray(list) && list.length ? list : [record];
  const idx = Math.max(0, items.findIndex((x) => x.id === record.id));
  const rec = items[idx] || record; // données à jour même après un rafraîchissement
  const canPrev = idx > 0;
  const canNext = idx < items.length - 1;
  const goTo = (i: number) => {
    if (!onChange || i < 0 || i >= items.length) return;
    onChange(items[i]);
  };
  const p = data.patients.find((x) => x.id === rec.patientId) || {};

  // Nom du fichier PDF : le navigateur reprend le titre de la page au moment de l'impression
  // (bouton Imprimer / PDF, Ctrl+P ou partage → PDF sur mobile). Restauré à la fermeture.
  useEffect(() => {
    const old = document.title;
    document.title = pdfFileName((s && s.company) || 'Clinic NobelWorld', type, p);
    return () => {
      document.title = old;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec && rec.id, (p as { id?: string }).id, type]);

  const paid = isF ? paidFor(data.paiements, rec.id) : Number(rec.acompte || 0);

  // Raccourcis clavier ← / → (ignorés quand on tape dans un champ)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = (e.target || {}) as HTMLElement;
      const tag = (t.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable) return;
      if (e.key === 'ArrowLeft' && canPrev) { e.preventDefault(); goTo(idx - 1); }
      else if (e.key === 'ArrowRight' && canNext) { e.preventDefault(); goTo(idx + 1); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, items, canPrev, canNext]);

  // Impression / PDF multi-pages : on clone le document directement sous <body>
  // pour laisser le navigateur paginer normalement (sans troncature en position absolue).
  useEffect(() => {
    const onBefore = () => {
      if (document.getElementById('print-clone')) return;
      const src = document.getElementById('print-area');
      if (!src) return;
      const clone = src.cloneNode(true) as HTMLElement;
      clone.id = 'print-clone';
      document.body.appendChild(clone);
      document.body.classList.add('printing');
    };
    const onAfter = () => {
      document.body.classList.remove('printing');
      const c = document.getElementById('print-clone');
      if (c) c.remove();
    };
    window.addEventListener('beforeprint', onBefore);
    window.addEventListener('afterprint', onAfter);
    return () => {
      window.removeEventListener('beforeprint', onBefore);
      window.removeEventListener('afterprint', onAfter);
      onAfter();
    };
  }, []);

  const doPrint = () => { setTimeout(() => window.print(), 30); };
  const label = isF ? 'Facture' : 'Devis';

  return (
    <Drawer
      wide
      title={label + ' ' + (rec.numero || '')}
      onClose={onClose}
      footer={
        <>
          <div className="docnav">
            <button className="btn btn-sm" disabled={!canPrev} onClick={() => goTo(idx - 1)} title="Précédent (←)">
              <Ico.chevron size={16} style={{ transform: 'rotate(180deg)' }} />
            </button>
            <span className="docnav-c">{label} {idx + 1} / {items.length}</span>
            <button className="btn btn-sm" disabled={!canNext} onClick={() => goTo(idx + 1)} title="Suivant (→)">
              <Ico.chevron size={16} />
            </button>
          </div>
          <button className="btn" onClick={onClose}>Fermer</button>
          <button className="btn btn-primary" onClick={doPrint}>
            <Ico.print size={16} />Imprimer / PDF
          </button>
        </>
      }
    >
      <div id="print-area">
        <DevisDoc record={rec} settings={s} patient={p} type={type} paid={paid} editable={false} />
      </div>
    </Drawer>
  );
}
