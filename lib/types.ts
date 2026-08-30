/* Formes applicatives — volontairement identiques à celles de index.html, pour que
   le rendu du document (et donc le PDF) n'ait à subir aucune adaptation.
   La traduction depuis / vers les colonnes Postgres vit dans lib/mappers.ts. */

import type { AppUser } from './perms';
import type { Settings } from './defaults';

export interface Patient {
  id: string;
  prenom: string;
  nom: string;
  email: string;
  telephone: string;
  pays: string;
  ville: string;
  commentaires: string;
  procedure?: string;
  stade?: string;
  createdBy: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Acte {
  id: string;
  acte: string;
  inclus: string;
}

export interface DocOption {
  /** Identifiant de ligne. Absent sur les options d'avant ce lot : l'index sert alors de clé. */
  id?: string;
  nom: string;
  /** Détail de l'option, séparé du libellé — même structure qu'un acte. */
  detail?: string;
  qty?: number;
  prix: number;
  /* ATTENTION — la valeur ABSENTE vaut `true`, jamais `false`.
     Toutes les options déjà en base sont dépourvues de ce champ et comptent
     dans le total du devis que la patiente détient. Les lire comme « non
     retenues » changerait rétroactivement des montants déjà acceptés.
     Seules les options créées après ce lot naissent à `false`.
     La lecture passe TOUJOURS par estRetenue() de lib/calc.ts. */
  retenue?: boolean;
}

/** Devis ET facture partagent la même forme : le PDF est rendu par un seul composant. */
export interface DocRecord {
  /** Ligne Postgres d'origine : sert à ne réécrire que ce qui a réellement changé. */
  _row?: Record<string, unknown>;
  id?: string;
  numero?: string;
  patientId?: string;
  date?: string;
  validite?: string;
  dateIntervention?: string;
  chirurgien?: string;
  hopital?: string;
  statut?: string;
  devise?: string;
  acompte?: number;
  forfait?: number;
  remiseType?: string;
  remiseValeur?: number | string;
  remiseMotif?: string;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;

  /* --- contenu (jsonb) --- */
  actes?: Acte[];
  inc?: string[];
  exc?: string[];
  options?: DocOption[];
  importantList?: string[];
  paiementNote?: string;
  cgv?: string;
  legal?: string;
  important?: string;
  bqNom?: string;
  bqIban?: string;
  bqBic?: string;
  bqAdresse?: string;
  promoJours?: number;
  modeleId?: string;
  pagesMode?: string;
  lignes?: { desc?: string; qty?: number; pu?: number }[];

  /* --- factures uniquement --- */
  numeroDevis?: string;
  devisId?: string;
  typeFacture?: string;
  noteInterne?: string;
  factNotes?: string;
}

export interface Paiement {
  /** Ligne Postgres d'origine : sert à ne réécrire que ce qui a réellement changé. */
  _row?: Record<string, unknown>;
  id?: string;
  refId: string | null;
  refNum: string;
  patientId: string | null;
  montant: number;
  date: string;
  mode: string;
  type: string;
  devise: string;
  note: string;
  createdAt?: string;
  updatedAt?: string;
}

/** Modèle de devis = ligne du catalogue CRM (lecture seule). */
export interface Modele {
  id: string;
  nom: string;
  categorie: string;
  sousCategorie: string;
  nature: string;
  prixBase: number;
  prixStandard: number | null;
  surDevis: boolean;
  /** Description patient, issue de nw_catalogue_descriptions. Vide si absente. */
  description: string;
  /** Commentaire interne du CRM. Ne doit jamais figurer sur un document patient. */
  notesInternes: string;
  /** Autres appellations de la prestation, côté CRM. Sert uniquement à la recherche. */
  synonymes: string[];
  inc: string[];
  exc: string[];
  dureeJours: number | null;
  dureeNuits: number | null;
  actif: boolean;
  ordre: number | null;
}

export interface OptionCat {
  id: string;
  nom: string;
  prix: number;
  actif: boolean;
}

export interface HistoEntry {
  id: string;
  date: string;
  user: string;
  message: string;
}

export interface AppData {
  parametres: Settings;
  patients: Patient[];
  devis: DocRecord[];
  factures: DocRecord[];
  paiements: Paiement[];
  modeles: Modele[];
  options: OptionCat[];
  historique: HistoEntry[];
  utilisateurs: AppUser[];
  /** Correspondances anciens libellés ↔ catalogue (lecture seule, sert aux alertes). */
  correspondances: { libelle: string; catalogueId: string | null; statut: string }[];
  /* ---- lot 73 (caisse) ---- */
  /** Les mouvements de `finances` — le registre partagé avec le CRM. */
  finances: Mouvement[];
  /** Les arrêtés de caisse (comptages physiques). Vide tant que la table est absente : module dégradé, app vivante. */
  arretes: Arrete[];
  /** vue_caisse_solde — le solde qui fait foi. Vide si la vue est absente : repli sur le calcul local, dit à l'écran. */
  soldesCaisse: SoldeVue[];
  /** Chirurgiens du CRM (lecture seule) : « à qui » du geste « J'ai payé ». Vide si illisible — saisie libre. */
  medecins: Medecin[];
}

/* ---- lot 73 : la caisse de la coordinatrice (30/08/2026) ---- */

/** Une ligne de `finances` — la table du CRM, TOUT EN TEXTE, y compris `montant` :
    la conversion vit dans lib/caisse.ts (montantNumerique), jamais dans le type.
    `sens`/`lieu` vides = ligne écrite par un autre chemin (le monolithe) — « à
    classer », signalée, jamais comptée. */
export interface Mouvement {
  _row?: Record<string, unknown>;
  id?: string;
  patientId: string;
  type: string;
  procedure: string;
  /** TEXTE, comme la colonne. Un montant illisible se signale, ne se somme jamais. */
  montant: string;
  date: string;
  statut: string;
  methode: string;
  creePar: string;
  devise: string;
  notes: string;
  /** entree · sortie · change · remise — ou '' (à classer). */
  sens: string;
  /** caisse · compte — ou '' . */
  lieu: string;
  /** Rempli UNIQUEMENT pour un change : ce qui entre, dans sa devise. */
  montantContrepartie: string;
  deviseContrepartie: string;
  createdAt?: string;
  updatedAt?: string;
}

/** Un arrêté de caisse : le COMPTAGE PHYSIQUE, jamais le solde. Immuable —
    ni update ni delete ; l'écart compté−calculé est le seul chiffre d'alerte. */
export interface Arrete {
  id?: string;
  date: string;
  devise: string;
  montantCompte: number;
  montantCalcule: number;
  ecart: number;
  par: string;
  notes: string;
  createdAt?: string;
}

/** Une ligne de vue_caisse_solde — le solde qui fait foi, calculé en base. */
export interface SoldeVue { devise: string; solde: number; depuisArrete: string; lignesIllisibles: number }

/** Chirurgien du CRM = ligne de la table `medecins` (lecture seule). */
export interface Medecin {
  id: string;
  nomAffiche: string;
}

export type Collection = 'patients' | 'devis' | 'factures' | 'paiements' | 'options' | 'historique'
  | 'finances' | 'arretes';
