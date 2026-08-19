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
import {
  aPaye, COLONNES_AUTORISEES, factureEstVivante, niveauEngagement, planifierRemontee,
  type Engagement,
  type Divergence,
} from './fiche';
import {
  planifierRendezVous, TYPE_OPERATION, type LigneAgenda, type PlanAgenda,
} from './agenda';
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
  /** Pourquoi rien n'a été écrit, quand c'est le cas. Sert aux messages. */
  raison?: string;
  /** Ce qui a été volontairement laissé, avec la raison — à DIRE, pas à taire. */
  laisses: { libelle: string; pourquoi: string }[];
  /** Nom de la patiente, quand la fiche a été retrouvée. */
  patient?: string;
  ecrits: Record<string, string>;
  divergences: Divergence[];
  dejaConformes: string[];
  /* Ce que le calendrier a reçu, ou l'écart qui l'en a empêché — à DIRE. Sans
     ce retour, une ligne part au calendrier sans que personne le sache, ou
     n'y part pas sans que personne l'apprenne. */
  agenda?: PlanAgenda;
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
/* ----------------------------------------------- l'agenda, en INSERT seul

   SEULE écriture de Nobel World hors `nw_*` et `patients`, et elle ne passe
   PAS par `enregistrer()`. C'est délibéré : `TABLES_ECRITURE` commande aussi
   `supprimer()`, qui n'a de garde particulière que pour `patients`. Y inscrire
   « rdvs » aurait donc ouvert INSERT, UPDATE **et** DELETE sur l'agenda du CRM
   par un chemin générique appelable de partout. `rdvs` reste hors de la liste,
   et n'existe ni dans le type `Collection` ni dans `TABLE_OF` : aucun appelant
   ne peut la nommer.

   Un seul verbe : `.insert()`. Jamais `.upsert()`, jamais `.update()`, jamais
   `.delete()`. Et `type` est REPOSÉ ici depuis la constante — la fonction est
   incapable d'écrire autre chose qu'une opération, même appelée de travers.

   `scripts/garde-agenda.ts` échoue si un second appelant apparaît. */
async function insererRendezVousOperation(ligne: LigneAgenda): Promise<void> {
  const { error } = await supabase()
    .from('rdvs')
    .insert({ ...ligne, type: TYPE_OPERATION });
  if (error) throw new Error("Rendez-vous non posé au calendrier : " + error.message);
}

export async function remonterVersFiche(
  devis: DocRecord,
  source: 'devis' | 'facture' = 'devis',
  forcer = false,
): Promise<ResultatRemontee> {
  const vide: ResultatRemontee = {
    statut: 'sans-fiche', ecrits: {}, divergences: [], dejaConformes: [], laisses: [],
  };
  const id = String(devis.patientId || '').trim();
  if (!id) return vide;

  const sb = supabase();
  /* `hopital` n'est PAS une colonne remontée — on ne l'écrit jamais — mais le
     calendrier la recopie, donc il faut la lire. */
  const colonnes = ['id', 'prenom', 'nom', 'hopital', ...COLONNES_AUTORISEES].join(',');
  const [ficheR, devisR, facturesR, paiementsR] = await Promise.all([
    sb.from('patients').select(colonnes).eq('id', id).maybeSingle(),
    sb.from('nw_devis').select('*').eq('patient_id', id),
    sb.from('nw_factures').select('*').eq('patient_id', id),
    sb.from('nw_paiements').select('*'),
  ]);
  if (ficheR.error) throw new Error('Fiche patiente illisible : ' + ficheR.error.message);
  if (!ficheR.data) return { ...vide, statut: 'fiche-introuvable' };

  const devisDeLaPatiente = (devisR.data || []).map(rowToDevis);
  const facturesDeLaPatiente = (facturesR.data || []).map(rowToFacture);

  /* Hiérarchie : la facture vivante l'emporte, quelle que soit la date. Un devis
     rouvert après la facture qui en est née ne reprend jamais la main — sinon le
     prix d'AVANT la remise réécrase le prix final. */
  if (source === 'devis' && facturesDeLaPatiente.some((f) => factureEstVivante(f.statut))) {
    return {
      statut: 'rien-a-ecrire', ecrits: {}, divergences: [], dejaConformes: [], laisses: [],
      raison: 'une facture vivante existe : c\'est elle qui parle au CRM',
    };
  }

  /* ---- Le déclenchement, en OU, et il vit ICI et nulle part ailleurs ----

     Deux signaux, l'un ou l'autre suffit :
       · un devis de la patiente est « accepté » ;
       · un paiement existe.

     Mesuré par le client : quatre factures sont en « brouillon » avec un
     paiement encaissé dessus, et deux patientes ont payé sans devis accepté.
     Le statut d'un document ne suit pas la réalité ; le OU couvre les deux
     trous. La décision est descendue de l'écran vers cette couche parce que le
     second terme demande une lecture — et parce qu'une règle partagée par le
     flux devis, le flux facture et le rattrapage ne doit exister qu'une fois. */
  const paye = aPaye(
    (paiementsR.data || []).map(rowToPaiement),
    id,
    facturesDeLaPatiente.map((f) => String(f.id || '')),
  );
  /* Trois niveaux : un devis ENVOYÉ écrit le stade et rien d'autre ; un devis
     accepté ou un paiement écrit les six colonnes ; sinon rien. */
  const engagement = niveauEngagement(devisDeLaPatiente, paye);
  if (engagement === 'aucun' && !forcer) {
    return {
      statut: 'rien-a-ecrire', ecrits: {}, divergences: [], dejaConformes: [], laisses: [],
      raison: 'aucun devis envoyé ou accepté, et aucun paiement : le document n\'engage encore personne',
    };
  }

  const f = ficheR.data as unknown as Record<string, unknown>;
  const patient = `${f.prenom || ''} ${f.nom || ''}`.trim();
  /* Les factures partent avec le plan : la clause d'annulation en a besoin
     pour refuser « Confirmé » à une affaire morte (facture annulée sans
     remplaçante vivante). Voir annulationBloqueConfirmation, lib/fiche.ts. */
  const plan = planifierRemontee(devis, f as never, {
    engagement, forcerDonnees: forcer, factures: facturesDeLaPatiente,
  });
  const base = {
    patient, divergences: plan.divergences, dejaConformes: plan.dejaConformes, laisses: plan.laisses,
  };

  const colonnesEcrites = Object.keys(plan.aEcrire);

  if (colonnesEcrites.length) {
    /* Ceinture et bretelles : une colonne hors de la liste blanche ne part pas. */
    const interdite = colonnesEcrites.find((c) => !COLONNES_AUTORISEES.has(c));
    if (interdite) {
      throw new Error(`Écriture refusée : « ${interdite} » ne fait pas partie des colonnes remontées.`);
    }
    const { error: err2 } = await sb.from('patients').update(plan.aEcrire).eq('id', id);
    if (err2) throw new Error('Report vers la fiche impossible : ' + err2.message);
  }

  /* ---- Le calendrier, APRÈS l'écriture de la fiche et HORS du raccourci ----

     Ce pas ne peut pas vivre derrière un « rien à écrire », et c'est le piège
     central de ce lot : une fiche DÉJÀ complète produit un `aEcrire` vide. Or
     c'est exactement le cas qui a motivé la demande — Cindy Doli, fiche
     renseignée, opération absente du calendrier. Brancher l'agenda après le
     raccourci l'aurait rendu muet précisément là où on l'attendait.

     La date lue est celle de la fiche APRÈS l'écriture : celle qui vient d'être
     posée, le cas échéant. */
  const agenda = await poserAuCalendrier(sb, id, { ...f, ...plan.aEcrire }, engagement);

  const statut = colonnesEcrites.length ? 'ecrit' as const : 'rien-a-ecrire' as const;
  return { statut, ecrits: plan.aEcrire, agenda, ...base };
}

/* Le SEUL appelant de `insererRendezVousOperation`. La règle en trois cas vit
   dans `planifierRendezVous` (lib/agenda.ts), pure : le flux et tout rattrapage
   à venir partagent la même, il ne peut pas en exister deux. */
async function poserAuCalendrier(
  sb: ReturnType<typeof supabase>,
  patientId: string,
  fiche: Record<string, unknown>,
  engagement: Engagement,
): Promise<PlanAgenda> {
  const { data, error } = await sb
    .from('rdvs').select('id,type,date').eq('patientId', patientId);
  if (error) throw new Error('Agenda illisible : ' + error.message);

  const plan = planifierRendezVous(
    {
      id: patientId,
      dateOperation: String(fiche.dateOperation ?? ''),
      medecin: String(fiche.medecin ?? ''),
      hopital: String(fiche.hopital ?? ''),
      stade: String(fiche.stade ?? ''),
    },
    (data || []) as { id: string; type: string; date: string }[],
    { engagement, horodatage: Date.now(), suffixe: suffixeRdv() },
  );
  if (plan.cas === 'a-creer') await insererRendezVousOperation(plan.ligne);
  return plan;
}

/* Quatre caractères, comme les 48 lignes déjà en base. Hors de `lib/agenda.ts`
   pour que ce fichier reste pur et sa recette rejouable. */
const suffixeRdv = () => Math.random().toString(36).slice(2, 6).padEnd(4, '0');

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
