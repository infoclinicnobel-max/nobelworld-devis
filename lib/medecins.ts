/* Chirurgiens du CRM — table `medecins`, lecture seule — et leur rattachement
   à un document.

   Un document porte DEUX champs. `chirurgien` est le texte qui s'imprime sur
   le PDF : intact sur les 25 devis et 15 factures émis avant le 23/08/2026,
   dont les patientes détiennent une copie. `medecinId` est la référence vers
   `medecins.id`, posée à côté ce jour-là — c'est elle, et jamais le texte,
   que lit la règle tarifaire par chirurgien (lib/catalogue.ts).

   Le texte ne se déduit jamais de la référence à la lecture : il ne change
   que par le geste de choisir, ici.

   ⚠ DETTE notée le 23 août (arbitrage ③), hors de ce lot : la saisie libre
   ne subsiste que si la table est ILLISIBLE. Table lisible mais chirurgien
   ABSENT — un praticien qui arrive (le Dr Uyanık, deux jours avant) est
   innommable tant que `medecins` ne le porte pas, et l'application n'écrit
   jamais cette table. À traiter à part, pas ici. */

import type { DocRecord, Medecin } from './types';

/** Proposé en tête de liste : le chirurgien de 18 devis sur 25. Jamais pré-rempli. */
export const MEDECIN_EN_TETE = 'med_anvar_ahmedov';

/** Ordre de la liste de l'éditeur — Dr Ahmedov d'abord, puis l'ordre alphabétique. */
export function ordonnerMedecins(medecins: Medecin[]): Medecin[] {
  return [...medecins].sort((a, b) => {
    if (a.id === MEDECIN_EN_TETE) return -1;
    if (b.id === MEDECIN_EN_TETE) return 1;
    return a.nomAffiche.localeCompare(b.nomAffiche, 'fr');
  });
}

/** Rattache un chirurgien au document, ou le détache (identifiant vide). Le
    texte imprimé suit le libellé canonique du CRM ; un identifiant absent de
    la liste est refusé et ne change rien. */
export function choisirMedecin(d: DocRecord, id: string, medecins: Medecin[]): DocRecord {
  const cle = String(id || '').trim();
  if (!cle) return { ...d, medecinId: '', chirurgien: '' };
  const m = medecins.find((x) => x.id === cle);
  if (!m) return d;
  return { ...d, medecinId: m.id, chirurgien: m.nomAffiche };
}
