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
   · un montant saisi à la main n'est jamais écrasé — au changement de
     chirurgien, seul un montant encore égal à ce que le SYSTÈME a posé (la
     mémoire `_systeme` de l'éditeur, jamais enregistrée) suit le nouveau
     chirurgien ; reconnaître un prix système par égalité avec un tarif du
     catalogue se trompait dans les deux sens (vérification adverse du 23/08,
     1 155 € d'écart : 4 455 saisi à la main, ou 3 300 d'un premier modèle
     gardé sous le modeleId d'un second) ;
   · duplication et conversion en facture reprennent les montants tels quels
     (elles ne passent par aucun geste tarifaire, et n'ont pas de mémoire) ;
   · `contenu.majoration` est gelé à l'enregistrement et jamais rendu.

   Les lignes du catalogue sont les lignes RÉELLES relevées le 23 août. Un
   banc éprouve un mécanisme ; il ne décrit pas le catalogue, qui bouge.

   Usage : npx tsx scripts/recette-majoration-chirurgien.ts */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  estMajorable, forfaitPoseParLeSysteme, MAJORATIONS, mentionForfait, reajusterPrixSysteme,
  retenirForfaitSysteme, retenirOptionSysteme, tarifsPourMedecin, tauxMajoration, traceMajoration,
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
  /* Vérification adverse du 23/08 : MAJORATIONS[id] || 0 sur une clé du
     prototype rendait une fonction, « truthy », et un tarif NaN. */
  v('une clé du prototype (« constructor », « __proto__ ») ne déclenche rien',
    tauxMajoration(VASER, 'constructor') === 0 && tauxMajoration(VASER, '__proto__') === 0
      && tarifsPourMedecin(VASER, 'constructor').promo === 3300 && traceMajoration('constructor') === undefined);
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
  /* Trou mesuré par la vérification adverse du 23/08 : le gel venait APRÈS le
     saut des valeurs absentes — un formulaire portant la clé à `undefined`
     effaçait la trace stockée. Le gel doit tenir dans le mapper, pas
     seulement par les gardes de l'éditeur. */
  const wu = devisToRow({ ...rowToDevis(rowTrace), majoration: undefined }, AUTEUR) as { contenu: Record<string, unknown> };
  v('devis existant : un formulaire SANS la clé (undefined) n’efface pas la trace stockée',
    JSON.stringify(wu.contenu.majoration) === JSON.stringify({ medecinId: ZEY, taux: 0.35 }));
  const wr = devisToRow(reajusterPrixSysteme(rowToDevis(rowTrace), AHM, MODELES), AUTEUR) as { contenu: Record<string, unknown>; forfait: number };
  v('…même après un reajusterPrixSysteme appelé par erreur sur un existant : trace et forfait stockés conservés',
    JSON.stringify(wr.contenu.majoration) === JSON.stringify({ medecinId: ZEY, taux: 0.35 }) && wr.forfait === 4000);
  const wp = devisToRow({ ...rowToDevis(rowTrace), promoJours: undefined }, AUTEUR) as { contenu: Record<string, unknown> };
  v('promoJours, gelé de la même façon, survit aussi à undefined', wp.contenu.promoJours === 15);
  const wn2 = devisToRow({ forfait: 3300, actes: [], promoJours: undefined, majoration: undefined } as DocRecord, AUTEUR) as { contenu: Record<string, unknown> };
  v('devis NEUF : les clés gelées absentes restent absentes (aucun gel sans ligne stockée)',
    !('majoration' in wn2.contenu) && !('promoJours' in wn2.contenu));
  /* Second trou nommé par la vérification adverse : `contenu` NULL en base
     faisait passer un document existant pour neuf. Aucune des 40 lignes
     réelles n'est dans ce cas (mesuré le 23/08) ; le mécanisme tient quand même. */
  const wNull = devisToRow({ ...rowToDevis({ ...rowAncien, contenu: null }), majoration: traceMajoration(ZEY), bqIban: 'FR76' }, AUTEUR) as { contenu: Record<string, unknown> };
  v('devis existant à contenu NULL : toujours existant — ni trace créée, ni IBAN créé',
    !('majoration' in wNull.contenu) && !('bqIban' in wNull.contenu));
}

console.log('\n— 3. Le réajustement au changement de chirurgien — devis neuf, montants posés par le système seulement —');
{
  /* Le parcours de l'éditeur sur un devis neuf, tel que components/Devis.tsx
     l'enchaîne : modèle appliqué sur un forfait vide (posé et retenu), option
     du catalogue sur une ligne vide (posée et retenue), puis des saisies. */
  let neuf: DocRecord = { modeleId: VASER.id, forfait: 3300, medecinId: '', chirurgien: '', actes: [], options: [] };
  neuf = retenirForfaitSysteme(neuf, VASER, 3300);
  neuf = {
    ...neuf,
    options: [
      { id: 'o1', nom: ZONE.nom, prix: 500, qty: 1, retenue: false },          // posée par le système
      { id: 'o2', nom: 'Nuit supplémentaire', prix: 150, qty: 1, retenue: false }, // hors catalogue, saisie
      { id: 'o3', nom: ZONE.nom, prix: 450, qty: 1, retenue: true },            // même libellé, prix saisi
      { id: 'o4', nom: ZONE.nom, prix: 500, qty: 1, retenue: false },           // même prix, mais SAISI (non retenu)
    ],
  };
  neuf = retenirOptionSysteme(neuf, 'o1', ZONE, 500);

  const z = reajusterPrixSysteme(neuf, ZEY, MODELES);
  v('forfait posé par le système 3 300 → 4 455 en passant à Zeynalov', z.forfait === 4455, String(z.forfait));
  v('option zone posée par le système 500 → 675', z.options![0].prix === 675);
  v('option hors catalogue (nuit) : intacte', z.options![1].prix === 150);
  v('option zone saisie à la main (450) : JAMAIS écrasée', z.options![2].prix === 450);
  v('option zone saisie à la main au MÊME prix que le catalogue (500) : intacte — un montant ne dit pas d’où il vient, la mémoire le dit',
    z.options![3].prix === 500);
  v('les autres attributs des options ne bougent pas', z.options![0].retenue === false && z.options![2].retenue === true && z.options![0].id === 'o1');
  v('la trace suit le chirurgien', JSON.stringify(z.majoration) === JSON.stringify({ medecinId: ZEY, taux: 0.35 }));
  v('la mémoire suit les montants posés', z._systeme!.forfait!.prix === 4455 && z._systeme!.options!.o1.prix === 675);
  v('le document de départ n’est pas muté', neuf.forfait === 3300 && neuf.options![0].prix === 500 && neuf.majoration === undefined && neuf._systeme!.forfait!.prix === 3300);

  const retour = reajusterPrixSysteme(z, '', MODELES);
  v('retour à « À confirmer » : 4 455 → 3 300, 675 → 500', retour.forfait === 3300 && retour.options![0].prix === 500);
  v('…la main (450, 500) et le hors catalogue (150) toujours intacts',
    retour.options![2].prix === 450 && retour.options![3].prix === 500 && retour.options![1].prix === 150);
  v('…et la trace disparaît', retour.majoration === undefined);
  v('Zeynalov → Ahmedov : le montant posé majoré redevient le prix catalogue',
    reajusterPrixSysteme(z, AHM, MODELES).forfait === 3300 && reajusterPrixSysteme(z, AHM, MODELES).options![0].prix === 500);

  /* Vérification adverse du 23/08, cas 1 : 4 455 TAPÉ À LA MAIN (chirurgien
     vide, modèle Vaser) était reconnu comme « prix système Zeynalov » et
     ramené à 3 300 au passage Zeynalov → Ahmedov. */
  const main4455 = reajusterPrixSysteme({ ...neuf, forfait: 4455 }, ZEY, MODELES);
  v('4 455 saisi à la main (≠ posé 3 300) : intact en passant à Zeynalov', main4455.forfait === 4455);
  v('…et intact en passant ensuite à Ahmedov — plus de coïncidence possible', reajusterPrixSysteme(main4455, AHM, MODELES).forfait === 4455);
  /* Cas 2 : deux modèles appliqués de suite — le forfait du premier (3 300,
     Vaser) reste sous le modeleId du second (combo-59). Reconnu par le
     modeleId, il ne bougeait pas (3 300 pour Zeynalov : 1 155 € de moins) ;
     retenu comme « posé pour Vaser », il suit. */
  const deuxModeles = { ...neuf, modeleId: COMBO59.id };
  v('forfait du premier modèle gardé sous le modeleId du second : suit le PREMIER modèle (3 300 → 4 455)',
    reajusterPrixSysteme(deuxModeles, ZEY, MODELES).forfait === 4455);
  /* …et dans l'autre sens : posé 4 455 pour Zeynalov, combo appliqué ensuite, puis Ahmedov. */
  const poseZey = retenirForfaitSysteme({ ...neuf, forfait: 4455, medecinId: ZEY, modeleId: COMBO59.id }, VASER, 4455);
  v('posé 4 455 pour Zeynalov puis combo appliqué par-dessus : Ahmedov ramène bien à 3 300', reajusterPrixSysteme(poseZey, AHM, MODELES).forfait === 3300);

  const main = reajusterPrixSysteme({ ...neuf, forfait: 3500 }, ZEY, MODELES);
  v('forfait saisi à la main (3 500 ≠ posé) : JAMAIS écrasé', main.forfait === 3500);
  const zero = reajusterPrixSysteme({ ...neuf, forfait: 0 }, ZEY, MODELES);
  v('forfait effacé (0) : reste 0', zero.forfait === 0);
  const inconnu = reajusterPrixSysteme({ ...neuf, _systeme: { forfait: { modeleId: 'modele-retire', prix: 3300 } } }, ZEY, MODELES);
  v('modèle posé retiré du catalogue : le forfait ne bouge pas', inconnu.forfait === 3300);
  const sansMemoire = reajusterPrixSysteme({ ...neuf, _systeme: undefined }, ZEY, MODELES);
  v('sans mémoire (document dupliqué, converti, ou sans geste du système) : rien ne bouge',
    sansMemoire.forfait === 3300 && sansMemoire.options![0].prix === 500);
  const ahmVersUya = reajusterPrixSysteme({ ...neuf, medecinId: AHM }, UYA, MODELES);
  v('Ahmedov → Uyanik (tous deux hors règle) : rien ne change', ahmVersUya.forfait === 3300 && ahmVersUya.options![0].prix === 500 && ahmVersUya.majoration === undefined);
  const sansOptions = reajusterPrixSysteme(retenirForfaitSysteme({ modeleId: VASER.id, forfait: 3300 }, VASER, 3300), ZEY, MODELES);
  v('sans tableau d’options : pas d’erreur, pas d’options inventées', sansOptions.forfait === 4455 && sansOptions.options === undefined);

  /* La mémoire ne part JAMAIS en base. */
  const w = devisToRow(z, AUTEUR) as Record<string, unknown>;
  v('_systeme n’est ni une colonne ni une clé de contenu',
    !('_systeme' in w) && !('_systeme' in (w.contenu as Record<string, unknown>)) && !('_row' in w));
  v('…et un document relu de la base n’en a pas', rowToDevis({ id: 'x', contenu: {} })._systeme === undefined);
}

console.log('\n— 3 bis. Arbitrage ④ du 23 août : un forfait que le système n’a pas posé le DIT —');
{
  /* D-2026-000043 tel que relevé en base le 23 août : brouillon, 12 200 € de
     forfait, chirurgien VIDE, medecin_id NULL, cinq actes sous le modèle
     sup-zone-liposuccion, aucune option. Aucune ligne du catalogue ne vaut
     12 200 — ni 12 200 / 1,35 : le montant a été tapé. */
  const d43 = rowToDevis({
    id: 'dev_d43', numero: 'D-2026-000043', statut: 'brouillon', forfait: 12200, chirurgien: '', medecin_id: null,
    contenu: {
      modeleId: 'sup-zone-liposuccion',
      actes: ['Lifting cervicofacial (Deep Plane)', 'Lifting temporal', 'Micro-lipofilling du visage', 'Lip lift', 'Liposuccion 1 zone']
        .map((acte, i) => ({ id: 'a' + i, acte, inclus: '' })),
    },
  });
  v('D-43 relu de la base : aucune mémoire — pour la règle, son forfait vaut « saisi à la main »',
    d43._systeme === undefined && d43.forfait === 12200 && !forfaitPoseParLeSysteme(d43));
  v('choisir Zeynalov sur D-43 ne bouge pas 12 200 : sans mémoire, rien ne suit — avec !id comme avec tout autre critère de nouveauté',
    reajusterPrixSysteme({ ...d43, medecinId: ZEY }, ZEY, MODELES).forfait === 12200);
  v('12 200 n’est le prix d’aucune ligne du banc, majorée ou non',
    !MODELES.some((m) => [m.prixBase, m.prixStandard, tarifsPourMedecin(m, ZEY).promo, tarifsPourMedecin(m, ZEY).standard].includes(12200)));
  const surD43 = mentionForfait({ ...d43, medecinId: ZEY }, true);
  v('mention sur D-43 (en base), Zeynalov choisi : « non majoré — devis déjà en base »',
    /non majoré/.test(surD43) && /déjà en base/.test(surD43), surD43);

  const tape = { forfait: 12200, medecinId: ZEY, actes: [] } as DocRecord;
  const mTape = mentionForfait(tape, false);
  v('devis neuf, 12 200 tapés, Zeynalov : « forfait saisi à la main — non majoré »', mTape.startsWith('forfait saisi à la main — non majoré'), mTape);
  v('…et la mention dit le geste : vider, puis réappliquer l’acte', /videz/.test(mTape) && /réappliquez/.test(mTape));
  const pose = retenirForfaitSysteme({ forfait: 4455, medecinId: ZEY, actes: [] } as DocRecord, VASER, 4455);
  v('forfait posé par le système et encore égal : aucune mention', forfaitPoseParLeSysteme(pose) && mentionForfait(pose, false) === '');
  v('forfait posé puis retouché (4 455 → 4 500) : mention — il n’est plus ce que le système a posé',
    /saisi à la main/.test(mentionForfait({ ...pose, forfait: 4500 }, false)));
  v('Ahmedov (sans taux), 12 200 tapés : aucune mention — rien à majorer', mentionForfait({ ...tape, medecinId: AHM }, false) === '');
  v('forfait vide, Zeynalov : aucune mention — le prochain modèle posera le tarif majoré',
    mentionForfait({ forfait: 0, medecinId: ZEY } as DocRecord, false) === '');
  v('sans chirurgien : aucune mention', mentionForfait({ ...tape, medecinId: '' }, false) === '');
  v('une clé du prototype comme chirurgien : aucune mention', mentionForfait({ ...tape, medecinId: 'constructor' }, false) === '');
}

console.log('\n— 4. Gardes de source : rien sur le document, rien dans le calcul, la règle aux trois écrans —');
{
  const racine = fileURLToPath(new URL('..', import.meta.url));
  const src = (f: string) => readFileSync(racine + f, 'utf8');
  v('components/DevisDoc.tsx ne connaît ni la majoration ni la règle, ni la mention (aucune ligne sur le PDF)',
    !/majoration|tarifsPourMedecin|MAJORATIONS|mentionForfait/.test(src('components/DevisDoc.tsx')));
  v('l’éditeur de devis pose la mention du ④ sous le champ du forfait (mentionForfait)',
    src('components/Devis.tsx').includes('mentionForfait(f, isEdit)'));
  /* Le mot « catalogue » figure dans la doctrine en tête de calc.ts (« rien
     ici ne relit le catalogue ») : la garde vise le code, pas la prose. */
  v('lib/calc.ts ne relit rien de la règle (un devis envoyé reste figé)',
    !/majoration|tarifsPourMedecin|MAJORATIONS|from '\.\/catalogue'/.test(src('lib/calc.ts')));
  v('lib/mappers.ts ne connaît pas la mémoire _systeme (elle ne part jamais en base)',
    !src('lib/mappers.ts').includes('_systeme'));
  v('le sélecteur, la Bibliothèque et l’éditeur de devis passent par tarifsPourMedecin',
    ['components/SelecteurModele.tsx', 'components/Bibliotheque.tsx', 'components/Devis.tsx']
      .every((f) => src(f).includes('tarifsPourMedecin(')));
  v('l’éditeur de devis réserve la règle au devis neuf (isEdit)', /isEdit \? '' :/.test(src('components/Devis.tsx')));
  v('l’éditeur de devis retient ce que le système pose (forfait et option)',
    src('components/Devis.tsx').includes('retenirForfaitSysteme(') && src('components/Devis.tsx').includes('retenirOptionSysteme('));
  v('la duplication et la conversion en facture ne passent par aucun geste tarifaire',
    !/reajusterPrixSysteme|tarifsPourMedecin|retenir\w+Systeme/.test(src('components/Devis.tsx').split('const duplicate')[1].split('export function')[0]));
  v('l’éditeur de facture ne réajuste jamais', !/reajusterPrixSysteme|tarifsPourMedecin|retenir\w+Systeme/.test(src('components/Factures.tsx')));
}

/* ---- bilan ---- */
const ko = r.filter(([, ok]) => !ok);
console.log(`\n${ko.length ? '✗' : '✓'} ${r.length - ko.length}/${r.length} contrôles passés`);
if (ko.length) {
  console.log('Échecs :\n' + ko.map(([n]) => '  - ' + n).join('\n'));
  process.exit(1);
}
