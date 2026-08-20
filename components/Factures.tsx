'use client';

import React, { useState } from 'react';
import {
  Confirm, Drawer, Empty, Field, Input, Kpi, Modal, Select, StatusBadge, Textarea, useDirtyGuard,
} from './ui';
import { Ico } from './icons';
import { DocumentView } from './DocumentView';
import { useApp } from './AppContext';
import { fmtDate, money, todayISO } from '@/lib/format';
import { can, estDeMoi, userLabel } from '@/lib/perms';
import {
  factPayments, factureStatus, PAY_MODES, patientName, remiseMontant, sumPays, totalOf,
} from '@/lib/calc';
import type { DocRecord, Paiement } from '@/lib/types';

/* =========================================================================
   FACTURES
   Création : manuelle ou depuis un devis (reprise automatique complète, modifiable)
   ------------------------------------------------------------------------- */

export function FactureCreateModal({
  onClose, onCreated,
}: { onClose: () => void; onCreated?: (f: DocRecord) => void }) {
  const { data, user, save, nextNumber, toast } = useApp();
  const cur = data.parametres.currency || '€';
  const devisList = [...data.devis].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const patients = [...data.patients].sort((a, b) => String(a.nom || '').localeCompare(String(b.nom || '')));
  const [f, setF] = useState({
    devisId: '', patientId: '', date: todayISO(), typeFacture: 'totale',
    forfait: '' as string | number, acompte: 0 as string | number, dejaPaye: '' as string | number,
    modePaye: 'Virement bancaire', statut: 'brouillon', noteInterne: '', noteClient: '',
  });
  const [busy, setBusy] = useState(false);
  const g = useDirtyGuard(onClose);
  const set = (k: string, v: unknown) => { g.touch(); setF((s) => ({ ...s, [k]: v })); };
  const dv = data.devis.find((d) => d.id === f.devisId);
  const pickDevis = (id: string) => {
    const d = data.devis.find((x) => x.id === id);
    if (!d) {
      setF((s) => ({ ...s, devisId: '', patientId: '' }));
      return;
    }
    setF((s) => ({ ...s, devisId: id, patientId: d.patientId || '', forfait: '', acompte: Number(d.acompte || 0) }));
  };
  const preview: DocRecord = dv
    ? { ...dv, ...(f.forfait !== '' ? { forfait: Number(f.forfait) } : {}) }
    : { forfait: Number(f.forfait || 0) };
  const total = Math.max(0, totalOf(preview));
  const paye = Number(f.dejaPaye || 0);

  const submit = async () => {
    if (busy) return;
    if (!f.patientId) { toast('Une facture doit obligatoirement être liée à un patient.', 'err'); return; }
    if (paye < 0) { toast('Le montant déjà payé ne peut pas être négatif.', 'err'); return; }
    if (
      paye > total + 0.005 &&
      !window.confirm(
        `Le montant déjà payé (${money(paye, cur)}) dépasse le total de la facture (${money(total, cur)}).\nConfirmer quand même ?`,
      )
    )
      return;
    setBusy(true);
    try {
      const numero = await nextNumero();
      let rec: DocRecord;
      if (dv) {
        // reprise complète du devis : interventions, prix, remise, textes PDF, date d'opération, chirurgien, clinique
        rec = { ...dv, id: undefined, numero, numeroDevis: dv.numero, devisId: dv.id, createdBy: userLabel(user) };
        delete rec.createdAt;
        delete rec.updatedAt;
      } else {
        rec = { numero, patientId: f.patientId, actes: [], inc: [], exc: [], options: [], createdBy: userLabel(user) };
      }
      if (rec.bqIban == null && rec.bqBic == null) {
        const PB = data.parametres || ({} as typeof data.parametres);
        rec.bqNom = PB.bankName || '';
        rec.bqAdresse = PB.bankAddress || '';
        rec.bqIban = PB.iban || '';
        rec.bqBic = PB.bic || '';
      }
      if (rec.devise == null) rec.devise = (data.parametres && data.parametres.currency) || '€';
      rec.date = f.date;
      rec.statut = f.statut;
      rec.typeFacture = f.typeFacture;
      if (f.forfait !== '') rec.forfait = Number(f.forfait);
      rec.acompte = Number(f.acompte || 0);
      if (f.noteInterne) rec.noteInterne = f.noteInterne;
      if (f.noteClient) rec.factNotes = f.noteClient; // note visible = bloc « Mentions administratives » du PDF facture
      const saved = (await save(
        'factures', rec, `a créé la facture ${numero}${dv ? ' depuis le devis ' + dv.numero : ''}`,
      )) as DocRecord;
      if (paye > 0) {
        await save(
          'paiements',
          {
            refId: saved.id, refNum: numero, patientId: rec.patientId || null,
            type: paye >= total ? 'paiement' : 'acompte', montant: paye, date: f.date,
            mode: f.modePaye, devise: cur, note: 'Encaissé à la création de la facture',
          },
          `a enregistré un paiement de ${money(paye, cur)} sur ${numero}`,
        );
      }
      toast('Facture créée : ' + numero);
      if (onCreated) onCreated(saved);
      else onClose();
    } catch {
      /* erreurs déjà affichées par ctx.save */
    } finally {
      setBusy(false);
    }
  };
  const nextNumero = () => nextNumber('facture');

  return (
    <Modal
      title="Ajouter une facture"
      onClose={g.close}
      footer={
        <>
          <button className="btn" onClick={g.close}>Annuler</button>
          <button className="btn btn-primary" disabled={busy || !f.patientId} onClick={submit}>
            <Ico.check size={16} />{busy ? 'Création…' : 'Créer la facture'}
          </button>
        </>
      }
    >
      <Field label="Créer depuis un devis" hint="optionnel">
        <Select value={f.devisId} onChange={(e) => pickDevis(e.target.value)}>
          <option value="">— Facture manuelle —</option>
          {devisList.map((d) => {
            const p = data.patients.find((x) => x.id === d.patientId);
            return (
              <option key={d.id} value={d.id}>
                {/* Un devis classé reste facturable — une patiente qui change
                    d'avis ne repart pas de zéro — mais la mention empêche de
                    le faire par inadvertance. */}
                {d.numero} — {patientName(p)} — {money(totalOf(d), cur)}
                {d.statut === 'refuse' ? ' (refusé)' : d.statut === 'expire' ? ' (expiré)' : ''}
              </option>
            );
          })}
        </Select>
      </Field>
      {dv && (
        <p className="muted" style={{ fontSize: 12, margin: '-6px 0 10px', lineHeight: 1.5 }}>
          Repris automatiquement : patient, interventions, prix
          {remiseMontant(dv) > 0 ? <>, remise <b>-{money(remiseMontant(dv), cur)}</b></> : null}, acompte, date
          d&apos;opération{dv.chirurgien ? ', chirurgien' : ''}{dv.hopital ? ', clinique' : ''}. Tout reste
          modifiable ci-dessous.
        </p>
      )}
      <Field label="Patient" hint={dv ? 'repris du devis' : 'obligatoire'}>
        <Select value={f.patientId} disabled={!!dv} onChange={(e) => set('patientId', e.target.value)}>
          <option value="">— Choisir un patient —</option>
          {patients.map((p) => (
            <option key={p.id} value={p.id}>{patientName(p)}</option>
          ))}
        </Select>
      </Field>
      <div className="row2">
        <Field label="Numéro de facture"><Input value="Automatique à l'enregistrement" disabled /></Field>
        <Field label="Date de facture">
          <Input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} />
        </Field>
      </div>
      <div className="row2">
        <Field label="Type de facture">
          <Select value={f.typeFacture} onChange={(e) => set('typeFacture', e.target.value)}>
            <option value="acompte">Facture d&apos;acompte</option>
            <option value="solde">Facture de solde</option>
            <option value="totale">Facture totale</option>
            <option value="manuelle">Facture manuelle</option>
          </Select>
        </Field>
        <Field label="Statut">
          <Select value={f.statut} onChange={(e) => set('statut', e.target.value)}>
            <option value="brouillon">Brouillon</option>
            <option value="envoye">Envoyée</option>
            <option value="annulee">Annulée</option>
          </Select>
        </Field>
      </div>
      <p className="muted" style={{ fontSize: 11.5, margin: '-6px 0 10px', lineHeight: 1.5 }}>
        « Acompte reçu », « Paiement partiel » et « Payée » se calculent automatiquement d&apos;après les paiements
        enregistrés.
      </p>
      <div className="row2">
        <Field label="Montant total" hint={cur}>
          <Input
            type="number"
            value={f.forfait}
            placeholder={dv ? String(dv.forfait || '') : '0'}
            onChange={(e) => set('forfait', e.target.value)}
          />
        </Field>
        <Field label="Acompte prévu" hint={cur}>
          <Input type="number" value={f.acompte} onChange={(e) => set('acompte', e.target.value)} />
        </Field>
      </div>
      <div className="row2">
        <Field label="Montant déjà payé" hint="créera un paiement lié">
          <Input type="number" min="0" value={f.dejaPaye} onChange={(e) => set('dejaPaye', e.target.value)} />
        </Field>
        <Field label="Mode de paiement (si déjà payé)">
          <Select value={f.modePaye} onChange={(e) => set('modePaye', e.target.value)}>
            {PAY_MODES.map((m) => <option key={m}>{m}</option>)}
          </Select>
        </Field>
      </div>
      <div
        style={{
          background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10,
          padding: '8px 12px', fontSize: 13, margin: '2px 0 12px',
        }}
      >
        Total : <b className="tnum">{money(total, cur)}</b> · Déjà payé : <b className="tnum">{money(paye, cur)}</b> ·
        Solde restant : <b className="tnum">{money(Math.max(0, total - paye), cur)}</b>
      </div>
      <Field label="Note interne" hint="jamais visible sur le PDF">
        <Input value={f.noteInterne} onChange={(e) => set('noteInterne', e.target.value)} placeholder="Optionnel" />
      </Field>
      <Field
        label="Note visible sur la facture"
        hint="remplace le bloc « Mentions administratives » du PDF pour ce document"
      >
        <Textarea
          style={{ minHeight: 60 }}
          value={f.noteClient}
          onChange={(e) => set('noteClient', e.target.value)}
          placeholder="Optionnel"
        />
      </Field>
    </Modal>
  );
}

export function FacturesView() {
  const { data, user, remove, toast } = useApp();
  const [detail, setDetail] = useState<DocRecord | null>(null);
  const [del, setDel] = useState<DocRecord | null>(null);
  const [create, setCreate] = useState(false);
  const cur = data.parametres.currency || '€';
  const seeAllFact =
    can(user, 'all') || can(user, 'factureCreate') || can(user, 'devisViewAll') ||
    can(user, 'paymentView') || can(user, 'paymentEdit');
  const visible = seeAllFact ? data.factures : data.factures.filter((f) => estDeMoi(user, f.createdBy));
  const list = [...visible].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  return (
    <>
      <div className="toolbar">
        <div className="sec-head" style={{ margin: 0 }}>
          <div>
            <h2>Factures</h2>
            <div className="desc">{list.length} facture(s)</div>
          </div>
        </div>
        <div className="sp" />
        {(can(user, 'factureCreate') || can(user, 'all')) && (
          <button className="btn btn-primary" onClick={() => setCreate(true)}>
            <Ico.plus size={16} />Ajouter une facture
          </button>
        )}
      </div>
      <div className="card">
        {list.length ? (
          <table>
            <thead>
              <tr>
                <th>N°</th><th>Patient</th><th>Date</th><th>Statut</th>
                <th className="r" style={{ textAlign: 'right' }}>Payé / Total</th><th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((f) => {
                const p = data.patients.find((x) => x.id === f.patientId);
                const pays = factPayments(data.paiements, f.id);
                const paid = pays.reduce((s, pm) => s + Number(pm.montant || 0), 0);
                const tot = totalOf(f);
                return (
                  <tr key={f.id} className="clickable" onClick={() => setDetail(f)}>
                    <td className="t-strong">{f.numero}</td>
                    <td>{patientName(p)}</td>
                    <td className="muted">{fmtDate(f.date)}</td>
                    <td><StatusBadge s={factureStatus(f, pays)} /></td>
                    <td style={{ textAlign: 'right' }}>
                      <span className="tnum t-strong">{money(paid, cur)}</span>{' '}
                      <span className="muted tnum">/ {money(tot, cur)}</span>
                    </td>
                    <td onClick={(e) => e.stopPropagation()} style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {(can(user, 'paymentEdit') || can(user, 'all') || can(user, 'factureCreate')) && (
                        <button className="btn btn-ghost btn-sm" title="Paiements" onClick={() => setDetail(f)}>
                          <Ico.wallet size={15} />
                        </button>
                      )}
                      {can(user, 'all') && (
                        <button className="btn btn-ghost btn-sm btn-danger" title="Supprimer" onClick={() => setDel(f)}>
                          <Ico.trash size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <Empty
            icon={Ico.invoice}
            title="Aucune facture"
            sub="Transformez un devis accepté en facture depuis le module Devis."
          />
        )}
      </div>
      {create && (
        <FactureCreateModal
          onClose={() => setCreate(false)}
          onCreated={(f) => { setCreate(false); setDetail(f); }}
        />
      )}
      {detail && <FactureDetail facture={detail} onClose={() => setDetail(null)} />}
      {del && (
        <Confirm
          danger
          title="Supprimer la facture"
          message={`Supprimer ${del.numero} ?`}
          yes="Supprimer"
          onClose={() => setDel(null)}
          onYes={async () => {
            await remove('factures', del.id!, `a supprimé la facture ${del.numero}`);
            toast('Facture supprimée', 'err');
          }}
        />
      )}
    </>
  );
}

export function FactureDetail({ facture, onClose }: { facture: DocRecord; onClose: () => void }) {
  const { data, user, save, remove, toast } = useApp();
  const cur = data.parametres.currency || '€';
  const f = data.factures.find((x) => x.id === facture.id) || facture; // version à jour
  const p = data.patients.find((x) => x.id === f.patientId) || {};
  const pays = factPayments(data.paiements, f.id);
  const tot = totalOf(f);
  const totAc = sumPays(pays, 'acompte');
  const totPa = sumPays(pays, 'paiement');
  const totalPaid = totAc + totPa;
  const reste = Math.max(0, tot - totalPaid);
  const statut = factureStatus(f, pays);
  const [edit, setEdit] = useState<{ payment?: Paiement; type: string } | null>(null);
  const [del, setDel] = useState<Paiement | null>(null);
  const [viewDoc, setViewDoc] = useState(false);
  const canEdit = can(user, 'paymentEdit') || can(user, 'all') || can(user, 'factureCreate');
  // Coordonnées bancaires : réservées à l'administrateur (ou permission « Modifier les paramètres »)
  const canBank = can(user, 'all') || can(user, 'paramEdit');
  const setStatut = (st: string, msg: string) => save('factures', { ...f, statut: st }, msg);

  return (
    <Drawer
      wide
      title={'Facture ' + f.numero}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Fermer</button>
          <button className="btn btn-primary" onClick={() => setViewDoc(true)}>
            <Ico.print size={16} />Aperçu / PDF
          </button>
        </>
      }
    >
      <div className="sec-head" style={{ marginTop: 0 }}>
        <div>
          <h2 style={{ fontSize: 16, margin: 0 }}>Résumé financier</h2>
          <div className="desc" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {patientName(p)} · <StatusBadge s={statut} />
          </div>
        </div>
      </div>
      <div className="grid kpis" style={{ marginBottom: 16 }}>
        <Kpi label="Total facture" value={money(tot, cur)} icon={Ico.invoice} />
        <Kpi label="Total acomptes" value={money(totAc, cur)} icon={Ico.wallet} />
        <Kpi label="Total paiements" value={money(totPa, cur)} icon={Ico.pay} />
        <Kpi label="Reste à payer" value={money(reste, cur)} tone={reste <= 0 && tot > 0 ? 'ok' : ''} icon={Ico.euro} />
      </div>

      {canEdit && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
          {statut !== 'payee' && f.statut !== 'envoye' && f.statut !== 'annulee' && (
            <button className="btn btn-sm" onClick={() => setStatut('envoye', `a marqué ${f.numero} comme envoyée`)}>
              <Ico.send size={14} />Marquer envoyée
            </button>
          )}
          {f.statut !== 'annulee' ? (
            <button
              className="btn btn-sm btn-danger"
              onClick={() => setStatut('annulee', `a annulé la facture ${f.numero}`)}
            >
              <Ico.x size={14} />Annuler la facture
            </button>
          ) : (
            <button
              className="btn btn-sm"
              onClick={() => setStatut('brouillon', `a réactivé la facture ${f.numero}`)}
            >
              <Ico.check size={14} />Réactiver
            </button>
          )}
        </div>
      )}

      {canBank && (
        <div style={{ margin: '0 0 14px' }}>
          <button
            className="btn btn-sm"
            onClick={async () => {
              if (
                !window.confirm(
                  'Souhaitez-vous remplacer les coordonnées bancaires de ce document par les coordonnées actuellement enregistrées dans les paramètres ?\n\nOK = Actualiser · Annuler = Conserver',
                )
              )
                return;
              const PB = data.parametres || ({} as typeof data.parametres);
              await save(
                'factures',
                { ...f, bqNom: PB.bankName || '', bqAdresse: PB.bankAddress || '', bqIban: PB.iban || '', bqBic: PB.bic || '' },
                `a actualisé les coordonnées bancaires de la facture ${f.numero}`,
              );
              toast('Coordonnées bancaires de la facture actualisées');
            }}
          >
            <Ico.check size={14} />Actualiser avec les coordonnées bancaires actuelles
          </button>
        </div>
      )}
      <div className="sec-head">
        <div>
          <h2 style={{ fontSize: 16, margin: 0 }}>Historique des paiements</h2>
          <div className="desc">{pays.length} mouvement(s)</div>
        </div>
        <div className="sp" />
        {canEdit && (
          <>
            <button className="btn btn-sm" onClick={() => setEdit({ type: 'acompte' })}>
              <Ico.plus size={14} />Ajouter un acompte
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => setEdit({ type: 'paiement' })}>
              <Ico.plus size={14} />Ajouter un paiement
            </button>
          </>
        )}
      </div>
      <div className="card">
        {pays.length ? (
          <table>
            <thead>
              <tr>
                <th>Date</th><th>Type</th><th>Mode</th>
                <th className="r" style={{ textAlign: 'right' }}>Montant</th><th></th>
              </tr>
            </thead>
            <tbody>
              {pays.map((pm) => {
                const isAc = pm.type === 'acompte';
                return (
                  <tr key={pm.id}>
                    <td className="muted">{fmtDate(pm.date)}</td>
                    <td>
                      <span className={'badge ' + (isAc ? 'b-wait' : 'b-paid')}>
                        <span className="dot"></span>{isAc ? 'Acompte' : 'Paiement'}
                      </span>
                    </td>
                    <td>{pm.mode || '—'}</td>
                    <td className="tnum t-strong" style={{ textAlign: 'right' }}>{money(pm.montant, cur)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {canEdit && (
                        <>
                          <button
                            className="btn btn-ghost btn-sm"
                            title="Modifier"
                            onClick={() => setEdit({ payment: pm, type: isAc ? 'acompte' : 'paiement' })}
                          >
                            <Ico.edit size={15} />
                          </button>
                          <button className="btn btn-ghost btn-sm btn-danger" title="Supprimer" onClick={() => setDel(pm)}>
                            <Ico.trash size={15} />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <Empty
            icon={Ico.wallet}
            title="Aucun paiement"
            sub="Ajoutez un acompte ou un paiement avec les boutons ci-dessus."
          />
        )}
      </div>

      {edit && (
        <PaymentEditor
          facture={f}
          payment={edit.payment}
          type={edit.type}
          reste={reste}
          onClose={() => setEdit(null)}
        />
      )}
      {del && (
        <Confirm
          danger
          title="Supprimer ce paiement"
          message={`Voulez-vous vraiment supprimer ce ${del.type === 'acompte' ? 'acompte' : 'paiement'} de ${money(del.montant, cur)} ?`}
          yes="Supprimer"
          onClose={() => setDel(null)}
          onYes={async () => {
            await remove(
              'paiements', del.id!,
              `a supprimé un ${del.type === 'acompte' ? 'acompte' : 'paiement'} de ${money(del.montant, cur)} sur ${f.numero}`,
            );
            toast('Paiement supprimé', 'err');
          }}
        />
      )}
      {viewDoc && <DocumentView record={f} type="facture" onClose={() => setViewDoc(false)} />}
    </Drawer>
  );
}

export function PaymentEditor({
  facture, payment, type, reste, onClose,
}: {
  facture: DocRecord; payment?: Paiement; type: string; reste: number; onClose: () => void;
}) {
  const { data, save, toast } = useApp();
  const cur = data.parametres.currency || '€';
  const isEdit = !!(payment && payment.id);
  const [f, setF] = useState({
    type: (payment && payment.type) || type || 'paiement',
    montant: payment ? payment.montant : type === 'acompte' ? '' : reste || '',
    date: (payment && payment.date) || todayISO(),
    mode: (payment && payment.mode) || 'Virement bancaire',
  });
  const g = useDirtyGuard(onClose);
  const set = (k: string, v: unknown) => { g.touch(); setF((s) => ({ ...s, [k]: v })); };
  const label = f.type === 'acompte' ? 'acompte' : 'paiement';
  const submit = async () => {
    const rec: Partial<Paiement> = {
      ...(payment || {}),
      refId: facture.id!, refNum: facture.numero || '', patientId: facture.patientId || null,
      type: f.type, montant: Number(f.montant), date: String(f.date), mode: f.mode, devise: cur,
    };
    await save(
      'paiements', rec,
      `${isEdit ? 'a modifié' : 'a ajouté'} un ${label} de ${money(Number(f.montant), cur)} sur ${facture.numero}`,
    );
    toast(isEdit ? 'Mouvement modifié' : 'Mouvement ajouté');
    onClose();
  };
  return (
    <Modal
      small
      title={(isEdit ? 'Modifier ' : 'Ajouter ') + (f.type === 'acompte' ? 'un acompte' : 'un paiement')}
      onClose={g.close}
      footer={
        <>
          <button className="btn" onClick={g.close}>Annuler</button>
          <button className="btn btn-primary" disabled={!(Number(f.montant) > 0)} onClick={submit}>
            <Ico.check size={16} />{isEdit ? 'Enregistrer' : 'Ajouter'}
          </button>
        </>
      }
    >
      <Field label="Type">
        <Select value={f.type} onChange={(e) => set('type', e.target.value)}>
          <option value="acompte">Acompte</option>
          <option value="paiement">Paiement</option>
        </Select>
      </Field>
      <div className="row2">
        <Field label="Montant" hint={cur}>
          <Input type="number" value={f.montant} onChange={(e) => set('montant', e.target.value)} />
        </Field>
        <Field label="Date">
          <Input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} />
        </Field>
      </div>
      <Field label="Mode de paiement">
        <Select value={f.mode} onChange={(e) => set('mode', e.target.value)}>
          {PAY_MODES.map((m) => <option key={m}>{m}</option>)}
        </Select>
      </Field>
    </Modal>
  );
}
