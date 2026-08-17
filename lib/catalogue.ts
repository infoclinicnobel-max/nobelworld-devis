/* Groupement et recherche du catalogue — SOURCE UNIQUE.

   Les deux listes « Appliquer un modèle » (actes et options) passent par ici :
   une seule règle de groupement, un seul tri, une seule recherche. Dupliquer
   ces règles ailleurs les ferait diverger au premier ajout au catalogue.

   Aucune saisie n'est nécessaire : les colonnes `categorie` et `sous_categorie`
   du CRM sont déjà remplies. Rien n'est écrit au catalogue, jamais. */

import { safeLower } from './format';
import type { Modele } from './types';

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

/* La recherche porte sur le libellé ET sur les synonymes du CRM : c'est ce qui
   permet de trouver « liposuccion 360 + BBL » quand la ligne s'appelle
   « SAFE BBL + Liposuccion Vaser HD 360° ». Chaque mot saisi doit être présent
   quelque part — l'ordre des mots n'a donc aucune importance. */
export function filtrerModeles(modeles: Modele[], recherche: string): Modele[] {
  const mots = safeLower(recherche).split(/\s+/).filter(Boolean);
  if (!mots.length) return modeles;
  return modeles.filter((m) => {
    const foin = safeLower([m.nom, m.categorie, m.sousCategorie, ...(m.synonymes || [])].join(' '));
    return mots.every((mot) => foin.includes(mot));
  });
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
