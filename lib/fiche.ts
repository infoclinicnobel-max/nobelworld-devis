/* Remontée du devis vers la fiche patiente du CRM.

   Le devis PROPOSE, le CRM GARDE ce qu'un humain y a mis. Une seule règle
   commande tout : on n'écrit que dans un champ VIDE. Si l'assistante a corrigé
   une date après un appel, le devis ne l'écrase pas — il signale la divergence
   et n'écrit rien.

   ⚠ Les colonnes de `patients` sont `text NOT NULL DEFAULT ''` : « vide »
   signifie chaîne vide, jamais NULL. Un test `is null` ne trouverait rien. */

import type { DocRecord, Patient } from './types';

/** Les QUATRE colonnes de `patients` que ce lot peut écrire. Aucune autre.

    `hopital` en a été RETIRÉ : ce n'est pas une saisie du document mais
    l'adresse des Paramètres recopiée à sa création, et le CRM écrit
    « Avrasya Hospital » là où le document écrit « Avrasya Hastanesi —
    Istanbul, Türkiye ». Sept alertes sans désaccord réel useraient l'alerte
    avant qu'elle ne serve. */
export const CHAMPS_REMONTES = [
  { devis: 'dateIntervention', fiche: 'dateOperation', libelle: "date d'opération" },
  { devis: 'date', fiche: 'dateDevis', libelle: 'date du devis' },
  { devis: 'chirurgien', fiche: 'medecin', libelle: 'chirurgien' },
  { devis: 'forfait', fiche: 'budget', libelle: 'budget' },
] as const;

/* `patients.budget` est du texte, en chiffres bruts : « 8500 », sans espace ni
   symbole — les 52 valeurs déjà en base vérifient toutes ^[0-9]+$. C'est le
   FORFAIT du document, jamais un total recalculé : sur D-2026-000029, forfait
   4 900 € + options 3 670 € = 8 570 €, et aucun total n'est stocké. */
const enChiffresBruts = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? String(n) : '';
};

/** Valeur du document, mise au format de la colonne CRM visée. */
function valeurPourFiche(champ: { devis: string; fiche: string }, doc: Record<string, unknown>): string {
  if (champ.fiche === 'budget') return enChiffresBruts(doc[champ.devis]);
  return String(doc[champ.devis] ?? '').trim();
}

/** Garde-fou : toute écriture est confrontée à cette liste avant de partir. */
export const COLONNES_AUTORISEES: ReadonlySet<string> = new Set<string>(CHAMPS_REMONTES.map((c) => c.fiche));

/* `patients."procedure"`, `patients.procedures` et `patients.stade` sont
   VOLONTAIREMENT absents. « Reçu » et « Solde » aussi : ils ne se stockent pas,
   ils se calculent depuis nw_paiements (somme des montants par patiente, puis
   budget − reçu). Les écrire figerait un solde que le prochain paiement
   démentirait.
   - `procedure` emploie un vocabulaire distinct de celui du catalogue
     (« BBL / Lipofilling fessier » contre « Lipofilling Fessiers (BBL) ») ;
     y déverser les libellés du catalogue scinderait la colonne en deux
     vocabulaires pour une même intervention. Décision client en attente.
   - `stade` relève du processus commercial, pas de la recopie de donnée. */

export interface Divergence {
  libelle: string;
  colonne: string;
  valeurCrm: string;
  valeurDevis: string;
}

export interface PlanRemontee {
  aEcrire: Record<string, string>;
  divergences: Divergence[];
  /** Champs déjà renseignés à l'identique : ni écriture, ni alerte. */
  dejaConformes: string[];
}

const vide = (v: unknown) => String(v ?? '').trim() === '';

/* Normalisation employée UNIQUEMENT pour comparer, jamais pour écrire.
   Sans elle, « Dr Anvar Ahmedov » côté CRM et « Anvar Ahmedov » côté devis
   passeraient pour un désaccord : l'alerte se déclencherait sur la moitié du
   fichier alors qu'il s'agit du même chirurgien, et plus personne ne la
   lirait. Une alerte qui crie tout le temps ne protège plus rien. */
export function normaliser(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // accents
    .toLowerCase()
    .replace(/^(dr|docteur|pr|professeur)\.?\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')           // ponctuation, tirets longs, séparateurs
    .trim();
}

/* Ce que le document écrirait, ce qu'il laisse tel quel, ce qu'il signale.
   UNE seule implémentation pour les devis ET les factures : les deux partagent
   la forme DocRecord, et deux copies divergeraient au premier changement. */
export function planifierRemontee(devis: DocRecord, fiche: Patient): PlanRemontee {
  const aEcrire: Record<string, string> = {};
  const divergences: Divergence[] = [];
  const dejaConformes: string[] = [];

  for (const champ of CHAMPS_REMONTES) {
    const valeurDevis = valeurPourFiche(champ, devis as unknown as Record<string, unknown>);
    const valeurCrm = String((fiche as unknown as Record<string, unknown>)[champ.fiche] ?? '');
    if (!valeurDevis) continue;                     // le devis n'a rien à proposer
    if (vide(valeurCrm)) { aEcrire[champ.fiche] = valeurDevis; continue; }
    if (normaliser(valeurCrm) === normaliser(valeurDevis)) { dejaConformes.push(champ.libelle); continue; }
    divergences.push({
      libelle: champ.libelle, colonne: champ.fiche, valeurCrm, valeurDevis,
    });
  }
  return { aEcrire, divergences, dejaConformes };
}

/* ---------------------------------------------------------------- moment

   À quel statut la remontée part-elle ? La règle « n'écrire que si vide » fait
   que la PREMIÈRE écriture est définitive : elle doit donc avoir lieu au moment
   où la donnée est la plus sûre. Une date posée depuis un brouillon occuperait
   le champ, puis empêcherait la vraie date d'y entrer — elle produirait une
   divergence au lieu d'une correction, soit l'inverse du but recherché.

   Basculer sur un autre statut ne demande que de modifier cette constante. */
export const STATUTS_QUI_REMONTENT = ['accepte'];

export const remonteeAutomatique = (statut: unknown) =>
  STATUTS_QUI_REMONTENT.includes(String(statut || ''));

/* ------------------------------------------- hiérarchie des documents

   Règle métier, dite par le client : « Dans tous les cas, on réalise un devis.
   Après le devis, on peut faire une remise […] et après modifier le devis et la
   facture ; c'est la facture finale. Concernant notre CRM, si on note des
   montants, c'est qu'ils doivent payer ce montant. »

   Donc : LA FACTURE VIVANTE L'EMPORTE, quelle que soit la date d'enregistrement.
   Un devis rouvert après coup ne reprend jamais la main sur la facture qui en
   est née — sans quoi le prix d'AVANT la remise réécrase le prix final
   (Gaëlle Alma : devis 7 900 €, facture 6 400 €, CRM 6 400 €).

   Le devis n'est source que s'il n'existe aucune facture vivante. */

/** Statuts qui font d'un document une source légitime pour le CRM. */
export const STATUTS_FACTURE_VIVANTE = ['envoye', 'accepte', 'payee', 'partielle'];

export const factureEstVivante = (statut: unknown) =>
  STATUTS_FACTURE_VIVANTE.includes(String(statut || ''));

export interface DocumentSource { type: 'devis' | 'facture'; doc: DocRecord }

/* Choisit le document qui parle au CRM pour une patiente donnée.
   Employé par le flux ET par le rattrapage : une seule règle, pas deux. */
export function documentQuiFaitFoi(
  devis: DocRecord[], factures: DocRecord[],
): DocumentSource | null {
  const recent = (a: DocRecord, b: DocRecord) =>
    String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));

  const facturesVivantes = factures.filter((f) => factureEstVivante(f.statut)).sort(recent);
  if (facturesVivantes.length) return { type: 'facture', doc: facturesVivantes[0] };

  /* Aucune facture vivante — cas d'Ashley Munao, dont l'unique facture est
     annulée et qui n'a rien versé. On retombe sur le devis accepté : c'est
     le seul engagement qui subsiste. Un brouillon ne fait jamais foi, ni en
     devis ni en facture : il n'engage personne, et la première écriture
     dans un champ vide étant définitive, elle doit venir d'un document sûr. */
  const devisAcceptes = devis.filter((d) => remonteeAutomatique(d.statut)).sort(recent);
  return devisAcceptes.length ? { type: 'devis', doc: devisAcceptes[0] } : null;
}
