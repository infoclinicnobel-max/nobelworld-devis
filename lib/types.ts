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
  nom: string;
  qty?: number;
  prix: number;
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
}

export type Collection = 'patients' | 'devis' | 'factures' | 'paiements' | 'options' | 'historique';
