/* Recette de la majoration par chirurgien — 23 août.

   Règle de Veys : les actes esthétiques du Dr Azar Zeynalov sont majorés de
   35 % — hors bariatrique, hors capillaire (et hors dentaire). La paire du
   catalogue est majorée (promo ET standard quand il existe) ; le devis prend
   le promo majoré ; les options aussi (zone de liposuccion 500 → 675). Le
   catalogue n'est JAMAIS écrit : la majoration se calcule au geste, se fige
   dans le document comme un tarif, et ne se relit plus (lib/calc.ts ignore
   tout de la règle). Elle n'apparaît sur aucun document : la patiente voit
   4 455 €, pas 3 300 € + 35 %.

   Quatre gardes, toutes ici :
   · devis NEUF seulement — un devis déjà en base garde ses montants ;
   · un montant saisi à la main n'est jamais écrasé — le réajustement au
     changement de chirurgien ne touche qu'un montant encore au prix système ;
   · duplication et conversion en facture reprennent les montants tels quels
     (elles ne passent par aucun geste tarifaire) ;
   · `contenu.majoration` est gelé à l'enregistrement et jamais rendu.

   Les lignes du catalogue sont les lignes RÉELLES relevées le 23 août. Un
   banc éprouve un mécanisme ; il ne décrit pas le catalogue, qui bouge.

   Usage : npx tsx scripts/recette-majoration-chirurgien.ts */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  estMajorable, MAJORATIONS, reajusterPrixSysteme, tarifsPourMedecin, traceMajoration,
} from '../lib/catalogue';
import { devisToRow, rowToDevis, rowToModele } from '../lib/mappers';
import type { DocRecord, Modele } from '../lib/types';

const r: [string, boolean][] = [];
const v = (nom: string, ok: boolean, detail = '') => {
  r.push([nom, ok]);
  console.log(`  ${ok ? '✓' : '✗'} ${nom}${detail ? ' — ' + detail : ''}`);
};
const AUTEUR = 'Veys Turan';
const ZEY = 'med_azar_zeynalov';
const AHM = 'med_anvar_ahmedov';
const UYA = 'med_orkun_uyanik';

/* ---- lignes réelles de catalogue_interventions, 23 août ---- */
const ligneCat = (o: Record<string, unknown>) =>
  rowToModele({ sous_categorie: null, tarif_standard_eur: null, tarif_sur_devis: false, actif: true, ...o });
const VASER = ligneCat({ id: 'alc-lipo-vaser-360-seule', libelle_fr: 'Liposuccion Vaser 360 seule (sans BBL ni abdominoplastie)', categorie: 'esthetique', sous_categorie: 'corps', tarif_promo_eur: '3300.00', tarif_standard_eur: '3500.00' });
const ZONE = ligneCat({ id: 'sup-zone-liposuccion', libelle_fr: 'Zone de liposuccion supplémentaire', categorie: 'supplement', tarif_promo_eur: '500.00' });
const SLEEVE = ligneCat({ id: 'pkg-sleeve-gastrectomie', libelle_fr: 'Sleeve gastrectomie', categorie: 'bariatrique', tarif_promo_eur: '3200.00', tarif_standard_eur: '3500.00' });
const DHI = ligneCat({ id: 'cap-dhi-fue-femme-sapphire', libelle_fr: 'DHI & FUE femme Sapphire', categorie: 'capillaire', tarif_promo_eur: '2400.00', tarif_standard_eur: '2700.00' });
const ALLON4 = ligneCat({ id: 'dent-all-on-4', libelle_fr: 'All-on-4', categorie: 'dentaire', tarif_promo_eur: '4800.00', tarif_standard_eur: '5100.00' });
const COMBO59 = ligneCat({ id: 'combo-59', libelle_fr: 'Abdominoplastie + Liposuccion 360° + Lifting mammaire', categorie: 'esthetique', tarif_promo_eur: '6200.00' });
const JPLASMA = ligneCat({ id: 'alc-j-plasma-renuvion', libelle_fr: 'J-Plasma / Renuvion (raffermissement cutané)', categorie: 'esthetique', sous_categorie: 'corps', tarif_promo_eur: '2000.00' });
const SURDEVIS = ligneCat({ id: 'banc-sur-devis', libelle_fr: 'Ligne sur devis', categorie: 'esthetique', tarif_promo_eur: null, tarif_sur_devis: true });
const IMPAIR = ligneCat({ id: 'banc-impair', libelle_fr: 'Ligne à 2 499', categorie: 'esthetique', tarif_promo_eur: '2499.00' });
const MODELES: Modele[] = [VASER, ZONE, SLEEVE, DHI, ALLON4, COMBO59, JPLASMA, SURDEVIS, IMPAIR];

console.log('\n— 1. La règle : la paire du catalogue, majorée pour Zeynalov et pour lui seul —');
{
  v('la table des majorations ne porte que Zeynalov, à 35 %',
    Object.keys(MAJORATIONS).join() === ZEY && MAJORATIONS[ZEY] === 0.35);
  const z = tarifsPourMedecin(VASER, ZEY);
  v('lipo Vaser 360 · Zeynalov : promo 3 300 → 4 455', z.promo === 4455, String(z.promo));
  v('…et le standard 3 500 → 4 725', z.standard === 4725, String(z.standard));
  v('…taux porté : 0,35', z.taux === 0.35);
  const a = tarifsPourMedecin(VASER, AHM);
  v('lipo Vaser 360 · Ahmedov : 3 300 / 3 500, inchangé', a.promo === 3300 && a.standard === 3500 && a.taux === 0);
  const s = tarifsPourMedecin(VASER, '');
  v('sans chirurgien : inchangé', s.promo === 3300 && s.standard === 3500 && s.taux === 0);
  v('chirurgien absent (undefined) : inchangé', tarifsPourMedecin(VASER).promo === 3300);
  const u = tarifsPourMedecin(VASER, UYA);
  v('Uyanik (esthétique, hors règle) : inchangé', u.promo === 3300 && u.taux === 0);
  const zone = tarifsPourMedecin(ZONE, ZEY);
  v('zone de liposuccion (catégorie supplement) · Zeynalov : 500 → 675', zone.promo === 675);
  v('…son standard absent reste absent', zone.standard === null);
  v('sleeve (bariatrique) · Zeynalov : inchangé', tarifsPourMedecin(SLEEVE, ZEY).promo === 3200 && tarifsPourMedecin(SLEEVE, ZEY).taux === 0);
  v('DHI (capillaire) · Zeynalov : inchangé', tarifsPourMedecin(DHI, ZEY).promo === 2400);
  v('All-on-4 (dentaire) · Zeynalov : inchangé', tarifsPourMedecin(ALLON4, ZEY).promo === 4800);
  const c = tarifsPourMedecin(COMBO59, ZEY);
  v('combo sans prix standard · Zeynalov : promo 6 200 → 8 370, standard reste absent', c.promo === 8370 && c.standard === null);
  v('J-Plasma (esthétique corps, sans standard) : 2 000 → 2 700', tarifsPourMedecin(JPLASMA, ZEY).promo === 2700);
  v('ligne sur devis : 0 reste 0', tarifsPourMedecin(SURDEVIS, ZEY).promo === 0);
  v('arrondi à l’euro : 2 499 × 1,35 = 3 373,65 → 3 374', tarifsPourMedecin(IMPAIR, ZEY).promo === 3374);
  v('le modèle n’est pas muté', VASER.prixBase === 3300 && VASER.prixStandard === 3500);
  v('périmètre : esthétique + la zone de liposuccion, rien d’autre',
    estMajorable(VASER) && estMajorable(COMBO59) && estMajorable(ZONE)
      && !estMajorable(SLEEVE) && !estMajorable(DHI) && !estMajorable(ALLON4));
}

console.log('\n— 2. Le document garde la trace de la règle, gelée, jamais rendue —');
{
  v('trace pour Zeynalov', JSON.stringify(traceMajoration(ZEY)) === JSON.stringify({ medecinId: ZEY, taux: 0.35 }));
  v('aucune trace pour Ahmedov, ni sans chirurgien', traceMajoration(AHM) === undefined && traceMajoration('') === undefined);

  const neuf: DocRecord = { forfait: 4455, medecinId: ZEY, chirurgien: 'Dr Azar Zeynalov', actes: [], majoration: traceMajoration(ZEY) };
  const wn = devisToRow(neuf, AUTEUR) as { contenu: Record<string, unknown>; forfait: number; medecin_id: string };
  v('devis neuf : la trace part dans contenu, le forfait est le montant majoré, medecin_id posé',
    JSON.stringify(wn.contenu.majoration) === JSON.stringify({ medecinId: ZEY, taux: 0.35 }) && wn.forfait === 4455 && wn.medecin_id === ZEY);
  const sans = devisToRow({ forfait: 3300, medecinId: AHM, actes: [] } as DocRecord, AUTEUR) as { contenu: Record<string, unknown> };
  v('devis neuf sans règle : pas de clé majoration du tout', !('majoration' in sans.contenu));
  const sansCle = devisToRow({ forfait: 3300, medecinId: AHM, actes: [], majoration: undefined } as DocRecord, AUTEUR) as { contenu: Record<string, unknown> };
  v('…même quand la clé vaut undefined dans le formulaire', !('majoration' in sansCle.contenu));

  /* Document EXISTANT : la clé gelée n'est ni créée ni modifiée. */
  const rowAncien = {
    id: 'dev_ancien', numero: 'D-2026-000011', patient_id: 'p', date: '2026-06-28', chirurgien: 'Dr Azar Zeynalov',
    medecin_id: ZEY, statut: 'accepte', devise: 'EUR', acompte: 500, forfait: 4000, remise_type: null,
    remise_valeur: 0, remise_motif: null, contenu: { actes: [{ id: 'a1', acte: 'Lipo', inclus: '' }], promoJours: 15 },
    cree_par: AUTEUR, created_at: 'x', updated_at: 'x',
  };
  const ancien = rowToDevis(rowAncien);
  const wa = devisToRow({ ...ancien, majoration: traceMajoration(ZEY) }, AUTEUR) as { contenu: Record<string, unknown>; forfait: number };
  v('devis existant : une trace posée par le formulaire n’est PAS créée en base (clé gelée)', !('majoration' in wa.contenu));
  v('…et son forfait de 4 000 € (D-2026-000011, Zeynalov) reste 4 000 €', wa.forfait === 4000);
  const rowTrace = { ...rowAncien, contenu: { ...rowAncien.contenu, majoration: { medecinId: ZEY, taux: 0.35 } } };
  const wt = devisToRow({ ...rowToDevis(rowTrace), majoration: { medecinId: AHM, taux: 0.5 } }, AUTEUR) as { contenu: Record<string, unknown> };
  v('devis existant : une trace stockée n’est pas modifiée par le formulaire',
    JSON.stringify(wt.contenu.majoration) === JSON.stringify({ medecinId: ZEY, taux: 0.35 }));
}

console.log('\n— 3. Le réajustement au changement de chirurgien — devis neuf, prix système seulement —');
{
  const neuf: DocRecord = {
    modeleId: VASER.id, forfait: 3300, medecinId: '', chirurgien: '', actes: [],
    options: [
      { id: 'o1', nom: 'Zone de liposuccion supplémentaire', prix: 500, qty: 1, retenue: false },
      { id: 'o2', nom: 'Nuit supplémentaire', prix: 150, qty: 1, retenue: false },
      { id: 'o3', nom: 'zone de liposuccion supplémentaire', prix: 450, qty: 1, retenue: true },
    ],
  };
  const z = reajusterPrixSysteme(neuf, '', ZEY, MODELES);
  v('forfait au prix système 3 300 → 4 455 en passant à Zeynalov', z.forfait === 4455, String(z.forfait));
  v('option zone au prix système 500 → 675', z.options![0].prix === 675);
  v('option hors catalogue (nuit) : intacte', z.options![1].prix === 150);
  v('option zone saisie à la main (450, casse différente) : JAMAIS écrasée', z.options![2].prix === 450);
  v('les autres attributs des options ne bougent pas', z.options![0].retenue === false && z.options![2].retenue === true && z.options![0].id === 'o1');
  v('la trace suit le chirurgien', JSON.stringify(z.majoration) === JSON.stringify({ medecinId: ZEY, taux: 0.35 }));
  v('le document de départ n’est pas muté', neuf.forfait === 3300 && neuf.options![0].prix === 500 && neuf.majoration === undefined);

  const retour = reajusterPrixSysteme(z, ZEY, '', MODELES);
  v('retour à « À confirmer » : 4 455 → 3 300, 675 → 500', retour.forfait === 3300 && retour.options![0].prix === 500);
  v('…la main (450) et le hors catalogue (150) toujours intacts', retour.options![2].prix === 450 && retour.options![1].prix === 150);
  v('…et la trace disparaît', retour.majoration === undefined);

  const versAhmedov = reajusterPrixSysteme(z, ZEY, AHM, MODELES);
  v('Zeynalov → Ahmedov : le prix système majoré redevient le prix catalogue', versAhmedov.forfait === 3300 && versAhmedov.options![0].prix === 500);

  const main = reajusterPrixSysteme({ ...neuf, forfait: 3500 }, '', ZEY, MODELES);
  v('forfait saisi à la main (3 500 ≠ prix système) : JAMAIS écrasé', main.forfait === 3500);
  const zero = reajusterPrixSysteme({ ...neuf, forfait: 0 }, '', ZEY, MODELES);
  v('forfait à 0 (aucun modèle appliqué) : reste 0', zero.forfait === 0);
  const inconnu = reajusterPrixSysteme({ ...neuf, modeleId: 'modele-retire' }, '', ZEY, MODELES);
  v('modèle introuvable (ligne retirée du catalogue) : le forfait ne bouge pas', inconnu.forfait === 3300);
  const sansModele = reajusterPrixSysteme({ ...neuf, modeleId: '' }, '', ZEY, MODELES);
  v('sans modèle : le forfait ne bouge pas, les options catalogue si', sansModele.forfait === 3300 && sansModele.options![0].prix === 675);
  const ahmVersUya = reajusterPrixSysteme({ ...neuf, medecinId: AHM }, AHM, UYA, MODELES);
  v('Ahmedov → Uyanik (tous deux hors règle) : rien ne change', ahmVersUya.forfait === 3300 && ahmVersUya.options![0].prix === 500 && ahmVersUya.majoration === undefined);
  const sansOptions = reajusterPrixSysteme({ modeleId: VASER.id, forfait: 3300 }, '', ZEY, MODELES);
  v('sans tableau d’options : pas d’erreur, pas d’options inventées', sansOptions.forfait === 4455 && sansOptions.options === undefined);
}

console.log('\n— 4. Gardes de source : rien sur le document, rien dans le calcul, la règle aux trois écrans —');
{
  const racine = fileURLToPath(new URL('..', import.meta.url));
  const src = (f: string) => readFileSync(racine + f, 'utf8');
  v('components/DevisDoc.tsx ne connaît ni la majoration ni la règle (aucune ligne sur le PDF)',
    !/majoration|tarifsPourMedecin|MAJORATIONS/.test(src('components/DevisDoc.tsx')));
  /* Le mot « catalogue » figure dans la doctrine en tête de calc.ts (« rien
     ici ne relit le catalogue ») : la garde vise le code, pas la prose. */
  v('lib/calc.ts ne relit rien de la règle (un devis envoyé reste figé)',
    !/majoration|tarifsPourMedecin|MAJORATIONS|from '\.\/catalogue'/.test(src('lib/calc.ts')));
  v('le sélecteur, la Bibliothèque et l’éditeur de devis passent par tarifsPourMedecin',
    ['components/SelecteurModele.tsx', 'components/Bibliotheque.tsx', 'components/Devis.tsx']
      .every((f) => src(f).includes('tarifsPourMedecin(')));
  v('l’éditeur de devis réserve la règle au devis neuf (isEdit)', /isEdit \? '' :/.test(src('components/Devis.tsx')));
  v('la duplication et la conversion en facture ne passent par aucun geste tarifaire',
    !/reajusterPrixSysteme|tarifsPourMedecin/.test(src('components/Devis.tsx').split('const duplicate')[1].split('export function')[0]));
  v('l’éditeur de facture ne réajuste jamais', !/reajusterPrixSysteme|tarifsPourMedecin/.test(src('components/Factures.tsx')));
}

/* ---- bilan ---- */
const ko = r.filter(([, ok]) => !ok);
console.log(`\n${ko.length ? '✗' : '✓'} ${r.length - ko.length}/${r.length} contrôles passés`);
if (ko.length) {
  console.log('Échecs :\n' + ko.map(([n]) => '  - ' + n).join('\n'));
  process.exit(1);
}
