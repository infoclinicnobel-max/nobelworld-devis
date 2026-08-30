'use client';

import React, { useState } from 'react';
import { Confirm, Empty, Field, Input, Kpi, Modal, Select, useDirtyGuard } from './ui';
import { Ico } from './icons';
import { useApp } from './AppContext';
import { fmtDate, money, normalizeDate, todayISO } from '@/lib/format';
import { can } from '@/lib/perms';
import { factPayments, PAY_MODES, patientName, totalOf } from '@/lib/calc';
import type { Paiement } from '@/lib/types';

/* =========================================================================
   PAIEMENTS
   ------------------------------------------------------------------------- */

const TYPE_LABELS: Record<string, string> = {
  acompte: 'Acompte', paiement: 'Solde', partiel: 'Partiel',
  remboursement: 'Remboursement', autre: 'Autre',
};

export function PaymentLineEditor({ payment, onClose }: { payment: Partial<Paiement>; onClose: () => void }) {
  const { data, save, toast } = useApp();
  const cur = data.parametres.currency || '€';
  const factures = [...data.factures].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const [f, setF] = useState({
    refId: payment.refId || '',
    type: payment.type || 'paiement',
    montant: payment.montant != null ? payment.montant : ('' as number | string),
    date: normalizeDate(payment.date) || todayISO(),
    mode: payment.mode || 'Virement bancaire',
    note: payment.note || '',
  });
  const g = useDirtyGuard(onClose);
  const set = (k: string, v: unknown) => { g.touch(); setF((s) => ({ ...s, [k]: v })); };
  const isNew = !payment.id;
  const fac = data.factures.find((x) => x.id === f.refId);
  const pat = fac ? data.patients.find((x) => x.id === fac.patientId) : null;
  const others = fac ? factPayments(data.paiements, fac.id).filter((p) => p.id !== payment.id) : [];
  const dejaPaye = others.reduce((s, p) => s + Number(p.montant || 0), 0);
  const reste = fac ? Math.max(0, totalOf(fac) - dejaPaye) : null;
  const m = Number(f.montant);
  // négatif interdit sauf remboursement
  const montantOk = f.type === 'remboursement' ? !isNaN(m) && m !== 0 : m > 0;

  const submit = async () => {
    if (!f.refId) { toast('Sélectionnez la facture liée : le patient et le devis en découlent.', 'err'); return; }
    if (!montantOk) {
      toast(f.type === 'remboursement' ? 'Indiquez le montant à rembourser.' : 'Le montant doit être supérieur à 0.', 'err');
      return;
    }
    // remboursement = montant négatif dans le grand livre
    const mt = f.type === 'remboursement' ? -Math.abs(m) : m;
    if (f.type !== 'remboursement' && reste != null && mt > reste + 0.005) {
      if (
        !window.confirm(
          `Ce paiement (${money(mt, cur)}) dépasse le solde restant de la facture (${money(reste, cur)}).\nConfirmer quand même ?`,
        )
      )
        return;
    }
    const rec: Partial<Paiement> = {
      ...payment,
      refId: f.refId,
      refNum: fac ? fac.numero || '' : payment.refNum || '',
      patientId: fac ? fac.patientId || null : payment.patientId || null,
      type: f.type, montant: mt, date: f.date, mode: f.mode, devise: cur, note: f.note,
    };
    await save(
      'paiements', rec,
      `a ${isNew ? 'enregistré' : 'modifié'} un paiement (${f.type}) de ${money(mt, cur)}${fac ? ' sur ' + fac.numero : ''}`,
    );
    toast(isNew ? 'Paiement enregistré ✓ — solde et statut de la facture recalculés' : 'Paiement modifié ✓');
    onClose();
  };

  return (
    <Modal
      small
      title={isNew ? 'Ajouter un paiement' : 'Modifier le paiement'}
      onClose={g.close}
      footer={
        <>
          <button className="btn" onClick={g.close}>Annuler</button>
          <button className="btn btn-primary" disabled={!montantOk || !f.refId} onClick={submit}>
            <Ico.check size={16} />Enregistrer
          </button>
        </>
      }
    >
      <Field label="Facture liée" hint="obligatoire — détermine le patient">
        <Select value={f.refId} onChange={(e) => set('refId', e.target.value)}>
          <option value="">— Choisir une facture —</option>
          {factures.map((x) => {
            const pp = data.patients.find((y) => y.id === x.patientId);
            return (
              <option key={x.id} value={x.id}>
                {x.numero} — {patientName(pp)}
              </option>
            );
          })}
        </Select>
      </Field>
      {fac && (
        <p className="muted" style={{ fontSize: 12, margin: '-6px 0 10px', lineHeight: 1.5 }}>
          Patient : <b>{patientName(pat)}</b>
          {fac.numeroDevis ? <> · Devis lié : <b>{fac.numeroDevis}</b></> : null} · Solde restant :{' '}
          <b className="tnum">{money(reste, cur)}</b>
        </p>
      )}
      <Field label="Type de paiement">
        <Select value={f.type} onChange={(e) => set('type', e.target.value)}>
          <option value="acompte">Acompte</option>
          <option value="paiement">Solde</option>
          <option value="partiel">Paiement partiel</option>
          <option value="remboursement">Remboursement</option>
          <option value="autre">Autre</option>
        </Select>
      </Field>
      <div className="row2">
        <Field label="Montant payé" hint={'Devise : ' + cur}>
          <Input type="number" value={f.montant} onChange={(e) => set('montant', e.target.value)} />
        </Field>
        <Field label="Date du paiement">
          <Input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} />
        </Field>
      </div>
      <Field label="Mode de paiement">
        <Select value={f.mode} onChange={(e) => set('mode', e.target.value)}>
          {PAY_MODES.map((m2) => <option key={m2}>{m2}</option>)}
        </Select>
      </Field>
      <Field label="Note">
        <Input value={f.note} onChange={(e) => set('note', e.target.value)} placeholder="Optionnel" />
      </Field>
      <p className="muted" style={{ fontSize: 11.5, lineHeight: 1.5, margin: '2px 0 0' }}>
        Le champ « Référence de paiement » de l&apos;ancienne version n&apos;a pas de colonne dans{' '}
        <code>nw_paiements</code> : il est signalé dans le compte rendu et n&apos;a pas été ajouté.
      </p>
    </Modal>
  );
}

export function PaiementsView() {
  const { data, user, remove, toast } = useApp();
  const cur = data.parametres.currency || '€';
  const [edit, setEdit] = useState<Partial<Paiement> | null>(null);
  const [del, setDel] = useState<Paiement | null>(null);
  const canVoir = can(user, 'all') || can(user, 'paymentView') || can(user, 'paymentEdit');
  if (!canVoir)
    return (
      <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>
        Vous n&apos;avez pas la permission de consulter les paiements.
        <br />
        Contactez l&apos;administrateur si vous pensez qu&apos;il s&apos;agit d&apos;une erreur.
      </div>
    );

  const all = [...data.paiements].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const facIds = new Set(data.factures.map((f) => f.id));
  // Deux acomptes de 300 € pointent vers une facture supprimée du Google Sheet d'origine :
  // ils sont listés à part plutôt que masqués — et l'interface ne doit jamais planter dessus.
  const list = all.filter((p) => p.refId && facIds.has(p.refId));
  const orphelins = all.filter((p) => !p.refId || !facIds.has(p.refId));
  const total = all.reduce((s, p) => s + Number(p.montant || 0), 0);
  const byMode: Record<string, number> = {};
  all.forEach((p) => { byMode[p.mode || '—'] = (byMode[p.mode || '—'] || 0) + Number(p.montant || 0); });
  const canAdd = can(user, 'paymentEdit') || can(user, 'all');

  const ligne = (p: Paiement) => (
    <tr key={p.id}>
      <td className="muted">{fmtDate(p.date)}</td>
      <td className="t-strong">{p.refNum || '—'}</td>
      <td className="muted">{TYPE_LABELS[p.type] || 'Paiement'}</td>
      <td><span className="chip">{p.mode || '—'}</span></td>
      <td className="muted" style={{ maxWidth: 170, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {p.note || '—'}
      </td>
      <td className="tnum t-strong" style={{ textAlign: 'right' }}>{money(p.montant, cur)}</td>
      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
        {canAdd && (
          <>
            <button className="btn btn-ghost btn-sm" title="Modifier" onClick={() => setEdit(p)}>
              <Ico.edit size={15} />
            </button>
            <button className="btn btn-ghost btn-sm" title="Supprimer" onClick={() => setDel(p)}>
              <Ico.trash size={15} />
            </button>
          </>
        )}
      </td>
    </tr>
  );

  const entete = (
    <thead>
      <tr>
        <th>Date</th><th>Facture</th><th>Type</th><th>Mode</th><th>Note</th>
        <th className="r" style={{ textAlign: 'right' }}>Montant</th><th></th>
      </tr>
    </thead>
  );

  return (
    <>
      <div className="toolbar">
        <div className="sec-head" style={{ margin: 0 }}>
          <div>
            <h2>Paiements</h2>
            <div className="desc">{all.length} paiement(s)</div>
          </div>
        </div>
        <div className="sp" />
        {canAdd && (
          <button className="btn btn-primary" onClick={() => setEdit({})}>
            <Ico.plus size={16} />Ajouter un paiement
          </button>
        )}
      </div>
      <div className="grid kpis" style={{ marginBottom: 18 }}>
        <Kpi label="Total encaissé" value={money(total, cur)} icon={Ico.wallet} tone="ok" />
        <Kpi label="Nombre de paiements" value={all.length} icon={Ico.pay} />
        {Object.entries(byMode).slice(0, 3).map(([m, v]) => (
          <Kpi key={m} label={m} value={money(v, cur)} />
        ))}
      </div>
      <div className="card">
        {list.length ? (
          <table>{entete}<tbody>{list.map(ligne)}</tbody></table>
        ) : (
          <Empty icon={Ico.wallet} title="Aucun paiement" sub="Les encaissements apparaîtront ici." />
        )}
      </div>

      {orphelins.length > 0 && (
        <div className="card" style={{ marginTop: 18 }}>
          <div className="card-pad" style={{ paddingBottom: 0 }}>
            <h2 style={{ fontSize: 14, margin: 0 }}>Paiements non rattachés</h2>
            <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.55, margin: '6px 0 0' }}>
              {orphelins.length} mouvement(s) sans facture liée — la facture d&apos;origine a été supprimée. Les
              montants restent comptabilisés dans le total encaissé ; rattachez-les à une facture existante en les
              modifiant.
            </p>
          </div>
          <table>{entete}<tbody>{orphelins.map(ligne)}</tbody></table>
        </div>
      )}

      {edit && <PaymentLineEditor payment={edit} onClose={() => setEdit(null)} />}
      {del && (
        <Confirm
          danger
          title="Supprimer le paiement"
          message={`Voulez-vous vraiment supprimer ce ${del.type === 'acompte' ? 'acompte' : 'paiement'} de ${money(del.montant, cur)} ?`}
          yes="Supprimer"
          onClose={() => setDel(null)}
          onYes={async () => {
            await remove(
              'paiements', del.id!,
              `a supprimé un ${del.type === 'acompte' ? 'acompte' : 'paiement'} de ${money(del.montant, cur)}${del.refNum ? ' sur ' + del.refNum : ''}`,
            );
            toast('Paiement supprimé', 'err');
          }}
        />
      )}
    </>
  );
}
