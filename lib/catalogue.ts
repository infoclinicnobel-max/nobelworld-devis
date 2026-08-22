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
      On n'aligne pas les mots : deux vocabulaires coexistent parce que deux
      natures coexistent — le dentaire dit « anesthésie » parce qu'elle est
      locale, l'esthétique « anesthésie générale ». Un devis mixte porte les
      deux lignes, et c'est juste.
   ② NUITS — la patiente fait UN séjour, pas deux. Le séjour (nuits totales)
      est celui de l'acte le plus long (duree_nuits) ; les nuits de clinique
      sont le MAXIMUM que réclame un acte ; les nuits d'hôtel sont le reste.
      Sleeve (4 j / 3 n : 2 + 1) + rhinoplastie (6 j / 5 n : 1 + 4) → séjour 5,
      clinique 2, hôtel 3. Deux invariants, que chaque règle plus simple
      brisait : le total ne dépasse jamais le séjour (« le maximum par
      nature » promettait 6 nuits sur 5) ; la clinique n'est jamais en dessous
      de l'acte le plus exigeant (« le plus long et lui seul » couchait une
      patiente bariatrique une seule nuit). La règle est sûre tant qu'aucune
      ligne du catalogue ne promet plus de nuits de clinique qu'elle n'a de
      nuits — mesuré le 22 août : 0 écart sur 66 — et verifierSejours le
      contrôle en permanence, pas une fois. Sans durée au catalogue, pas de
      nuits : rien n'est deviné.
   ③ Le remplissage se déclenche à la SÉLECTION seulement, et n'écrase jamais
      ce qu'une main a écrit. Ce que le système a écrit lui-même — les défauts
      des Paramètres, le vocabulaire du catalogue, un nombre de nuits qu'il a
      calculé — il peut le remplacer ; ce qu'il ne reconnaît pas, il le laisse
      et le DIT. Il ne RETIRE jamais rien : une ligne de trop se supprime à la
      main, comme avant.

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

/** Le nombre en tête d'une ligne de nuits — « 2 nuits en clinique » → 2 ; absent → null. */
export function nombreDeNuits(ligne: unknown): number | null {
  const m = /^(\d+)\s+nuits?\b/.exec(cleLibelle(ligne));
  return m ? Number(m[1]) : null;
}

/** La même ligne avec un autre nombre, singulier et pluriel compris — le reste mot pour mot. */
export function renumeroter(ligne: string, n: number): string {
  return ligne.replace(/^\s*\d+\s+nuits?/i, `${n} ${n > 1 ? 'nuits' : 'nuit'}`);
}

/* Clé d'une ligne de nuits, nombre effacé : « 1 nuits en clinique » (faute d'un
   ancien catalogue) et « 2 nuits en clinique » sont la MÊME ligne du système ;
   « 5 nuits d'hôtel 5★ (négocié) » n'appartient qu'à la main qui l'a écrite. */
const cleNuit = (ligne: unknown): string => cleLibelle(ligne).replace(/^\d+\s+nuits?\b/, '# nuit');

/* « Le plus long » se mesure en NUITS d'abord, en jours ensuite — pas l'inverse.
   La démonstration de la règle ② (nuits(B) ≤ nuits(A) pour tout B) le suppose,
   et le catalogue le fait sentir : la blépharoplastie supérieure est à
   1 jour / 1 nuit (dictée de Veys) quand Allurion est à 1 jour / 0 nuit. À
   égalité de jours, prendre Allurion pour le plus long donnait un séjour de
   0 nuit et 1 nuit de clinique à loger — un hôtel à −1. Mesuré par le banc
   des paires, pas raisonné. -1 quand le catalogue ne porte rien. */
const rangDuree = (m: Modele): [number, number] => [m.dureeNuits ?? -1, m.dureeJours ?? -1];
const plusLongQue = (a: Modele, b: Modele): boolean => {
  const [na, ja] = rangDuree(a);
  const [nb, jb] = rangDuree(b);
  return na > nb || (na === nb && ja > jb);
};

/* Le plus long des actes résolus. Ex æquo : le PREMIER du devis garde la main —
   ajouter un second acte de même durée ne fait pas basculer le séjour. Aucune
   durée nulle part → aucun acte ne fait foi. */
export function acteLePlusLong(actes: Modele[]): Modele | undefined {
  let meilleur: Modele | undefined;
  for (const m of actes) {
    if (rangDuree(m)[0] < 0 && rangDuree(m)[1] < 0) continue;
    if (!meilleur || plusLongQue(m, meilleur)) meilleur = m;
  }
  return meilleur;
}

const lignesNuit = (m: Modele, nature: NatureLigne): string[] =>
  (m.inc || []).filter((l) => natureLigne(l) === nature);

const maxNuits = (m: Modele, nature: NatureLigne): number | null => {
  let max: number | null = null;
  for (const l of lignesNuit(m, nature)) {
    const n = nombreDeNuits(l);
    if (n !== null && (max === null || n > max)) max = n;
  }
  return max;
};

/** Nuits de clinique qu'une ligne du catalogue réclame ; null si elle n'en dit rien. */
export const cliniqueDe = (m: Modele): number | null => maxNuits(m, 'clinique');
/** Nuits d'hôtel qu'une ligne du catalogue promet ; null si elle n'en dit rien. */
export const hotelDe = (m: Modele): number | null => maxNuits(m, 'hotel');

/* ---- LE CONTRÔLE PERMANENT — ce qui rend la règle ② sûre ----

   Pour tout acte B, clinique(B) ≤ nuits(B) ; et nuits(B) ≤ nuits(A) par
   définition de A comme le plus long ; donc max(clinique) ≤ nuits(A) et le
   reste d'hôtel n'est jamais négatif. La première inégalité est une propriété
   de la DONNÉE, pas du code : elle cesse d'être vraie le jour où une ligne du
   catalogue promet plus de nuits de clinique qu'elle n'a de nuits. D'où ce
   contrôle, relu à chaque chargement (la Bibliothèque l'affiche) et rejoué par
   la recette — jamais « vérifié une fois ». Il dit aussi ce qu'un filtre
   d'écriture aurait pu rater : une ligne sans durée qui promet des nuits
   (le cas alopécie du 22 août), un nombre qui manque. */
export function verifierSejours(modeles: Modele[]): string[] {
  const out: string[] = [];
  for (const m of modeles) {
    const promises = [...lignesNuit(m, 'clinique'), ...lignesNuit(m, 'hotel')];
    const sansNombre = promises.filter((l) => nombreDeNuits(l) === null);
    if (sansNombre.length) out.push(`${m.nom} : ligne de nuits sans nombre — « ${sansNombre.join(' », « ')} »`);
    if (m.dureeNuits === null) {
      if (promises.length) out.push(`${m.nom} : sans durée au catalogue, mais promet « ${promises.join(' », « ')} »`);
      continue;
    }
    const c = cliniqueDe(m) ?? 0;
    const h = hotelDe(m) ?? 0;
    if (c > m.dureeNuits) out.push(`${m.nom} : ${c} nuit(s) de clinique pour un séjour de ${m.dureeNuits} nuit(s)`);
    if (c + h !== m.dureeNuits) out.push(`${m.nom} : clinique ${c} + hôtel ${h} ≠ ${m.dureeNuits} nuit(s) de séjour`);
  }
  return out;
}

export interface PlanNuits {
  /** L'acte le plus long : il donne le séjour, et la ligne d'hôtel à renuméroter. */
  de: Modele;
  sejour: number;
  clinique: number;
  hotel: number;
  /** Les lignes à écrire — absentes quand le séjour n'en compte pas. */
  ligneClinique?: string;
  ligneHotel?: string;
  /** Ce qui a empêché de calculer : on reprend alors les nuits du plus long telles quelles, et on le dit. */
  incoherences: string[];
}

/* La règle ② en code. Le porteur de la ligne de clinique est l'acte qui
   réclame le maximum — sa ligne part MOT POUR MOT (« 2 nuits en clinique » de
   la sleeve) ; la ligne d'hôtel est celle du plus long, renumérotée au reste.
   Quand le calcul est impossible (pas de nombre de nuits, ou une donnée qui
   viole l'invariant), on ne devine pas : les nuits du plus long, telles
   quelles, et une incohérence à afficher. */
export function planifierNuits(actes: Modele[]): PlanNuits | undefined {
  const de = acteLePlusLong(actes);
  if (!de) return undefined;
  const incoherences: string[] = [];
  const tellesQuelles = (): PlanNuits => ({
    de, sejour: de.dureeNuits ?? 0, clinique: cliniqueDe(de) ?? 0, hotel: hotelDe(de) ?? 0,
    ligneClinique: lignesNuit(de, 'clinique')[0], ligneHotel: lignesNuit(de, 'hotel')[0], incoherences,
  });
  if (de.dureeNuits === null) {
    incoherences.push(`« ${de.nom} » n'a pas de nombre de nuits au catalogue : ses lignes sont reprises telles quelles`);
    return tellesQuelles();
  }
  const sejour = de.dureeNuits;
  let clinique = 0;
  let porteur: Modele | undefined;
  for (const m of [de, ...actes.filter((x) => x !== de)]) {
    const c = cliniqueDe(m);
    if (c === null) continue;
    if (m.dureeNuits !== null && c > m.dureeNuits) {
      incoherences.push(`« ${m.nom} » promet ${c} nuit(s) de clinique pour un séjour de ${m.dureeNuits} nuit(s)`);
    }
    if (c > clinique) { clinique = c; porteur = m; }
  }
  const hotel = sejour - clinique;
  if (hotel < 0) {
    incoherences.push(`${clinique} nuit(s) de clinique dépassent le séjour de ${sejour} nuit(s) : nuits de « ${de.nom} » reprises telles quelles`);
    return tellesQuelles();
  }
  const ligneClinique = porteur ? lignesNuit(porteur, 'clinique').find((l) => nombreDeNuits(l) === clinique) : undefined;
  const modeleHotel = lignesNuit(de, 'hotel')[0];
  const ligneHotel = modeleHotel && hotel > 0 ? renumeroter(modeleHotel, hotel) : undefined;
  if (!modeleHotel && hotel > 0) {
    incoherences.push(`le séjour laisse ${hotel} nuit(s) d'hôtel, mais « ${de.nom} » n'en porte aucune ligne au catalogue`);
  }
  return { de, sejour, clinique, hotel, ligneClinique, ligneHotel, incoherences };
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
  /** L'acte qui donne le séjour — absent quand aucun acte résolu ne porte de durée. */
  nuitsDe?: Modele;
  /** Le séjour calculé (règle ②), absent sans durée. */
  nuits?: PlanNuits;
  /** Ce qui a été fait, pour le DIRE à l'écran — jamais pour décider. */
  ajoutees: string[];
  remplacees: { avant: string; apres: string }[];
  /** Ce que la règle aurait écrit mais qu'une main avait déjà écrit autrement : laissé, et dit. */
  laissees: string[];
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
  const nuits = planifierNuits(actes);
  const nuitsDe = nuits?.de;
  /* L'acte qui donne l'ORDRE des lignes : celui du séjour s'il existe, sinon celui qu'on vient de choisir. */
  const principal = nuitsDe || nouveau;
  const ordonnes = [principal, ...actes.filter((m) => m !== principal)];

  /* Vocabulaire « du système » pour les nuits : ce qu'il a pu écrire lui-même —
     nombre effacé, puisqu'il le calcule — donc ce qu'il peut remplacer. */
  const vocabulaireNuits = new Set<string>(
    [...contexte.defauts.inc, ...contexte.modeles.flatMap((m) => m.inc || [])]
      .filter((l) => natureLigne(l) !== 'service')
      .map(cleNuit),
  );
  const ajoutees: string[] = [];
  const remplacees: { avant: string; apres: string }[] = [];
  const laissees: string[] = [];

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
  /* ② — la ligne de nuits calculée prend la place d'une nuit de même nature
     écrite par le système, jamais celle d'une main : celle-là reste, et on le dit. */
  const placerNuit = (voulue: string) => {
    const nature = natureLigne(voulue);
    const i = inc.findIndex((l) => natureLigne(l) === nature);
    if (i < 0) { ajouter(inc, presentes, voulue); return; }
    const avant = inc[i];
    if (cleLibelle(avant) === cleLibelle(voulue)) return;
    if (!vocabulaireNuits.has(cleNuit(avant))) {
      laissees.push(`« ${avant} » est écrite à la main : conservée (le séjour dirait « ${voulue} »)`);
      return;
    }
    inc[i] = voulue;
    presentes.delete(cleLibelle(avant));
    presentes.add(cleLibelle(voulue));
    remplacees.push({ avant, apres: voulue });
  };
  const voulues: Partial<Record<NatureLigne, string>> = {
    clinique: nuits?.ligneClinique, hotel: nuits?.ligneHotel,
  };
  const placees = new Set<NatureLigne>();
  for (const m of ordonnes) {
    for (const ligne of m.inc || []) {
      const nature = natureLigne(ligne);
      if (nature === 'service') { ajouter(inc, presentes, ligne); continue; }
      /* Une nuit ne se recopie jamais d'un acte : elle se CALCULE (règle ②), et
         se pose à l'endroit où le plus long la met. Sans séjour, aucune nuit. */
      if (m !== principal || placees.has(nature)) continue;
      const voulue = voulues[nature];
      if (voulue) placerNuit(voulue);
      placees.add(nature);
    }
  }
  /* Le séjour peut réclamer une nuit que le plus long n'annonce pas à cet
     endroit (sa clinique vient d'un autre acte) : elle se pose à la fin. */
  for (const nature of ['clinique', 'hotel'] as const) {
    const voulue = voulues[nature];
    if (voulue && !placees.has(nature)) placerNuit(voulue);
  }

  /* ---- non incluses : union, sans doublon, jamais de retrait ---- */
  const viergeExc = !clesDe(courant.exc).length || memeListe(courant.exc, contexte.defauts.exc);
  const exc: string[] = viergeExc ? [] : [...(courant.exc || [])];
  const presentesExc = new Set(clesDe(exc));
  for (const m of ordonnes) for (const ligne of m.exc || []) ajouter(exc, presentesExc, ligne);

  return { inc, exc, nuitsDe, nuits, ajoutees, remplacees, laissees };
}
