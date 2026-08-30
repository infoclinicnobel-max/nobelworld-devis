/* Calculs métier — repris à l'identique de index.html.
   Règle d'or : un devis envoyé est figé. Rien ici ne relit le catalogue :
   les montants proviennent exclusivement du document lui-même. */

import type { DocOption, DocRecord, Paiement, Patient } from './types';

/* ----- Options retenues -----
   Une option se décide en consultation : tant qu'elle n'est pas retenue, elle
   s'affiche avec son prix mais n'entre ni dans le total, ni dans l'acompte, ni
   dans le reste à payer.

   ⚠ RÈGLE DE NON-RÉGRESSION : le champ ABSENT vaut `true`. Toutes les options
   écrites avant ce lot en sont dépourvues ; les lire comme non retenues
   retrancherait des montants de devis déjà acceptés, dont les patientes
   détiennent une copie. `undefined` et `null` valent donc « retenue ». */
export function estRetenue(o: DocOption | null | undefined): boolean {
  return !!o && o.retenue !== false;
}

const montantOption = (o: DocOption) => Number(o.qty || 1) * Number(o.prix || 0);

export function patientName(p: Partial<Patient> | null | undefined): string {
  return p ? `${p.prenom || ''} ${p.nom || ''}`.trim() : '—';
}

export function devisTotal(d: DocRecord): number {
  const lines = (d.lignes || []).reduce((s, l) => s + Number(l.qty || 1) * Number(l.pu || 0), 0);
  return lines + optsSum(d);
}

export function paidFor(paiements: Paiement[] | undefined, refId: string | undefined): number {
  return (paiements || [])
    .filter((p) => p.refId === refId)
    .reduce((s, p) => s + Number(p.montant || 0), 0);
}

/** Somme des options RETENUES — la seule qui entre dans le montant engagé. */
export function optsSum(r: DocRecord): number {
  return (r.options || []).filter(estRetenue).reduce((s, o) => s + montantOption(o), 0);
}

/** Options laissées à décider en consultation : affichées, jamais comptées. */
export function optionsADecider(r: DocRecord): DocOption[] {
  return (r.options || []).filter((o) => !estRetenue(o));
}

/** Somme de TOUTES les options, retenues ou non — sert à la ligne « si toutes retenues ». */
export function optsSumToutes(r: DocRecord): number {
  return (r.options || []).reduce((s, o) => s + montantOption(o), 0);
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

/* Montant qu'atteindrait le devis si la patiente retenait TOUTES les options.
   Calculé en rejouant le même total sur une copie où chaque option est retenue,
   plutôt qu'en additionnant à la main : une remise en pourcentage porte ainsi
   sur la bonne base, et il ne peut pas exister deux formules divergentes. */
export function totalSiToutesOptions(r: DocRecord): number {
  const opts = r.options || [];
  if (!opts.some((o) => !estRetenue(o))) return totalOf(r);
  return totalOf({ ...r, options: opts.map((o) => ({ ...o, retenue: true })) });
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

/* ----- Statuts « classés » des devis — décidé par Veys le 19 août 2026 -----

   « On ne les fait pas disparaître, on fait une rubrique pour dire ces devis,
   ils sont en attente. » Les devis n'avaient que trois états ; un refusé ou un
   sans-réponse restait éternellement « envoyé », et la corbeille devenait le
   seul nettoyage. Deux états s'ajoutent — refuse, expire — et pas plus :
   « en attente » n'est pas un état nouveau, c'est ce que « envoyé » veut déjà
   dire, et chaque état de plus est un endroit de plus où perdre un dossier.

   Les transitions sont MANUELLES, jamais calculées : `validite` porte dix
   durées saisies à la main (8 à 146 jours), et D-2026-000037 — un devis du
   28 mars, validité étirée au 21 août — a été accepté, facturé, opéré. Une
   expiration automatique l'aurait classé mort pendant des mois, sur l'affaire
   la plus vivante de la base. L'écran peut DIRE « validité dépassée »
   (validiteDepassee, calculée à l'affichage) ; il ne reclasse jamais. */
export const STATUTS_DEVIS_CLASSES = ['refuse', 'expire'] as const;

export const devisEstClasse = (statut: unknown) =>
  (STATUTS_DEVIS_CLASSES as readonly string[]).includes(String(statut || ''));

/* `aujourdhui` est fourni par l'appelant (todayISO()) : la fonction reste pure
   et sa recette rejouable. Un devis non « envoyé » ne peut pas être en retard
   de réponse — c'est précisément le cas D-2026-000037. */
export function validiteDepassee(d: DocRecord, aujourdhui: string): boolean {
  const v = String(d.validite || '');
  return d.statut === 'envoye' && /^\d{4}-\d{2}-\d{2}$/.test(v) && v < String(aujourdhui || '');
}

/* Un document parti chez une patiente ne doit plus bouger : l'éditeur reste ouvert
   mais on avertit clairement dès qu'un devis n'est plus au brouillon. Un devis
   classé (refusé, expiré) est parti lui aussi : il reste figé, quel que soit
   son sort. */
export function estFige(d: DocRecord): boolean {
  return d.statut === 'envoye' || d.statut === 'accepte' || devisEstClasse(d.statut);
}
