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
  aPaye, COLONNES_AUTORISEES, evaluerDocument, factureEstVivante, journaliserRefus,
  journaliserRemontee, niveauEngagement, planifierRemontee,
  type Engagement,
  type Divergence,
  type EntreeJournal,
  type Refus,
} from './fiche';
import { todayISO } from './format';
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
  /** Ce que le document propose et que la remontée refuse — évalué à chaque enregistrement, brouillon compris. */
  refus: Refus[];
  /** Les refus qui viennent d'entrer au journal de fiche (dédoublonnés) — vides pour un brouillon ou une répétition. */
  refusJournalises: EntreeJournal[];
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
  /* Signature portée au journal de fiche (« veys », comme les entrées que le
     CRM y écrit). Vide, le journal dira « nobel-world » : une trace anonyme
     vaut mieux qu'aucune, mais les appelants DOIVENT passer l'utilisateur. */
  auteur = '',
  /* Le même utilisateur au format de `nw_historique` (« Veys Turan ») : chaque
     journal garde son format natif (convention provisoire du 21 août). */
  auteurNw = '',
): Promise<ResultatRemontee> {
  const vide: ResultatRemontee = {
    statut: 'sans-fiche', ecrits: {}, divergences: [], dejaConformes: [], laisses: [],
    refus: [], refusJournalises: [],
  };
  const id = String(devis.patientId || '').trim();
  if (!id) return vide;

  const sb = supabase();
  /* `hopital` n'est PAS une colonne remontée — on ne l'écrit jamais — mais le
     calendrier la recopie, donc il faut la lire. `historique` est lu pour y
     APPOSER la trace de l'écriture, jamais pour le réécrire seul. */
  const colonnes = ['id', 'prenom', 'nom', 'hopital', 'historique', ...COLONNES_AUTORISEES].join(',');
  const [ficheR, devisR, facturesR, paiementsR, medecinsR] = await Promise.all([
    sb.from('patients').select(colonnes).eq('id', id).maybeSingle(),
    sb.from('nw_devis').select('*').eq('patient_id', id),
    sb.from('nw_factures').select('*').eq('patient_id', id),
    sb.from('nw_paiements').select('*'),
    /* Vocabulaire canonique des chirurgiens (règle du chapitre 1) : lecture
       seule, RLS `medecins_read` ouverte à tout rôle non anonyme. Pas de
       filtre sur `actif` : colonne texte à la convention posée « au jugé »
       le 19 août (v1.84) — s'y fier viderait le vocabulaire en silence si la
       convention changeait. En cas d'erreur de lecture, le vocabulaire est
       VIDE et non absent : tout medecin est alors refusé et dit (v1.83),
       jamais recopié brut. */
    sb.from('medecins').select('nomAffiche'),
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
      refus: [], refusJournalises: [],
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

  const f = ficheR.data as unknown as Record<string, unknown>;
  const patient = `${f.prenom || ''} ${f.nom || ''}`.trim();
  if (medecinsR.error) {
    console.warn('[CN][fiche] table medecins illisible — tout chirurgien sera refusé :', medecinsR.error.message);
  }
  const vocabulaireMedecins = (medecinsR.data || [])
    .map((m: { nomAffiche?: unknown }) => String(m.nomAffiche || '').trim())
    .filter(Boolean);

  /* ---- ÉVALUER avant de décider d'écrire, et quel que soit l'engagement ----

     Le refus d'un chirurgien inconnu ou d'une date passée vivait dans la
     boucle par colonne, sautée hors engagement : il ne pouvait se produire
     qu'à l'acceptation — au moment du dommage. Évalué ICI, à chaque
     enregistrement, il se journalise dès l'envoi, des semaines avant
     (D-2026-000023 est « envoyé » depuis le 3 juillet). Les colonnes, elles,
     ne s'écrivent que sous engagement, comme avant : seule la condition
     d'ÉVALUATION descend d'un cran, pas celle d'écriture. */
  const aujourdhui = todayISO();
  const refus = evaluerDocument(devis, vocabulaireMedecins, aujourdhui);
  const quand = new Date();
  const p2 = (n: number) => String(n).padStart(2, '0');
  const signature = {
    u: auteur || 'nobel-world',
    date: `${quand.getFullYear()}-${p2(quand.getMonth() + 1)}-${p2(quand.getDate())}`,
    heure: `${p2(quand.getHours())}:${p2(quand.getMinutes())}`,
    motif: `Remontée automatique ${source === 'facture' ? 'de la facture' : 'du devis'} ${devis.numero || ''}`.trim(),
  };
  /* Un brouillon n'engage personne et n'est pas parti : on évalue, on le DIT à
     l'écran, on ne journalise pas encore. Dès « envoyé », le document existe
     hors de la maison : le refus entre dans les deux journaux. */
  const journalRefus = engagement === 'aucun' && !forcer
    ? { journal: null, nouvelles: [] as EntreeJournal[] }
    : journaliserRefus(f.historique, refus, signature);

  if (engagement === 'aucun' && !forcer) {
    return {
      statut: 'rien-a-ecrire', ecrits: {}, divergences: [], dejaConformes: [], laisses: [],
      refus, refusJournalises: [],
      raison: 'aucun devis envoyé ou accepté, et aucun paiement : le document n\'engage encore personne',
    };
  }

  /* Les factures partent avec le plan : la clause d'annulation en a besoin
     pour refuser « Confirmé » à une affaire morte (facture annulée sans
     remplaçante vivante). Les médecins aussi : la règle du chapitre 1 écrit
     la forme canonique ou refuse, jamais la valeur brute du devis. */
  const plan = planifierRemontee(devis, f as never, {
    engagement, forcerDonnees: forcer, factures: facturesDeLaPatiente,
    medecins: vocabulaireMedecins, aujourdhui,
  });
  const base = {
    patient, divergences: plan.divergences, dejaConformes: plan.dejaConformes, laisses: plan.laisses,
    refus, refusJournalises: journalRefus.nouvelles,
  };

  const colonnesEcrites = Object.keys(plan.aEcrire);

  /* Ceinture et bretelles : une colonne hors de la liste blanche ne part pas. */
  const interdite = colonnesEcrites.find((c) => !COLONNES_AUTORISEES.has(c));
  if (interdite) {
    throw new Error(`Écriture refusée : « ${interdite} » ne fait pas partie des colonnes remontées.`);
  }
  /* La TRACE part dans le MÊME update que les données — jamais après coup :
     `patients` n'a aucun déclencheur, une écriture qui ne pose ni journal ni
     updated_at est strictement invisible. Mesuré le 19 août : la remontée en
     service avait rempli Cindy, Diallo et El Acmaoui en laissant leur
     historique entièrement vide, pendant que le CRM, lui, journalise les
     corrections humaines. Deux clés s'ajoutent donc ici, et deux seulement :
     `historique` (une entrée par colonne, auteur + horodatage + document
     source) et `updated_at` — la donnée, elle, reste bornée par la liste
     blanche contrôlée ci-dessus.

     Les REFUS entrent dans le même journal, en tête (journaliserRefus, plus
     haut), dédoublonnés : le journal ne ment plus par omission — sur Sofia il
     portait cinq succès et zéro mention du chirurgien refusé. Sans colonne à
     écrire ni refus nouveau, `patients` n'est pas touché. */
  let historique: string | null = journalRefus.journal;
  if (colonnesEcrites.length) {
    const journal = journaliserRemontee(historique ?? f.historique, plan.aEcrire, (c) => String(f[c] ?? ''), signature);
    if (journal !== null) historique = journal;
  }
  if (colonnesEcrites.length || historique !== null) {
    const payload: Record<string, string> = { ...plan.aEcrire, updated_at: quand.toISOString() };
    if (historique !== null) payload.historique = historique;
    const { error: err2 } = await sb.from('patients').update(payload).eq('id', id);
    if (err2) throw new Error('Report vers la fiche impossible : ' + err2.message);
  }
  /* Le second journal — celui que Nobel World affiche — reçoit le même refus,
     une fois lui aussi : il ne s'écrit que si la fiche vient d'en recevoir
     l'entrée. Un seul dédoublonnage, celui du journal de fiche, qui fait foi. */
  for (const n of journalRefus.nouvelles) {
    const r = refus.find((x) => x.champ === n.champ);
    await journaliser(
      auteurNw || auteur || 'nobel-world',
      `a enregistré ${source === 'facture' ? 'la facture' : 'le devis'} ${devis.numero || ''} — `
        + `${r?.libelle || n.champ} « ${r?.valeur || ''} » refusé par la remontée vers la fiche de ${patient} : `
        + `${r?.pourquoi || n.motif}`,
    );
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
    { engagement, horodatage: Date.now(), suffixe: suffixeRdv(), aujourdhui: todayISO() },
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
