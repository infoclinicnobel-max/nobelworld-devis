/* Remontée du devis vers la fiche patiente du CRM.

   Le devis PROPOSE, le CRM GARDE ce qu'un humain y a mis. Une seule règle
   commande tout : on n'écrit que dans un champ VIDE. Si l'assistante a corrigé
   une date après un appel, le devis ne l'écrase pas — il signale la divergence
   et n'écrit rien.

   ⚠ Les colonnes de `patients` sont `text NOT NULL DEFAULT ''` : « vide »
   signifie chaîne vide, jamais NULL. Un test `is null` ne trouverait rien. */

import type { DocRecord, Paiement, Patient } from './types';

/** Les QUATRE colonnes de `patients` que ce lot peut écrire. Aucune autre.

    `hopital` en a été RETIRÉ : ce n'est pas une saisie du document mais
    l'adresse des Paramètres recopiée à sa création, et le CRM écrit
    « Avrasya Hospital » là où le document écrit « Avrasya Hastanesi —
    Istanbul, Türkiye ». Sept alertes sans désaccord réel useraient l'alerte
    avant qu'elle ne serve. */
/* Le stade n'est pas recopié d'un document : il se déduit. La clé ci-dessous
   n'existe sur aucun document — elle marque, dans la table, une valeur calculée
   plutôt que lue. */
export const CLE_STADE = '__stade';

/** Vocabulaire EXISTANT du CRM. À ne pas élargir. */
export const STADE_CONFIRME = 'Confirmé';
export const STADE_DEVIS_ENVOYE = 'Devis envoyé';
/* « Nouveau », « Post-opératoire » et « Clôturé ✓ » ne sont jamais PRODUITS par
   l'automatisme : ils restent à la main. Mais ils sont RECONNUS, parce qu'il
   faut savoir qu'une fiche est déjà plus avancée que ce qu'on propose. */

/* ---- `stade` est la SEULE colonne à règle ordonnée ----

   Les cinq autres colonnes gardent la règle stricte : on n'écrit que si le
   champ est vide. Pour `stade`, cette règle produirait l'inverse du but : une
   fiche passée à « Devis envoyé » à l'envoi du devis ne pourrait plus jamais
   avancer à « Confirmé » à son acceptation, la case n'étant plus vide. Toutes
   les fiches se figeraient au premier étage.

   On écrit donc si et seulement si le rang proposé est STRICTEMENT SUPÉRIEUR
   au rang actuel. Un stade ne peut que monter, jamais reculer. */
export const ECHELLE_STADE = [
  'Nouveau',            // 0
  STADE_DEVIS_ENVOYE,   // 1
  STADE_CONFIRME,       // 2
  'Post-opératoire',    // 3
  'Clôturé ✓',          // 4
] as const;

/** Rang du stade : -1 si vide · 0..4 · **null si la valeur est hors échelle**.

    Hors échelle, on ne touche à rien — et on le PORTE AU RAPPORT : une fiche mal
    orthographiée se gèlerait sinon en silence, et personne ne l'apprendrait.

    La reconnaissance passe par `normaliser()`, la même fonction que pour le nom
    du chirurgien : un seul principe, comparer normalisé et écrire non
    normalisé. « Clôturé » privé de son ✓ est ainsi reconnu comme rang 4, et la
    fiche reste protégée. Mesuré : 68 fiches, aucune hors échelle aujourd'hui —
    cette règle protège l'avenir. */
export function rangStade(v: unknown): number | null {
  const brut = String(v ?? '').trim();
  if (!brut) return -1;
  const cle = normaliser(brut);
  const i = ECHELLE_STADE.findIndex((e) => normaliser(e) === cle);
  return i >= 0 ? i : null;
}

export interface ChampRemonte {
  /** Clé lue sur le document, ou `__stade` pour une valeur calculée. */
  devis: string;
  /** Colonne de `patients` écrite. */
  fiche: string;
  libelle: string;
  /* Un écart CRM/document alimente-t-il la liste des divergences ?

     Non pour `procedure` et `stade`, et c'est délibéré : un stade en avance sur
     son document est le cours normal des choses (une patiente opérée est
     « Post-opératoire » alors que son devis dit « accepté »), et deux
     vocabulaires pour une même intervention ne sont pas un désaccord. Les
     signaler noierait les écarts de budget, qui, eux, veulent dire quelque
     chose. La règle « on n'écrit que si le champ est vide » protège déjà. */
  silencieux?: boolean;
}

export const CHAMPS_REMONTES: readonly ChampRemonte[] = [
  { devis: 'dateIntervention', fiche: 'dateOperation', libelle: "date d'opération" },
  { devis: 'date', fiche: 'dateDevis', libelle: 'date du devis' },
  { devis: 'chirurgien', fiche: 'medecin', libelle: 'chirurgien' },
  { devis: 'forfait', fiche: 'budget', libelle: 'budget' },
  { devis: 'actes', fiche: 'procedure', libelle: 'intervention', silencieux: true },
  { devis: CLE_STADE, fiche: 'stade', libelle: 'stade', silencieux: true },
];

/* `patients.budget` est du texte, en chiffres bruts : « 8500 », sans espace ni
   symbole — les 52 valeurs déjà en base vérifient toutes ^[0-9]+$. C'est le
   FORFAIT du document, jamais un total recalculé : sur D-2026-000029, forfait
   4 900 € + options 3 670 € = 8 570 €, et aucun total n'est stocké. */
const enChiffresBruts = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? String(n) : '';
};

/* `patients."procedure"` — au SINGULIER. C'est cette colonne que la carte de la
   liste patients affiche ; `procedures` au pluriel est un vestige (vide 45 fois
   sur 67, jamais de JSON, une seule valeur `[]`). Y écrire ne changerait rien à
   l'écran, ce qui se solderait par « c'est toujours vide ».

   On y met les libellés d'actes du document, MOT POUR MOT, joints par « · ».
   Aucune reformulation, aucune mise en correspondance avec le catalogue, aucune
   troncature : `catalogue_correspondances` sert aux tarifs, pas à réécrire ce
   qu'un document remis à une patiente annonce. */
const actesJoints = (v: unknown): string =>
  Array.isArray(v)
    ? v.map((a) => String((a as { acte?: unknown })?.acte ?? '').trim()).filter(Boolean).join(' · ')
    : '';

/** Valeur du document, mise au format de la colonne CRM visée. */
function valeurPourFiche(champ: ChampRemonte, doc: Record<string, unknown>, e: Engagement): string {
  if (champ.fiche === 'budget') return enChiffresBruts(doc[champ.devis]);
  if (champ.fiche === 'procedure') return actesJoints(doc[champ.devis]);
  if (champ.devis === CLE_STADE) {
    if (e === 'engage') return STADE_CONFIRME;
    if (e === 'envoye') return STADE_DEVIS_ENVOYE;
    return '';                                    // rien à proposer
  }
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
  /* Ce qu'on avait à proposer et qu'on n'a PAS écrit, avec la raison — destiné
     à être DIT. Sans ce retour, l'assistante clique, la date apparaît, la
     pastille reste grise, et elle conclut que c'est cassé. */
  laisses: { libelle: string; pourquoi: string }[];
  /** Valeur de stade hors échelle rencontrée : à porter au rapport. */
  stadeHorsEchelle?: string;
}

/* Trois niveaux, pas deux. Un devis ENVOYÉ parle au CRM, mais pour dire une
   seule chose : où en est le dossier. Il n'écrit donc que le stade. */
export type Engagement = 'aucun' | 'envoye' | 'engage';

export function niveauEngagement(devisDeLaPatiente: DocRecord[], paye: boolean): Engagement {
  if (paye || devisDeLaPatiente.some((d) => remonteeAutomatique(d.statut))) return 'engage';
  if (devisDeLaPatiente.some((d) => String(d.statut || '') === 'envoye')) return 'envoye';
  return 'aucun';
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

/* ------------------------------------------------- clause d'annulation

   L'annulation se pose sur la FACTURE et ne remonte jamais au DEVIS : un devis
   accepté le reste pour toujours, même quand l'affaire est morte. Mesuré : les
   deux seules factures annulées de la base sont adossées à un devis resté
   « accepte » — F-2026-000009 (Tresor) et F-2026-000012 (Munao). Le rattrapage
   du 19 août, qui ne portait pas cette clause, a promu Tresor à « Confirmé »
   à tort ; elle a été rétablie à la main. Tant que la clause vivait hors du
   code, ça recommençait à la prochaine annulation.

   La règle du cahier (chapitre 1) : un devis accepté fait passer la fiche à
   « Confirmé » À CONDITION qu'aucune facture annulée ne lui soit rattachée.

   Une facture VIVANTE lève le blocage, et c'est voulu : le chantier « annuler
   et remplacer » (décidé le 19 août) laissera la facture fautive en base,
   marquée annulée, sa remplaçante vivante à côté. Bloquer sur la seule
   présence d'une annulée gèlerait pour toujours toute fiche passée par un
   remplacement. L'annulée ne dit « affaire morte » que si rien de vivant ne
   lui a succédé. Un brouillon ne lève rien : il n'engage personne. */
export const STATUT_FACTURE_ANNULEE = 'annulee';

export function annulationBloqueConfirmation(factures: DocRecord[]): boolean {
  const fs = factures || [];
  return fs.some((f) => String(f.statut || '') === STATUT_FACTURE_ANNULEE)
    && !fs.some((f) => factureEstVivante(f.statut));
}

/* Ce que le document écrirait, ce qu'il laisse tel quel, ce qu'il signale.
   UNE seule implémentation pour les devis ET les factures : les deux partagent
   la forme DocRecord, et deux copies divergeraient au premier changement. */
export function planifierRemontee(
  devis: DocRecord,
  fiche: Patient,
  opts: { engagement: Engagement; forcerDonnees?: boolean; factures?: DocRecord[] } = { engagement: 'engage' },
): PlanRemontee {
  const { engagement, forcerDonnees = false, factures = [] } = opts;
  const aEcrire: Record<string, string> = {};
  const divergences: Divergence[] = [];
  const dejaConformes: string[] = [];
  const laisses: { libelle: string; pourquoi: string }[] = [];
  let stadeHorsEchelle: string | undefined;

  for (const champ of CHAMPS_REMONTES) {
    const estStade = champ.devis === CLE_STADE;

    /* Un devis ENVOYÉ n'écrit que le stade. Les cinq colonnes de données
       attendent l'engagement — ou un clic humain, qui force la DONNÉE mais
       jamais l'avancement du processus. */
    if (!estStade && engagement !== 'engage' && !forcerDonnees) continue;

    const valeurDevis = valeurPourFiche(champ, devis as unknown as Record<string, unknown>, engagement);
    const valeurCrm = String((fiche as unknown as Record<string, unknown>)[champ.fiche] ?? '');

    /* Le stade n'a rien à proposer quand rien n'engage — mais il faut le DIRE.
       C'est le cas du bouton manuel sur un brouillon : cinq champs arrivent, le
       stade ne bouge pas, et sans cette phrase l'utilisateur croit à une panne. */
    if (estStade && !valeurDevis) {
      if (forcerDonnees) {
        laisses.push({ libelle: champ.libelle, pourquoi: "le devis est encore un brouillon" });
      }
      continue;
    }
    if (!valeurDevis) continue;                     // rien à proposer

    if (estStade) {
      /* La clause d'annulation, AVANT la règle ordonnée : un « Confirmé »
         proposé pour une affaire morte n'est pas un rang à comparer, c'est une
         proposition qui n'a pas lieu d'être. Et on le DIT — sans cette phrase,
         l'assistante voit la fiche rester en place et conclut à une panne. */
      if (valeurDevis === STADE_CONFIRME && annulationBloqueConfirmation(factures)) {
        laisses.push({
          libelle: champ.libelle,
          pourquoi: 'une facture annulée est rattachée à la fiche, sans facture vivante qui la remplace',
        });
        continue;
      }
      /* LA règle ordonnée, et la seule du fichier. Un stade ne monte que d'un
         rang strictement supérieur ; il ne recule jamais. */
      const actuel = rangStade(valeurCrm);
      const propose = rangStade(valeurDevis);
      if (actuel === null) {
        // Valeur inconnue de l'échelle : on ne touche à rien, et on le dit.
        stadeHorsEchelle = valeurCrm;
        laisses.push({ libelle: champ.libelle, pourquoi: `valeur « ${valeurCrm} » hors de l'échelle connue` });
        continue;
      }
      if (propose === null || propose <= actuel) {
        if (propose !== null && propose === actuel) dejaConformes.push(champ.libelle);
        else laisses.push({ libelle: champ.libelle, pourquoi: `la fiche est déjà à « ${valeurCrm} »` });
        continue;
      }
      aEcrire[champ.fiche] = valeurDevis;
      continue;
    }

    /* Les cinq autres : règle stricte, inchangée depuis le premier lot. */
    if (vide(valeurCrm)) { aEcrire[champ.fiche] = valeurDevis; continue; }
    if (normaliser(valeurCrm) === normaliser(valeurDevis)) { dejaConformes.push(champ.libelle); continue; }
    /* Le champ CRM est occupé par autre chose — et il RESTE tel quel, quelle que
       soit la suite : c'est la règle « on n'écrit que si vide » qui protège,
       jamais un test de valeur. Seule change la façon d'en rendre compte. */
    if (champ.silencieux) continue;
    divergences.push({ libelle: champ.libelle, colonne: champ.fiche, valeurCrm, valeurDevis });
  }
  return { aEcrire, divergences, dejaConformes, laisses, stadeHorsEchelle };
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

/* ------------------------------------------------- « la patiente a payé »

   Second terme du OU qui déclenche la remontée, et second terme du stade.
   Le client l'a mesuré : le statut d'un document ne suit pas la réalité —
   quatre factures sont en « brouillon » avec un paiement encaissé dessus, et
   deux patientes ont payé sans avoir de devis accepté. Le paiement est donc un
   signal d'engagement à part entière, pas un doublon du statut.

   ⚠ Mesuré aussi : 3 paiements sur 12 n'ont PAS de `patient_id`, et ne sont
   rattachables que par `facture_id`. Chercher sur le seul `patient_id` en
   manquerait le quart — exactement le genre d'oubli qui se solde par
   « c'est toujours vide ». On cherche donc par les deux voies. */
export function aPaye(paiements: Paiement[], patientId: string, idsFactures: string[]): boolean {
  const id = String(patientId || '').trim();
  const factures = new Set(idsFactures.filter(Boolean));
  return (paiements || []).some((p) => {
    if (!(Number(p.montant) > 0)) return false;
    if (id && String(p.patientId || '').trim() === id) return true;
    return !!p.refId && factures.has(String(p.refId));
  });
}


