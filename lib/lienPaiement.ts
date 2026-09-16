/* Lien de paiement Paysera depuis un devis — la règle, PURE et sans connexion.

   Décidé avec Veys le 16/09/2026. Toute la mécanique Paysera (identifiants,
   signature, appel API) vit dans `clinicnobel-next`, qui expose un endpoint
   interne : POST https://www.clinicnobel.com/api/paysera/lien-devis, protégé
   par un secret partagé. Ce dépôt ne parle JAMAIS à Paysera : il appelle cet
   endpoint depuis SA route serveur (app/api/paysera/lien-devis) et affiche
   le résultat. Le secret ne descend jamais au navigateur.

   Trois invariants, tous vérifiables par la recette
   (scripts/recette-lien-paiement.ts) :

   · le MONTANT vient du devis enregistré — l'acompte saisi sur le devis, ou
     le solde (total du devis − déjà encaissé) — jamais d'un champ libre ;
   · le site n'a AUCUNE mémoire du lien : chaque appel en crée un neuf,
     valable 7 jours. C'est ici (`nw_liens_paiement`) qu'on le conserve, et
     on n'en redemande pas un tant qu'un lien vivant existe pour le même
     montant, sauf demande explicite (lien perdu, expiré) ;
   · le STATUT du paiement se lit dans `nw_paiements` filtré sur
     `ref_num` = numéro du devis (le site y écrit, sur webhook confirmé,
     mode « Paysera », type acompte/paiement, note = référence Paysera).
     Aucun champ « payé » sur le devis — convention existante conservée. */

import { totalOf } from './calc';
import { fmtDate, money } from './format';
import type { DocRecord, LienPaiement, Paiement } from './types';

/** `nw_paiements.mode` écrit par le site sur webhook confirmé. */
export const MODE_PAYSERA = 'Paysera';

export const TYPES_LIEN = ['acompte', 'paiement'] as const;
export type TypeLien = (typeof TYPES_LIEN)[number];
export const estTypeLien = (v: unknown): v is TypeLien =>
  (TYPES_LIEN as readonly string[]).includes(String(v));

/** Langues acceptées par l'endpoint du site — celle de la page de paiement. */
export const LANGUES_LIEN: readonly (readonly [string, string])[] = [
  ['fr', 'Français'], ['en', 'English'], ['tr', 'Türkçe'], ['es', 'Español'], ['it', 'Italiano'], ['de', 'Deutsch'],
];
export const LANGUE_DEFAUT = 'fr';
export const estLangueLien = (v: unknown) => LANGUES_LIEN.some(([code]) => code === String(v));

/** Bornes du contrat : EUR décimal, 1 à 50 000 (pas en centimes). */
export const MONTANT_MIN = 1;
export const MONTANT_MAX = 50_000;

/* Sur quels statuts on propose le lien : un devis ENVOYÉ (la patiente l'a,
   elle peut réserver par un acompte) ou ACCEPTÉ (elle paie). Jamais un
   brouillon — il n'est pas parti — ni un classé (refusé, expiré) — figé,
   il ne fait plus foi. */
export const STATUTS_LIEN_POSSIBLE = ['envoye', 'accepte'] as const;
export const peutProposerLien = (d: Pick<DocRecord, 'statut'>) =>
  (STATUTS_LIEN_POSSIBLE as readonly string[]).includes(String(d.statut || ''));

/* Le contrat ne connaît que l'euro. La base mélange '€' et 'EUR' (jamais
   normalisés, voir README) ; une devise vide vaut le défaut de l'application. */
export const estEuro = (devise: unknown) => {
  const v = String(devise ?? '').trim().toUpperCase();
  return v === '' || v === '€' || v === 'EUR';
};

export const arrondi2 = (n: unknown) => Math.round(Number(n || 0) * 100) / 100;

/* ---------------------------------------------------------- paiements */

/** Les paiements Paysera de CE devis : `ref_num` = numéro du devis, mode « Paysera ». */
export function paiementsPaysera(paiements: Paiement[] | undefined, numero: string | undefined): Paiement[] {
  const n = String(numero || '').trim();
  if (!n) return [];
  return (paiements || [])
    .filter((p) => String(p.refNum || '').trim() === n && String(p.mode || '').trim().toLowerCase() === MODE_PAYSERA.toLowerCase())
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}

/* Tout ce qui a déjà été encaissé sur l'affaire : les paiements portés par le
   numéro du devis (ceux du site, ou saisis ainsi) ET ceux portés par une
   facture née de ce devis (`devis_id`) — c'est là que vivent les acomptes
   par virement d'aujourd'hui. Dédoublonné par identifiant. */
export function paiementsDuDevis(
  paiements: Paiement[] | undefined,
  devis: Pick<DocRecord, 'id' | 'numero'>,
  factures: Pick<DocRecord, 'id' | 'devisId'>[] | undefined,
): Paiement[] {
  const numero = String(devis.numero || '').trim();
  const idsFactures = new Set(
    (factures || []).filter((f) => devis.id && String(f.devisId || '') === String(devis.id)).map((f) => String(f.id || '')),
  );
  const vus = new Set<string>();
  const out: Paiement[] = [];
  for (const p of paiements || []) {
    const parNumero = !!numero && String(p.refNum || '').trim() === numero;
    const parFacture = !!p.refId && idsFactures.has(String(p.refId));
    if (!parNumero && !parFacture) continue;
    const cle = String(p.id || '') || `${p.refNum}|${p.date}|${p.montant}`;
    if (vus.has(cle)) continue;
    vus.add(cle);
    out.push(p);
  }
  return out;
}

/** Somme signée : un remboursement (montant négatif) se retranche. */
export const encaisse = (liste: Paiement[]) => arrondi2(liste.reduce((s, p) => s + Number(p.montant || 0), 0));

/* ------------------------------------------------------- propositions */

export interface Proposition {
  type: TypeLien;
  libelle: string;
  /** Le montant qui partirait — calculé, jamais saisi. */
  montant: number;
  /** Vide = proposable. Sinon, pourquoi le bouton est éteint, en clair. */
  indisponible?: string;
}

/* Deux propositions, et pas plus : l'acompte du devis, le solde du devis.
   Chacune est éteinte avec sa raison plutôt que cachée — Veys doit voir
   POURQUOI un lien n'est pas proposable (déjà encaissé, hors bornes…). */
export function propositions(
  devis: DocRecord,
  paiements: Paiement[] | undefined,
  factures: DocRecord[] | undefined,
  cur = '€',
): Proposition[] {
  const total = arrondi2(totalOf(devis));
  const deja = paiementsDuDevis(paiements, devis, factures);
  const dejaMontant = encaisse(deja);
  const acompteRecu = paiementsPaysera(paiements, devis.numero).find((p) => p.type === 'acompte');

  const acompte = arrondi2(devis.acompte);
  const solde = arrondi2(total - dejaMontant);

  const bornes = (m: number): string | undefined => {
    if (m < MONTANT_MIN) return `montant inférieur au minimum Paysera (${money(MONTANT_MIN, cur)})`;
    if (m > MONTANT_MAX) return `montant supérieur au plafond Paysera (${money(MONTANT_MAX, cur)})`;
    return undefined;
  };

  const propAcompte: Proposition = {
    type: 'acompte',
    libelle: `Acompte du devis — ${money(acompte, cur)}`,
    montant: acompte,
    indisponible: acompte <= 0
      ? 'aucun acompte n’est saisi sur ce devis'
      : acompteRecu
        ? `un acompte Paysera de ${money(acompteRecu.montant, cur)} a déjà été encaissé le ${fmtDate(acompteRecu.date)}`
        : bornes(acompte),
  };
  const propSolde: Proposition = {
    type: 'paiement',
    libelle: dejaMontant > 0
      ? `Solde du devis — ${money(solde, cur)} (total ${money(total, cur)} − déjà encaissé ${money(dejaMontant, cur)})`
      : `Totalité du devis — ${money(solde, cur)}`,
    montant: solde,
    indisponible: total <= 0
      ? 'le devis n’a pas de montant'
      : solde <= 0
        ? 'ce devis est déjà entièrement réglé'
        : bornes(solde),
  };
  return [propAcompte, propSolde];
}

/* ------------------------------------------------------ mémoire du lien */

const horodatage = (iso: string) => {
  const t = Date.parse(String(iso || ''));
  return isNaN(t) ? 0 : t;
};

export const lienExpire = (l: Pick<LienPaiement, 'expiresAt'>, maintenant: number) =>
  horodatage(l.expiresAt) <= maintenant;

/* Un lien encore valable, du même type et du MÊME montant, se réutilise :
   le site en créerait sinon un second, tout aussi valable, et deux liens
   vivants pour une même somme sont une source de double paiement. Un montant
   différent (acompte modifié sur le devis) n'est pas « le même lien ». */
export function lienVivant(
  liens: LienPaiement[] | undefined,
  type: TypeLien,
  montant: number,
  maintenant: number,
): LienPaiement | null {
  const candidats = (liens || [])
    .filter((l) => l.type === type && Math.abs(Number(l.montant) - montant) < 0.005 && !lienExpire(l, maintenant) && !!l.paymentUrl)
    .sort((a, b) => horodatage(b.createdAt) - horodatage(a.createdAt));
  return candidats[0] || null;
}

/** Le dernier lien de chaque type, vivant ou non — pour l'affichage. */
export function derniersLiens(liens: LienPaiement[] | undefined): LienPaiement[] {
  const parType = new Map<string, LienPaiement>();
  for (const l of [...(liens || [])].sort((a, b) => horodatage(b.createdAt) - horodatage(a.createdAt))) {
    if (!parType.has(l.type)) parType.set(l.type, l);
  }
  return [...parType.values()];
}

/* ----------------------------------------------------- réponse du site */

export interface ReponseLien {
  reference: string;
  devis: string;
  type: TypeLien;
  montant: number;
  devise: string;
  paymentUrl: string;
  orderId: string;
  linkId: string;
  isTest: boolean;
  expiresAt: string;
}

/* La réponse 201 du contrat, relue avec méfiance : un `paymentUrl` absent ou
   non-HTTPS ne devient jamais un bouton « copier ». */
export function lireReponseSite(corps: unknown): ReponseLien | null {
  if (!corps || typeof corps !== 'object') return null;
  const c = corps as Record<string, unknown>;
  if (c.ok !== true) return null;
  const url = String(c.paymentUrl || '');
  if (!/^https:\/\//i.test(url)) return null;
  const type = String(c.type || '');
  if (!estTypeLien(type)) return null;
  const montant = Number(c.montant);
  if (!(montant > 0)) return null;
  return {
    reference: String(c.reference || ''),
    devis: String(c.devis || ''),
    type,
    montant: arrondi2(montant),
    devise: String(c.devise || 'EUR'),
    paymentUrl: url,
    orderId: String(c.orderId || ''),
    linkId: String(c.linkId || ''),
    isTest: c.isTest === true,
    expiresAt: String(c.expiresAt || ''),
  };
}

/* L'échec, en français et sans jargon : ce que Veys peut faire, pas le code
   HTTP. Le champ nommé par un 400 est repris quand le site le donne. */
export function messageErreurSite(status: number, corps: unknown): string {
  const c = (corps && typeof corps === 'object' ? corps : {}) as Record<string, unknown>;
  const detail = ['champ', 'field', 'erreur', 'error', 'message', 'detail']
    .map((k) => c[k])
    .find((v) => typeof v === 'string' && v.trim());
  switch (status) {
    case 401:
      return 'Le site clinicnobel.com a refusé la clé d’authentification : le secret INTERNAL_PAYMENT_LINK_SECRET n’est pas le même des deux côtés. Rien n’a été créé.';
    case 400:
      return `Le site a refusé la demande${detail ? ` (${detail})` : ''}. Rien n’a été créé.`;
    case 404:
      return 'L’endpoint du site est introuvable : le lot « lien de paiement » n’est pas encore déployé sur clinicnobel.com.';
    case 502:
      return 'Paysera n’a pas accepté la création du lien. Réessayez dans quelques minutes ; si cela persiste, la configuration Paysera du site est à vérifier.';
    case 503:
      return 'Le site clinicnobel.com n’est pas configuré pour Paysera (secret ou identifiants absents côté site).';
    default:
      return `Le site clinicnobel.com a répondu « ${status} »${detail ? ` : ${detail}` : ''}. Rien n’a été créé.`;
  }
}

/** L'objet facultatif du contrat — ce que la patiente lit sur la page Paysera. */
export const objetLien = (type: TypeLien, numero: string) =>
  `${type === 'acompte' ? 'Acompte' : 'Règlement'} devis ${numero} — Clinic Nobel`;

export const libelleType = (type: string) => (type === 'acompte' ? 'acompte' : 'solde');
