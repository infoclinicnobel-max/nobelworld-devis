'use client';

/* Couche d'accès aux données — Supabase uniquement.
   L'ancien mécanisme maison (safeMerge, instantané local, timeout 45 s, sondage
   toutes les 15 s) a disparu : Postgres est la seule source de vérité.

   ⚠ Règle non négociable : Nobel World n'écrit que dans nw_* et patients.
   Aucune écriture n'est possible ailleurs — les fonctions ci-dessous ne
   connaissent aucune autre table en écriture. */

import { supabase } from './supabase/client';
import {
  devisToRow, factureToRow, histoToRow, optionToRow, paiementToRow, patientToRow,
  rowToDevis, rowToFacture, rowToHisto, rowToModele, rowToOption, rowToPaiement,
  rowToPatient, rowToUser, settingsToValeur, valeurToSettings,
} from './mappers';
import type { AppData, Collection, DocRecord, OptionCat, Paiement, Patient } from './types';
import type { Settings } from './defaults';
import type { AppUser } from './perms';
import { COLONNES_AUTORISEES, planifierRemontee, type Divergence } from './fiche';
import { ROLES_SANS_ACCES } from './perms';

/** Tables du CRM ouvertes en écriture à Nobel World. Toute autre table est interdite. */
const TABLES_ECRITURE = new Set(['nw_devis', 'nw_factures', 'nw_paiements', 'nw_historique',
  'nw_options', 'nw_parametres', 'patients']);

function assertEcritureAutorisee(table: string) {
  if (!TABLES_ECRITURE.has(table)) {
    throw new Error(`Écriture interdite sur « ${table} » : Nobel World n'écrit que dans nw_* et patients.`);
  }
}

export class AccesRefuseError extends Error {}

/* ------------------------------------------------------------------ profil */

export async function chargerProfil(authUserId: string): Promise<AppUser> {
  const { data, error } = await supabase()
    .from('profiles')
    .select('*')
    .eq('auth_user_id', authUserId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    throw new AccesRefuseError(
      "Aucun profil n'est associé à ce compte dans Clinic Nobel. Demandez à l'administrateur de créer votre fiche.",
    );
  }
  const u = rowToUser(data);
  if (ROLES_SANS_ACCES.includes(u.roleBase.toLowerCase())) {
    throw new AccesRefuseError(
      `Le rôle « ${u.roleBase} » n'a pas accès à Nobel World. Les règles d'accès de la base réservent l'application aux autres rôles.`,
    );
  }
  if (String(u.statut).toLowerCase() === 'inactif') {
    throw new AccesRefuseError("Compte désactivé. Contactez l'administrateur.");
  }
  return u;
}

/* ------------------------------------------------------------- chargement */

export async function chargerTout(): Promise<AppData> {
  const sb = supabase();
  const [
    param, patients, devis, factures, paiements, options, historique, profiles, catalogue, corresp,
    descriptions,
  ] = await Promise.all([
    sb.from('nw_parametres').select('cle,valeur'),
    sb.from('patients').select('*').order('nom', { ascending: true }),
    sb.from('nw_devis').select('*').order('created_at', { ascending: false }),
    sb.from('nw_factures').select('*').order('created_at', { ascending: false }),
    sb.from('nw_paiements').select('*').order('date', { ascending: false }),
    sb.from('nw_options').select('*').order('nom', { ascending: true }),
    sb.from('nw_historique').select('*').order('date', { ascending: false }).limit(500),
    sb.from('profiles').select('*'),
    sb.from('catalogue_interventions').select('*').order('ordre', { ascending: true, nullsFirst: false }),
    sb.from('catalogue_correspondances').select('libelle_libre,catalogue_id,statut'),
    sb.from('nw_catalogue_descriptions').select('catalogue_id,description'),
  ]);

  const premiereErreur = [param, patients, devis, factures, paiements, options, historique, profiles,
    catalogue, corresp].find((r) => r.error);
  if (premiereErreur?.error) throw new Error(premiereErreur.error.message);

  /* Descriptions patient des prestations du catalogue. Volontairement tolérant :
     si la table est absente ou vide, les modèles gardent une description vide —
     une case « INCLUS / DÉTAIL » vide, jamais une erreur ni un « undefined ». */
  const parCatalogue = new Map<string, string>();
  if (descriptions.error) {
    console.warn('[CN][catalogue] descriptions indisponibles :', descriptions.error.message);
  } else {
    for (const d of descriptions.data || []) {
      const texte = typeof d.description === 'string' ? d.description : '';
      if (texte.trim()) parCatalogue.set(String(d.catalogue_id), texte);
    }
  }

  const societe = (param.data || []).find((r: any) => r.cle === 'societe');

  return {
    parametres: valeurToSettings(societe?.valeur),
    patients: (patients.data || []).map(rowToPatient),
    devis: (devis.data || []).map(rowToDevis),
    factures: (factures.data || []).map(rowToFacture),
    paiements: (paiements.data || []).map(rowToPaiement),
    options: (options.data || []).map(rowToOption),
    historique: (historique.data || []).map(rowToHisto),
    utilisateurs: (profiles.data || []).map(rowToUser),
    modeles: (catalogue.data || [])
      .map(rowToModele)
      .filter((m) => m.actif)
      .map((m) => ({ ...m, description: parCatalogue.get(m.id) || '' })),
    correspondances: (corresp.data || []).map((c: any) => ({
      libelle: String(c.libelle_libre || ''),
      catalogueId: c.catalogue_id ? String(c.catalogue_id) : null,
      statut: String(c.statut || ''),
    })),
  };
}

/* ------------------------------------------------------------ numérotation */

/* Jamais côté navigateur : deux commerciales qui créent un devis en même temps
   produiraient le même numéro. La fonction Postgres incrémente et renvoie
   atomiquement le compteur porté par nw_parametres. */
export async function prochainNumero(type: 'devis' | 'facture'): Promise<string> {
  const { data, error } = await supabase().rpc('nw_prochain_numero', { type });
  if (error) throw new Error('Numérotation impossible : ' + error.message);
  if (!data) throw new Error('Numérotation impossible : réponse vide du serveur.');
  return String(data);
}

/* ----------------------------------------------------------- enregistrement */

const TABLE_OF: Record<Collection, string> = {
  patients: 'patients',
  devis: 'nw_devis',
  factures: 'nw_factures',
  paiements: 'nw_paiements',
  options: 'nw_options',
  historique: 'nw_historique',
};

const nouvelId = (p: string) =>
  p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export async function enregistrer(
  collection: Collection,
  record: any,
  auteur: string,
): Promise<any> {
  const table = TABLE_OF[collection];
  assertEcritureAutorisee(table);
  const sb = supabase();

  let row: Record<string, any>;
  switch (collection) {
    case 'patients':
      row = patientToRow(record as Patient, auteur);
      break;
    case 'devis':
      row = devisToRow(record as DocRecord, auteur);
      if (!row.id) row.id = nouvelId('dev');
      break;
    case 'factures':
      row = factureToRow(record as DocRecord, auteur);
      if (!row.id) row.id = nouvelId('fac');
      break;
    case 'paiements':
      row = paiementToRow(record as Paiement);
      if (!row.id) row.id = nouvelId('pai');
      break;
    case 'options':
      row = optionToRow(record as OptionCat);
      break;
    case 'historique':
      row = histoToRow(record);
      break;
  }

  const { data, error } = await sb.from(table).upsert(row!, { onConflict: 'id' }).select().single();
  if (error) throw new Error(error.message);

  switch (collection) {
    case 'patients': return rowToPatient(data);
    case 'devis': return rowToDevis(data);
    case 'factures': return rowToFacture(data);
    case 'paiements': return rowToPaiement(data);
    case 'options': return rowToOption(data);
    case 'historique': return rowToHisto(data);
  }
}

export async function supprimer(collection: Collection, id: string): Promise<void> {
  const table = TABLE_OF[collection];
  assertEcritureAutorisee(table);
  if (collection === 'patients') {
    /* Une fiche patient est partagée avec le CRM : on ne la supprime jamais. */
    throw new Error(
      "Suppression impossible : la fiche patient est partagée avec le CRM Clinic Nobel. Signalez le doublon à l'administrateur.",
    );
  }
  const { error } = await supabase().from(table).delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/* --------------------------------------------- remontée vers la fiche CRM */

export interface ResultatRemontee {
  statut: 'ecrit' | 'rien-a-ecrire' | 'fiche-introuvable' | 'sans-fiche';
  /** Nom de la patiente, quand la fiche a été retrouvée. */
  patient?: string;
  ecrits: Record<string, string>;
  divergences: Divergence[];
  dejaConformes: string[];
}

/* Reporte vers `patients` les quatre champs du devis, et EUX SEULS.

   Trois précautions, dans cet ordre :
   1. la fiche est relue en base juste avant de décider — comparer à un cache
      du navigateur reviendrait à écraser une correction faite entre-temps par
      l'assistante, ce que ce lot existe précisément pour empêcher ;
   2. UPDATE ciblé sur les quatre colonnes nommées, jamais un upsert de ligne
      entière : les 36 autres colonnes ne sont pas même mentionnées à Postgres ;
   3. UPDATE et jamais INSERT — un devis ne crée jamais une fiche patiente.
      Un `patient_id` introuvable n'écrit rien et se signale. */
export async function remonterVersFiche(devis: DocRecord): Promise<ResultatRemontee> {
  const vide: ResultatRemontee = { statut: 'sans-fiche', ecrits: {}, divergences: [], dejaConformes: [] };
  const id = String(devis.patientId || '').trim();
  if (!id) return vide;

  const sb = supabase();
  const colonnes = ['id', 'prenom', 'nom', ...COLONNES_AUTORISEES].join(',');
  const { data: fiche, error } = await sb.from('patients').select(colonnes).eq('id', id).maybeSingle();
  if (error) throw new Error('Fiche patiente illisible : ' + error.message);
  if (!fiche) return { ...vide, statut: 'fiche-introuvable' };

  const f = fiche as unknown as Record<string, unknown>;
  const patient = `${f.prenom || ''} ${f.nom || ''}`.trim();
  const plan = planifierRemontee(devis, f as never);
  const base = { patient, divergences: plan.divergences, dejaConformes: plan.dejaConformes };

  const colonnesEcrites = Object.keys(plan.aEcrire);
  if (!colonnesEcrites.length) return { statut: 'rien-a-ecrire', ecrits: {}, ...base };

  /* Ceinture et bretelles : une colonne hors des quatre autorisées ne part pas. */
  const interdite = colonnesEcrites.find((c) => !COLONNES_AUTORISEES.has(c));
  if (interdite) {
    throw new Error(`Écriture refusée : « ${interdite} » ne fait pas partie des colonnes remontées.`);
  }

  const { error: err2 } = await sb.from('patients').update(plan.aEcrire).eq('id', id);
  if (err2) throw new Error('Report vers la fiche impossible : ' + err2.message);
  return { statut: 'ecrit', ecrits: plan.aEcrire, ...base };
}

/* ------------------------------------------------------------- paramètres */

export async function enregistrerParametres(s: Settings): Promise<Settings> {
  const sb = supabase();
  const { data: prev } = await sb.from('nw_parametres').select('valeur').eq('cle', 'societe').maybeSingle();
  const valeur = settingsToValeur(s, prev?.valeur);
  const { data, error } = await sb
    .from('nw_parametres')
    .upsert({ cle: 'societe', valeur, maj: new Date().toISOString() }, { onConflict: 'cle' })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return valeurToSettings(data.valeur);
}

/* ------------------------------------------------------------- historique */

export async function journaliser(utilisateur: string, message: string) {
  return enregistrer('historique', { date: new Date().toISOString(), user: utilisateur, message }, utilisateur);
}
