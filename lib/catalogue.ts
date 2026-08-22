/* Groupement et recherche du catalogue — SOURCE UNIQUE.

   Les deux listes « Appliquer un modèle » (actes et options) passent par ici :
   une seule règle de groupement, un seul tri, une seule recherche. Dupliquer
   ces règles ailleurs les ferait diverger au premier ajout au catalogue.

   Aucune saisie n'est nécessaire : les colonnes `categorie` et `sous_categorie`
   du CRM sont déjà remplies. Rien n'est écrit au catalogue, jamais. */

import { safeLower } from './format';
import type { Acte, Modele } from './types';

/** Une ligne de `catalogue_correspondances`, telle que chargée dans AppData. */
export interface Correspondance { libelle: string; catalogueId: string | null; statut: string }

/* Clé de comparaison des libellés : accents, casse et espaces multiples
   effacés — la ponctuation reste. Mesuré le 20 août : la table de
   correspondances porte quatre paires qui n'existent que pour rattraper des
   majuscules (« Fox eyes » / « Fox Eyes »…) — huit lignes sur cinquante-six de
   typographie au milieu de vrais arbitrages tarifaires. Une table de
   traduction ne doit pas porter de typographie : c'est la comparaison qui
   l'absorbe. (Ces huit lignes deviennent retirables côté CRM — pas par nous.) */
export const cleLibelle = (v: unknown): string =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

export interface GroupeModeles {
  titre: string;
  items: Modele[];
}

/* L'ordre de ce tableau EST l'ordre d'affichage. La première règle qui accepte
   une prestation la prend : les règles sont donc rangées de la plus précise à
   la plus large. Vérifié en base sur les 76 lignes actives — aucun orphelin,
   et les lignes esthétiques sans sous-catégorie sont exactement les combo-*. */
const REGLES: { titre: string; prend: (m: Modele) => boolean }[] = [
  { titre: 'Chirurgie esthétique — Corps', prend: (m) => m.categorie === 'esthetique' && m.sousCategorie === 'corps' },
  { titre: 'Chirurgie esthétique — Visage', prend: (m) => m.sousCategorie === 'visage' },
  { titre: 'Chirurgie esthétique — Homme', prend: (m) => m.sousCategorie === 'masculine' },
  { titre: 'Forfaits combinés', prend: (m) => m.categorie === 'esthetique' && !m.sousCategorie },
  { titre: 'Greffe capillaire', prend: (m) => m.categorie === 'capillaire' },
  { titre: 'Chirurgie bariatrique', prend: (m) => m.categorie === 'bariatrique' },
  { titre: 'Dentaire', prend: (m) => m.categorie === 'dentaire' },
  { titre: 'Suppléments', prend: (m) => m.categorie === 'supplement' },
];

/* Une prestation qu'aucune règle ne prend n'est PAS escamotée : elle apparaît
   dans un groupe de fin, visible, pour être signalée au CRM. Mieux vaut un
   groupe inattendu à l'écran qu'une prestation devenue introuvable. */
const GROUPE_RESTANT = 'Autres prestations';

/** Comparaison alphabétique française, insensible aux accents et à la casse. */
const parNom = (a: Modele, b: Modele) => a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' });

export function grouperModeles(modeles: Modele[]): GroupeModeles[] {
  const restant = new Set(modeles);
  const groupes: GroupeModeles[] = [];
  for (const regle of REGLES) {
    const items: Modele[] = [];
    for (const m of restant) {
      if (regle.prend(m)) { items.push(m); restant.delete(m); }
    }
    if (items.length) groupes.push({ titre: regle.titre, items: items.sort(parNom) });
  }
  if (restant.size) groupes.push({ titre: GROUPE_RESTANT, items: [...restant].sort(parNom) });
  return groupes;
}

/* La recherche porte sur le libellé, les synonymes du CRM, ET les libellés
   d'usage de `catalogue_correspondances` au statut « valide » : taper
   « SAFE BBL » — le nom que cinq devis emploient — trouve la ligne officielle.

   Les correspondances « a_verifier » ne nourrissent JAMAIS la recherche :
   guider une main vers une ligne tarifée sur la foi d'une correspondance non
   relue, c'est un tarif engagé sans relecture (cahier, ch. 2). La recette
   scripts/recette-selecteur-catalogue.ts rougit si ce filtre s'assouplit.

   Chaque mot saisi doit être présent quelque part — l'ordre des mots n'a
   aucune importance. `correspondances` est optionnel : les appelants existants
   ne changent pas. */
export function filtrerModeles(
  modeles: Modele[], recherche: string, correspondances?: Correspondance[],
): Modele[] {
  const mots = safeLower(recherche).split(/\s+/).filter(Boolean);
  if (!mots.length) return modeles;
  const usages = new Map<string, string[]>();
  for (const c of correspondances || []) {
    if (c.statut !== 'valide' || !c.catalogueId) continue;
    (usages.get(c.catalogueId) || usages.set(c.catalogueId, []).get(c.catalogueId)!).push(c.libelle);
  }
  return modeles.filter((m) => {
    const foin = safeLower(
      [m.nom, m.categorie, m.sousCategorie, ...(m.synonymes || []), ...(usages.get(m.id) || [])].join(' '),
    );
    return mots.every((mot) => foin.includes(mot));
  });
}

/* --------------------------------------------- reconnaissance d'un libellé

   Ce qu'un libellé d'acte VAUT face au catalogue — une lecture, jamais une
   écriture : la pastille de l'éditeur s'en sert pour DIRE, pas pour corriger.
   Mesuré le 20 août sur les 29 libellés des 22 devis : 7 exacts, 9 par
   correspondance valide, 1 par une « a_verifier », 12 sans rien.

   Priorité : l'égalité avec le catalogue l'emporte sur la table (elle n'a pas
   besoin d'elle), puis « valide » l'emporte sur « a_verifier » — les quatre
   paires de casse de la table visent la même cible, l'ordre est donc sans
   perte. */
export interface ResolutionLibelle {
  etat: 'exact' | 'valide' | 'a_verifier' | 'aucun';
  /** La ligne du catalogue visée — absente si l'état est « aucun », ou si la
      cible de la correspondance n'est plus dans les lignes actives. */
  modele?: Modele;
}

export function resoudreLibelle(
  libelle: unknown, modeles: Modele[], correspondances?: Correspondance[],
): ResolutionLibelle {
  const cle = cleLibelle(libelle);
  if (!cle) return { etat: 'aucun' };
  const exact = modeles.find((m) => cleLibelle(m.nom) === cle);
  if (exact) return { etat: 'exact', modele: exact };
  const candidates = (correspondances || []).filter((c) => c.catalogueId && cleLibelle(c.libelle) === cle);
  const retenue = candidates.find((c) => c.statut === 'valide') || candidates[0];
  if (!retenue) return { etat: 'aucun' };
  return {
    etat: retenue.statut === 'valide' ? 'valide' : 'a_verifier',
    modele: modeles.find((m) => m.id === retenue.catalogueId),
  };
}

/* ------------------------------------------------------- lignes d'acte vides

   Mesuré le 20 août : deux devis émis (D-2026-000023, D-2026-000033) portent
   une ligne d'acte entièrement vide — une ligne blanche au milieu du tableau
   d'actes d'un document médical imprimé. L'éditeur ajoute une ligne vide pour
   la saisie ; elle ne doit pas PARTIR. Retirée à l'enregistrement seulement :
   les deux existantes ne bougent pas tant que leur devis n'est pas
   réenregistré — aucune écriture rétroactive. */
export function nettoyerActes(actes: Acte[] | undefined): Acte[] {
  return (actes || []).filter(
    (a) => String(a?.acte ?? '').trim() !== '' || String(a?.inclus ?? '').trim() !== '',
  );
}

/* ------------------------------------------------------ synonymes ambigus

   Treize synonymes du CRM sont portés par DEUX lignes actives à la fois.
   « lipo 360 » désigne aussi bien un raffermissement cutané à 2 000 € qu'une
   liposuccion à 3 300 € : deux interventions sans rapport, et un devis qui
   part avec la mauvaise ligne sans que personne le voie.

   On ne corrige pas la donnée — le catalogue appartient au CRM. On refuse le
   choix silencieux : quand le terme saisi est porté par plusieurs lignes, on
   nomme l'ambiguïté, on montre les deux tarifs, et le choix se fait sur le
   libellé. Aucun coût quand il n'y a pas d'ambiguïté : la liste normale ne
   change pas d'un pixel. */

export interface Ambiguite {
  terme: string;
  lignes: Modele[];
}

/** Synonymes correspondant à la saisie et portés par plus d'une ligne active. */
export function detecterAmbiguites(modeles: Modele[], recherche: string): Ambiguite[] {
  const q = safeLower(recherche).trim();
  if (q.length < 3) return [];      // trop court pour être un terme métier

  const porteurs = new Map<string, Modele[]>();
  for (const m of modeles) {
    for (const syn of m.synonymes || []) {
      const cle = safeLower(syn).trim();
      if (!cle || !cle.includes(q)) continue;
      // Le libellé de la ligne l'emporte : s'il contient déjà la saisie,
      // le choix n'est pas ambigu pour cette ligne-là.
      const liste = porteurs.get(cle) || [];
      if (!liste.includes(m)) liste.push(m);
      porteurs.set(cle, liste);
    }
  }
  return [...porteurs.entries()]
    .filter(([, lignes]) => lignes.length > 1)
    .map(([terme, lignes]) => ({ terme, lignes: [...lignes].sort(parNom) }))
    .sort((a, b) => a.terme.localeCompare(b.terme, 'fr'));
}

/* ------------------------------------------- remplissage des prestations

   Décidé par Veys le 22 août 2026 : choisir un acte au sélecteur remplit les
   prestations incluses / non incluses depuis le catalogue. La donnée était là
   — 79 lignes, toutes avec `inclusions` et `exclusions`, réécrites en
   formulation patiente le 22 août — et rien ne la lisait. Trois règles, pas
   une de plus :

   ① SERVICES — consultation, analyses, anesthésie, transferts, traductrice,
      corset, bas de contention, suivi… — s'UNISSENT d'un acte à l'autre, sans
      doublon : la clé de comparaison est celle du sélecteur (cleLibelle —
      casse, accents, espaces). Une ligne déjà là ne s'ajoute pas une seconde
      fois ; une ligne absente s'ajoute à la fin, dans l'ordre du catalogue.
   ② NUITS — « 2 nuits en clinique », « 4 nuits d'hôtel 5★ » — viennent d'UN
      SEUL acte : le plus long du devis (duree_sejour_jours). Deux actes ne
      s'additionnent pas en nuits : la patiente fait un séjour, pas deux. Sans
      durée au catalogue, pas de nuits — rien n'est deviné.
   ③ Le remplissage se déclenche à la SÉLECTION seulement, et n'écrase jamais
      ce qu'une main a écrit. Ce que le système a écrit lui-même — les défauts
      des Paramètres, le vocabulaire du catalogue — il peut le remplacer ; ce
      qu'il ne reconnaît pas, il le laisse. Il ne RETIRE jamais rien : une
      ligne de trop se supprime à la main, comme avant.

   Conséquence : une liste encore égale aux défauts des Paramètres (devis neuf,
   rien touché) ou vide est remplacée franchement par le catalogue — c'est le
   comportement d'« Appliquer un modèle » d'avant ce lot, conservé. Une liste
   retouchée n'est que complétée. La recette
   scripts/recette-remplissage-prestations.ts rougit si l'une des trois règles
   s'assouplit. */

export type NatureLigne = 'clinique' | 'hotel' | 'service';

/** Ce qu'une ligne de prestation est : une nuit en clinique, une nuit d'hôtel, ou un service. */
export function natureLigne(ligne: unknown): NatureLigne {
  const cle = cleLibelle(ligne);
  if (!/\bnuits?\b/.test(cle)) return 'service';
  if (/\b(clinique|hopital|hospitalisation)\b/.test(cle)) return 'clinique';
  if (/\bhotel\b/.test(cle)) return 'hotel';
  return 'service';
}

const NATURES_NUIT: NatureLigne[] = ['clinique', 'hotel'];

/** Durée de séjour d'un modèle, pour désigner « le plus long » ; -1 quand le catalogue n'en porte pas. */
const dureeDe = (m: Modele): number => m.dureeJours ?? m.dureeNuits ?? -1;

/* Le plus long des actes résolus. Ex æquo : le PREMIER du devis garde la main —
   ajouter un second acte de même durée ne fait pas basculer les nuits. Aucune
   durée nulle part → aucun acte ne fait foi. */
export function acteLePlusLong(actes: Modele[]): Modele | undefined {
  let meilleur: Modele | undefined;
  for (const m of actes) {
    if (dureeDe(m) >= 0 && (!meilleur || dureeDe(m) > dureeDe(meilleur))) meilleur = m;
  }
  return meilleur;
}

/* Les modèles qu'un devis désigne par ses lignes d'acte : égalité avec le
   catalogue ou correspondance « valide » — jamais une « a_verifier » (un tarif
   engagé sans relecture ne remplit rien non plus), jamais un libellé inconnu.
   Un même modèle cité deux fois compte une fois. */
export function modelesDesActes(
  actes: Acte[] | undefined, modeles: Modele[], correspondances?: Correspondance[],
): Modele[] {
  const vus = new Set<string>();
  const out: Modele[] = [];
  for (const a of actes || []) {
    const r = resoudreLibelle(a?.acte, modeles, correspondances);
    if ((r.etat === 'exact' || r.etat === 'valide') && r.modele && !vus.has(r.modele.id)) {
      vus.add(r.modele.id);
      out.push(r.modele);
    }
  }
  return out;
}

export interface ContexteRemplissage {
  /** Tout le catalogue chargé : il définit le vocabulaire que le système reconnaît comme le sien. */
  modeles: Modele[];
  /** Défauts des Paramètres PDF (composeIncExc) : une liste encore égale à eux n'a pas été touchée. */
  defauts: { inc: string[]; exc: string[] };
}

export interface Remplissage {
  inc: string[];
  exc: string[];
  /** L'acte dont les nuits font foi — absent quand aucun acte résolu ne porte de durée. */
  nuitsDe?: Modele;
  /** Ce qui a été fait, pour le DIRE à l'écran — jamais pour décider. */
  ajoutees: string[];
  remplacees: { avant: string; apres: string }[];
}

const clesDe = (lignes: string[] | undefined): string[] => (lignes || []).map(cleLibelle).filter(Boolean);

/** Même liste au sens de la clé : mêmes lignes non vides, dans le même ordre. */
const memeListe = (a: string[] | undefined, b: string[] | undefined): boolean => {
  const ca = clesDe(a);
  const cb = clesDe(b);
  return ca.length === cb.length && ca.every((x, i) => x === cb[i]);
};

export function remplirPrestations(
  courant: { inc?: string[]; exc?: string[] },
  actesResolus: Modele[],
  nouveau: Modele,
  contexte: ContexteRemplissage,
): Remplissage {
  const actes = actesResolus.includes(nouveau) ? actesResolus : [...actesResolus, nouveau];
  const nuitsDe = acteLePlusLong(actes);
  /* L'acte qui donne l'ORDRE des lignes : celui des nuits s'il existe, sinon celui qu'on vient de choisir. */
  const principal = nuitsDe || nouveau;
  const ordonnes = [principal, ...actes.filter((m) => m !== principal)];

  /* Vocabulaire « du système » : ce qu'il a pu écrire lui-même, donc ce qu'il peut remplacer. */
  const vocabulaire = new Set<string>([
    ...clesDe(contexte.defauts.inc),
    ...clesDe(contexte.defauts.exc),
    ...contexte.modeles.flatMap((m) => [...clesDe(m.inc), ...clesDe(m.exc)]),
  ]);
  const ajoutees: string[] = [];
  const remplacees: { avant: string; apres: string }[] = [];

  /* ---- incluses ---- */
  const viergeInc = !clesDe(courant.inc).length || memeListe(courant.inc, contexte.defauts.inc);
  const inc: string[] = viergeInc ? [] : [...(courant.inc || [])];
  const presentes = new Set(clesDe(inc));
  const ajouter = (liste: string[], vues: Set<string>, ligne: string) => {
    const cle = cleLibelle(ligne);
    if (!cle || vues.has(cle)) return;
    liste.push(ligne);
    vues.add(cle);
    ajoutees.push(ligne);
  };
  /* ② — une nuit vient du plus long et de lui seul ; elle prend la place d'une
     nuit de même nature écrite par le système, jamais celle d'une main. */
  const placerNuit = (voulue: string) => {
    const nature = natureLigne(voulue);
    const i = inc.findIndex((l) => natureLigne(l) === nature);
    if (i < 0) { ajouter(inc, presentes, voulue); return; }
    const avant = inc[i];
    if (cleLibelle(avant) === cleLibelle(voulue) || !vocabulaire.has(cleLibelle(avant))) return;
    inc[i] = voulue;
    presentes.delete(cleLibelle(avant));
    presentes.add(cleLibelle(voulue));
    remplacees.push({ avant, apres: voulue });
  };
  for (const m of ordonnes) {
    for (const ligne of m.inc || []) {
      if (natureLigne(ligne) === 'service') ajouter(inc, presentes, ligne);
      else if (m === nuitsDe) placerNuit(ligne);
      /* une nuit d'un acte qui n'est pas le plus long : ignorée, par construction */
    }
  }

  /* ---- non incluses : union, sans doublon, jamais de retrait ---- */
  const viergeExc = !clesDe(courant.exc).length || memeListe(courant.exc, contexte.defauts.exc);
  const exc: string[] = viergeExc ? [] : [...(courant.exc || [])];
  const presentesExc = new Set(clesDe(exc));
  for (const m of ordonnes) for (const ligne of m.exc || []) ajouter(exc, presentesExc, ligne);

  return { inc, exc, nuitsDe, ajoutees, remplacees };
}

/* Une nature de nuit que NATURES_NUIT ne nomme pas n'existe pas : la liste
   est le contrat de placerNuit, exportée pour que la recette le vérifie. */
export const NATURES_DE_NUIT: readonly NatureLigne[] = NATURES_NUIT;
