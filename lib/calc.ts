/* Calculs métier — repris à l'identique de index.html.
   Règle d'or : un devis envoyé est figé. Rien ici ne relit le catalogue :
   les montants proviennent exclusivement du document lui-même. */

import type { DocRecord, Paiement, Patient } from './types';

export function patientName(p: Partial<Patient> | null | undefined): string {
  return p ? `${p.prenom || ''} ${p.nom || ''}`.trim() : '—';
}

export function devisTotal(d: DocRecord): number {
  const lines = (d.lignes || []).reduce((s, l) => s + Number(l.qty || 1) * Number(l.pu || 0), 0);
  const opts = (d.options || []).reduce((s, o) => s + Number(o.qty || 1) * Number(o.prix || 0), 0);
  return lines + opts;
}

export function paidFor(paiements: Paiement[] | undefined, refId: string | undefined): number {
  return (paiements || [])
    .filter((p) => p.refId === refId)
    .reduce((s, p) => s + Number(p.montant || 0), 0);
}

export function optsSum(r: DocRecord): number {
  return (r.options || []).reduce((s, o) => s + Number(o.qty || 1) * Number(o.prix || 0), 0);
}

/* total « affiché » : si un forfait est saisi, total = forfait + options ;
   sinon somme des lignes (anciens devis) */
export function totalAvantRemise(r: DocRecord): number {
  const f = Number(r.forfait || 0);
  return f > 0 ? f + optsSum(r) : devisTotal(r);
}

/* ----- Remise promotionnelle -----
   Champs : remiseValeur (nombre), remiseType ('montant' € | 'pourcent' %), remiseMotif (texte libre).
   Anciens documents sans ces champs → remise = 0 (aucun recalcul, montants inchangés). */
export function remiseMontant(r: DocRecord | null | undefined): number {
  const v = Number(r && r.remiseValeur);
  if (!(v > 0)) return 0;
  const base = totalAvantRemise(r as DocRecord);
  const m = r!.remiseType === 'pourcent' ? (base * Math.min(v, 100)) / 100 : v;
  return Math.min(Math.max(0, m), base); // jamais de total négatif
}

export function totalOf(r: DocRecord): number {
  return Math.max(0, totalAvantRemise(r) - remiseMontant(r));
}

/* ----- Paiements / factures ----- */
export const PAY_MODES = ['Espèces', 'Carte bancaire', 'Virement bancaire', 'Wise', 'Stripe', 'Revolut', 'Autre'];

export function factPayments(paiements: Paiement[] | undefined, refId: string | undefined): Paiement[] {
  return (paiements || [])
    .filter((p) => p.refId === refId)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}

export function sumPays(list: Paiement[] | undefined, kind: 'acompte' | 'paiement'): number {
  return (list || [])
    .filter((p) => (kind === 'acompte' ? p.type === 'acompte' : p.type !== 'acompte'))
    .reduce((s, p) => s + Number(p.montant || 0), 0);
}

export function factureStatus(f: DocRecord, payments: Paiement[] | undefined): string {
  if (f.statut === 'annulee') return 'annulee';
  const tot = totalOf(f);
  const list = payments || [];
  const paid = list.reduce((s, p) => s + Number(p.montant || 0), 0);
  if (tot > 0 && paid >= tot) return 'payee';
  if (paid > 0) return list.some((p) => p.type !== 'acompte') ? 'partielle' : 'acompte';
  return f.statut === 'envoye' ? 'envoye' : 'brouillon';
}

/* Un document parti chez une patiente ne doit plus bouger : l'éditeur reste ouvert
   mais on avertit clairement dès qu'un devis n'est plus au brouillon. */
export function estFige(d: DocRecord): boolean {
  return d.statut === 'envoye' || d.statut === 'accepte';
}
