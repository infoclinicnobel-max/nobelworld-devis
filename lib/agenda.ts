/* Le devis accepté pose l'opération au calendrier.

   Pourquoi un fichier à part, et pourquoi PUR : la règle anti-doublon doit être
   la même pour le flux et pour tout rattrapage à venir. Deux implémentations
   divergeraient au premier changement — c'est déjà arrivé sur la comparaison
   des noms de chirurgien. Ici, aucune connexion, aucune horloge : tout ce qui
   varie est injecté, donc la recette rejoue exactement ce que le flux exécute.

   ⚠ `rdvs` n'appartient pas à Nobel World. Ce fichier ne décide QUE du contenu ;
   la seule écriture vit dans `insererRendezVousOperation` de lib/data.ts, en
   INSERT, et `rdvs` reste hors de TABLES_ECRITURE — y entrer ouvrirait aussi
   `supprimer()`. */

import { DATE_ISO, rangStade, STADE_CONFIRME, type Engagement } from './fiche';

/** Le seul type que ce chemin sait écrire. Reposé à l'instant de l'INSERT. */
export const TYPE_OPERATION = 'Opération';

/* Aucune source ne porte d'heure : ni `patients`, ni `nw_devis`, ni
   `nw_factures`. Les 48 rendez-vous existants en ont tous une, dont 40 à 10 h.
   C'est donc une CONVENTION, pas une donnée — et c'est la raison d'être de
   `CREE_PAR` : pouvoir retrouver les lignes posées ainsi. */
export const HEURE_PAR_DEFAUT = '10:00';
export const CREE_PAR = 'nobelworld';

/* Vocabulaire EXISTANT de la colonne `statut` : 47 lignes sur 48 sont
   « Confirmé », une est « Planifié ». On ne l'élargit pas. */
export const STATUT_CONFIRME = 'Confirmé';
export const STATUT_PLANIFIE = 'Planifié';

export interface FicheAgenda {
  id: string;
  dateOperation?: string | null;
  medecin?: string | null;
  hopital?: string | null;
  stade?: string | null;
}

export interface RdvExistant { id: string; type: string; date: string }

export interface LigneAgenda {
  id: string;
  patientId: string;
  type: string;
  date: string;
  heure: string;
  medecin: string;
  hopital: string;
  statut: string;
  creePar: string;
}

/* Quatre issues, et chacune doit pouvoir être DITE : un utilisateur qui ne voit
   rien arriver au calendrier doit apprendre pourquoi, sinon il conclut à une
   panne — la plainte qui a lancé ce lot. */
export type PlanAgenda =
  | { cas: 'deja-la'; rdvId: string }
  | { cas: 'a-creer'; ligne: LigneAgenda }
  | { cas: 'ecart'; rdvId: string; dateAgenda: string; dateFiche: string }
  | { cas: 'rien'; pourquoi: string };

const texte = (v: unknown) => String(v ?? '').trim();

/* `rdvs.id` est engendré côté client : 13 chiffres d'horodatage suivis de 4
   caractères. Les 48 lignes en base le vérifient toutes. On reprend ce format
   à l'identique — un format inédit se verrait dans le CRM. */
export function idRendezVous(horodatage: number, suffixe: string): string {
  return `${Math.trunc(horodatage)}${suffixe}`;
}

/* Le statut suit l'avancement réel de la fiche, pas le fait qu'on écrive.
   `rangStade` vient de lib/fiche.ts : une seule échelle dans l'application. */
export function statutPourStade(stade: unknown): string {
  const rang = rangStade(stade);
  const confirme = rangStade(STADE_CONFIRME);
  return rang !== null && confirme !== null && rang >= confirme ? STATUT_CONFIRME : STATUT_PLANIFIE;
}

/** Ce qu'il faut poser au calendrier — ou pourquoi on ne pose rien.

    LA règle du fichier, en trois cas :
      · un rendez-vous « Opération » à la MÊME date  → rien, il est déjà là ;
      · AUCUN rendez-vous « Opération »              → on crée ;
      · un rendez-vous « Opération » à une AUTRE date → ON NE CRÉE RIEN, on signale.

    Le troisième cas est le seul difficile, et il n'est pas théorique : mesuré le
    19/08, trois fiches sur dix le présentaient, l'agenda à J+1 de la fiche, et
    sur l'une d'elles rien ne départageait les deux dates. Créer alors un second
    rendez-vous donnerait DEUX opérations à une même patiente. L'agenda peut
    avoir raison : l'écart remonte à l'écran, comme un écart de budget. */
export function planifierRendezVous(
  fiche: FicheAgenda,
  rdvs: RdvExistant[],
  opts: { engagement: Engagement; horodatage: number; suffixe: string; aujourdhui?: string },
): PlanAgenda {
  /* Un devis ENVOYÉ n'écrit que le stade ; il ne réserve pas un bloc opératoire.
     Poser un rendez-vous pour une patiente non confirmée bloquerait un créneau
     pour rien. */
  if (opts.engagement !== 'engage') {
    return { cas: 'rien', pourquoi: "le dossier n'est pas encore engagé" };
  }
  const date = texte(fiche.dateOperation);
  if (!date) return { cas: 'rien', pourquoi: "la fiche ne porte pas de date d'opération" };

  const operations = (rdvs || []).filter((r) => texte(r.type) === TYPE_OPERATION);
  const memeDate = operations.find((r) => texte(r.date) === date);
  if (memeDate) return { cas: 'deja-la', rdvId: texte(memeDate.id) };

  const autre = operations[0];
  if (autre) {
    return {
      cas: 'ecart', rdvId: texte(autre.id), dateAgenda: texte(autre.date), dateFiche: date,
    };
  }

  /* Une date déjà passée ne se pose pas au calendrier : une opération posée en
     janvier dernier parce qu'un devis accepté tard la porte encore n'avertit
     personne (D-2026-000046 : 2026-01-05, mesuré le 22 août). Le même-date et
     l'écart passent AVANT : un rendez-vous existant se reconnaît, passé ou non.
     `aujourdhui` est injecté (todayISO()) pour que la règle reste pure. */
  if (opts.aujourdhui && DATE_ISO.test(opts.aujourdhui) && date < opts.aujourdhui) {
    return { cas: 'rien', pourquoi: `la date d'opération ${date} est déjà passée : rien n'est posé au calendrier` };
  }

  return {
    cas: 'a-creer',
    ligne: {
      id: idRendezVous(opts.horodatage, opts.suffixe),
      patientId: texte(fiche.id),
      type: TYPE_OPERATION,
      date,
      heure: HEURE_PAR_DEFAUT,
      /* Recopiés MOT POUR MOT, casse comprise. La fiche porte parfois
         « ANVAR AHMEDOV » là où l'agenda écrit « Dr Anvar Ahmedov » : on
         compare normalisé, on écrit non normalisé. La casse discordante se
         signale, elle ne se corrige pas en douce. */
      medecin: texte(fiche.medecin),
      /* Vocabulaire du CRM (« Avrasya Hospital »), jamais celui des documents
         (« Avrasya Hastanesi — Istanbul, Türkiye »). Vide est normal : 22 des
         48 rendez-vous existants le sont. */
      hopital: texte(fiche.hopital),
      statut: statutPourStade(fiche.stade),
      creePar: CREE_PAR,
    },
  };
}
