/* Remontée du devis vers la fiche patiente du CRM.

   Le devis PROPOSE, le CRM GARDE ce qu'un humain y a mis. Une seule règle
   commande tout : on n'écrit que dans un champ VIDE. Si l'assistante a corrigé
   une date après un appel, le devis ne l'écrase pas — il signale la divergence
   et n'écrit rien.

   ⚠ Les colonnes de `patients` sont `text NOT NULL DEFAULT ''` : « vide »
   signifie chaîne vide, jamais NULL. Un test `is null` ne trouverait rien. */

import type { DocRecord, Patient } from './types';

/** Les QUATRE colonnes de `patients` que ce lot peut écrire. Aucune autre. */
export const CHAMPS_REMONTES = [
  { devis: 'dateIntervention', fiche: 'dateOperation', libelle: "date d'opération" },
  { devis: 'date', fiche: 'dateDevis', libelle: 'date du devis' },
  { devis: 'chirurgien', fiche: 'medecin', libelle: 'chirurgien' },
  { devis: 'hopital', fiche: 'hopital', libelle: 'hôpital' },
] as const;

/** Garde-fou : toute écriture est confrontée à cette liste avant de partir. */
export const COLONNES_AUTORISEES: ReadonlySet<string> = new Set<string>(CHAMPS_REMONTES.map((c) => c.fiche));

/* `patients."procedure"` et `patients.stade` sont VOLONTAIREMENT absents :
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

/** Ce que le devis écrirait, ce qu'il laisse tel quel, ce qu'il signale. */
export function planifierRemontee(devis: DocRecord, fiche: Patient): PlanRemontee {
  const aEcrire: Record<string, string> = {};
  const divergences: Divergence[] = [];
  const dejaConformes: string[] = [];

  for (const champ of CHAMPS_REMONTES) {
    const valeurDevis = String((devis as Record<string, unknown>)[champ.devis] ?? '').trim();
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
