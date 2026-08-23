/* Groupement et recherche du catalogue — SOURCE UNIQUE.

   Les deux listes « Appliquer un modèle » (actes et options) passent par ici :
   une seule règle de groupement, un seul tri, une seule recherche. Dupliquer
   ces règles ailleurs les ferait diverger au premier ajout au catalogue.

   Aucune saisie n'est nécessaire : les colonnes `categorie` et `sous_categorie`
   du CRM sont déjà remplies. Rien n'est écrit au catalogue, jamais. */

import { safeLower } from './format';
import type { Acte, DocRecord, Modele } from './types';

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

/* ------------------------------------------------- tarifs par chirurgien

   Règle de Veys, 23 août : les actes esthétiques du Dr Azar Zeynalov sont
   majorés de 35 % — hors bariatrique, hors capillaire (et hors dentaire). La
   paire du catalogue est majorée, promo ET standard quand il existe ; le
   devis prend le promo majoré ; les options aussi (zone de liposuccion
   500 → 675). Lue sur `medecinId` — la référence — jamais sur le texte.

   Le catalogue n'est PAS écrit : la majoration se calcule ici, au geste
   d'appliquer, et se fige dans le document comme n'importe quel tarif — un
   devis envoyé ne relit rien (lib/calc.ts). Elle n'apparaît sur aucun
   document : la patiente voit 4 455 €, pas 3 300 € + 35 %. Elle ne vaut que
   pour un devis NEUF ; les 25 devis d'avant gardent leurs montants. */

export const MAJORATIONS: Readonly<Record<string, number>> = { med_azar_zeynalov: 0.35 };

/* Périmètre : toute l'esthétique, plus la zone de liposuccion supplémentaire
   — seule ligne de la catégorie « supplement » au 23 août, et un acte
   esthétique par nature. Une autre ligne « supplement » qui apparaîtrait au
   catalogue ne serait PAS majorée sans décision. */
export function estMajorable(m: Pick<Modele, 'id' | 'categorie'>): boolean {
  return m.categorie === 'esthetique' || m.id === 'sup-zone-liposuccion';
}

export function tauxMajoration(m: Pick<Modele, 'id' | 'categorie'>, medecinId?: string): number {
  const taux = MAJORATIONS[String(medecinId || '')] || 0;
  return taux && estMajorable(m) ? taux : 0;
}

export interface TarifsMedecin {
  promo: number;
  standard: number | null;
  taux: number;
}

/** La paire de tarifs d'une ligne pour un chirurgien, arrondie à l'euro.
    Sans chirurgien, ou hors périmètre : la paire du catalogue telle quelle.
    Un standard absent reste absent (dix lignes esthétiques n'en ont pas). */
export function tarifsPourMedecin(m: Modele, medecinId?: string): TarifsMedecin {
  const taux = tauxMajoration(m, medecinId);
  const majorer = (p: number) => Math.round(p * (1 + taux));
  return {
    promo: taux ? majorer(m.prixBase) : m.prixBase,
    standard: m.prixStandard == null ? null : taux ? majorer(m.prixStandard) : m.prixStandard,
    taux,
  };
}

/** Ce que le document garde de la règle en vigueur pour son chirurgien — gelé
    à l'enregistrement (lib/mappers.ts), jamais rendu. `undefined` sans règle. */
export function traceMajoration(medecinId?: string): DocRecord['majoration'] {
  const taux = MAJORATIONS[String(medecinId || '')] || 0;
  return taux ? { medecinId: String(medecinId), taux } : undefined;
}

/* Au changement de chirurgien sur un devis NEUF : un montant encore au prix
   système — celui que le geste d'appliquer avait posé pour l'ancien
   chirurgien — passe au prix système du nouveau. Un montant saisi à la main,
   différent du prix système, n'est JAMAIS touché ; une ligne sans modèle
   reconnu (forfait sans modeleId, option hors catalogue) non plus. Les
   options se reconnaissent à leur libellé, comme la pastille de l'éditeur.
   Un prix saisi à la main qui vaudrait par coïncidence le prix système est
   réajusté aussi : c'est la limite, nommée, de ce qu'un montant peut dire. */
export function reajusterPrixSysteme(
  d: DocRecord, ancienId: string, nouveauId: string, modeles: Modele[],
): DocRecord {
  const avant = (m: Modele) => tarifsPourMedecin(m, ancienId).promo;
  const apres = (m: Modele) => tarifsPourMedecin(m, nouveauId).promo;
  const out: DocRecord = { ...d, majoration: traceMajoration(nouveauId) };
  const modele = d.modeleId ? modeles.find((m) => m.id === d.modeleId) : undefined;
  if (modele && Number(d.forfait) === avant(modele)) out.forfait = apres(modele);
  if (Array.isArray(d.options)) {
    out.options = d.options.map((o) => {
      const cle = cleLibelle(o.nom);
      const m = cle ? modeles.find((x) => cleLibelle(x.nom) === cle) : undefined;
      return m && Number(o.prix) === avant(m) ? { ...o, prix: apres(m) } : o;
    });
  }
  return out;
}
