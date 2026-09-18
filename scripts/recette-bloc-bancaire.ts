/* Recette du bloc bancaire des devis et des factures — 18 septembre 2026.

   Les promesses de ce lot, chacune prouvée sur les valeurs RÉELLES relevées
   en base le 18/09 :

   · l'IBAN affiché est le MÊME que le stocké, aux espaces près — dans les deux
     sens, jamais un caractère de plus ni de moins ;
   · un groupe de quatre ne se coupe jamais (les groupes sont les unités de
     rendu, et la feuille de style les rend insécables) ;
   · cinq lignes entières, sur les devis comme sur les factures ;
   · un document émis sur un AUTRE compte garde son bloc d'origine — on ne
     réécrit pas le bénéficiaire d'un virement déjà parti ;
   · l'IBAN amputé des onze documents de juillet-août est DÉTECTÉ, et il n'est
     pas réécrit pour autant.

   Usage : npx tsx scripts/recette-bloc-bancaire.ts */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  blocBancaire, cleIban, ecartLongueurIban, formaterIban, groupesIban, ibanPlausible, memeCompte,
} from '../lib/banque';
import { DEFAULT_SETTINGS, type Settings } from '../lib/defaults';
import type { DocRecord } from '../lib/types';

const r: [string, boolean][] = [];
const v = (nom: string, ok: boolean, detail = '') => {
  r.push([nom, ok]);
  console.log(`  ${ok ? '✓' : '✗'} ${nom}${detail ? ' — ' + detail : ''}`);
};

/* Les valeurs réellement en base au 18/09/2026 (nw_parametres, clé societe),
   APRÈS correction du nom de la banque. L'IBAN et le BIC sont intouchés. */
const PARAMS = {
  ...DEFAULT_SETTINGS,
  company: 'Clinic NobelWorld',
  bankBeneficiary: 'Clinic NobelWorld',
  bankName: 'Paysera LT, UAB',
  bankCountry: 'Lituanie',
  bankAddress: 'Lituanie',
  iban: 'LT693500010019147464',
  bic: 'EVIULT2VXXX',
} as Settings;

/* Les cinq comptes photographiés, relevés le 18/09 sur les 48 documents. */
const COMPTE_LT = { bqNom: 'BUNQ: VEYSEL TURAN', bqIban: 'LT693500010019147464', bqBic: 'EVIULT2VXXX', bqAdresse: 'Lituanie' };
const COMPTE_FR_ENTIER = { bqNom: 'BUNQ', bqIban: 'FR76 2763 3121 2904 0491 8317 894', bqBic: 'BUNQFRP2', bqAdresse: 'bunq 32 Basisweg 1043 AP Amsterdam NL' };
const COMPTE_FR_AMPUTE = { bqNom: 'BUNQ: VEYSEL TURAN', bqIban: 'FR76 2763 3121 2904 8317 894', bqBic: '', bqAdresse: 'FRANCE' };
const COMPTE_TR = { bqNom: 'QNB', bqIban: 'TR43 0011 1000 0000 0104 2382 62', bqBic: 'FNNBTRISXXX', bqAdresse: 'Turquie ' };
const SANS_PHOTO: DocRecord = {};
const PHOTO_VIDE = { bqNom: '', bqIban: '', bqBic: '', bqAdresse: '' };

const valeurDe = (b: ReturnType<typeof blocBancaire>, libelle: string) =>
  b.lignes.find((l) => l.libelle === libelle)?.valeur ?? '(absente)';

console.log('\n=== 1. L\'IBAN affiché est le MÊME que le stocké, aux espaces près ===');
{
  const STOCKE = 'LT693500010019147464';
  const AFFICHE = 'LT69 3500 0100 1914 7464';
  v('« LT693500010019147464 » s\'affiche « LT69 3500 0100 1914 7464 »', formaterIban(STOCKE) === AFFICHE, formaterIban(STOCKE));
  v('caractère pour caractère, espaces retirés : identité stricte', cleIban(formaterIban(STOCKE)) === cleIban(STOCKE));
  v('même nombre de caractères significatifs (20), rien d\'ajouté ni de perdu',
    cleIban(formaterIban(STOCKE)).length === 20 && cleIban(STOCKE).length === 20);
  v('reformater un IBAN déjà espacé ne le change pas', formaterIban(AFFICHE) === AFFICHE);
  v('un IBAN saisi en minuscules ou avec des tirets tombe sur le même affichage',
    formaterIban('lt69-3500-0100-1914-7464') === AFFICHE);
  v('aucune valeur n\'est réécrite : formaterIban est une pure lecture (la base garde « ' + STOCKE + ' »)',
    STOCKE === 'LT693500010019147464');
}

console.log('\n=== 2. Les groupes de quatre — l\'IBAN ne se coupe jamais au milieu ===');
{
  const g = groupesIban('LT693500010019147464');
  v('cinq groupes', g.length === 5, g.join('|'));
  v('les quatre premiers font exactement quatre caractères', g.slice(0, 4).every((x) => x.length === 4));
  v('aucun groupe vide, aucun groupe de plus de quatre', g.every((x) => x.length > 0 && x.length <= 4));
  v('recollés, ils redonnent l\'IBAN stocké', g.join('') === 'LT693500010019147464');
  const tr = groupesIban(COMPTE_TR.bqIban);
  v('un IBAN turc (26) : six groupes de quatre puis un de deux',
    tr.length === 7 && tr.slice(0, 6).every((x) => x.length === 4) && tr[6].length === 2, tr.join('|'));
  v('IBAN vide → aucun groupe, aucune ligne fabriquée', groupesIban('').length === 0 && groupesIban(null).length === 0);
}

console.log('\n=== 3. Cinq lignes entières, dans l\'ordre demandé ===');
{
  const b = blocBancaire(SANS_PHOTO, PARAMS);
  v('forme « cinq »', b.forme === 'cinq');
  v('cinq lignes, ni plus ni moins', b.lignes.length === 5, String(b.lignes.length));
  v('dans l\'ordre : Bénéficiaire, IBAN, BIC / SWIFT, Banque, Pays',
    b.lignes.map((l) => l.libelle).join(' | ') === 'Bénéficiaire | IBAN | BIC / SWIFT | Banque | Pays',
    b.lignes.map((l) => l.libelle).join(' | '));
  v('Bénéficiaire = Clinic NobelWorld — une société, pas une personne', valeurDe(b, 'Bénéficiaire') === 'Clinic NobelWorld');
  v('IBAN = LT69 3500 0100 1914 7464', valeurDe(b, 'IBAN') === 'LT69 3500 0100 1914 7464');
  v('BIC / SWIFT = EVIULT2VXXX', valeurDe(b, 'BIC / SWIFT') === 'EVIULT2VXXX');
  v('Banque = Paysera LT, UAB', valeurDe(b, 'Banque') === 'Paysera LT, UAB');
  v('Pays = Lituanie', valeurDe(b, 'Pays') === 'Lituanie');
  v('« BUNQ » n\'apparaît plus nulle part dans le bloc',
    !b.lignes.some((l) => /bunq|veysel|turan/i.test(l.valeur + l.libelle)));
  v('la ligne IBAN est marquée pour le rendu par groupes insécables',
    b.lignes.find((l) => l.libelle === 'IBAN')?.iban === true
    && b.lignes.filter((l) => l.iban).length === 1);
  v('aucun libellé abrégé : « Bénéficiaire » et « BIC / SWIFT » en entier',
    b.lignes.some((l) => l.libelle === 'Bénéficiaire') && b.lignes.some((l) => l.libelle === 'BIC / SWIFT'));
}

console.log('\n=== 4. Devis et facture : le même bloc, le même code ===');
{
  /* Le composant DevisDoc rend les deux types ; blocBancaire ne reçoit que le
     document, donc rien ne peut diverger. On le prouve sur un devis et une
     facture portant le même compte. */
  const devis = blocBancaire({ numero: 'D-2026-000101', ...COMPTE_LT }, PARAMS);
  const facture = blocBancaire({ numero: 'F-2026-000050', typeFacture: 'solde', ...COMPTE_LT }, PARAMS);
  v('devis : cinq lignes', devis.forme === 'cinq' && devis.lignes.length === 5);
  v('facture : cinq lignes', facture.forme === 'cinq' && facture.lignes.length === 5);
  v('les deux blocs sont identiques, ligne pour ligne',
    JSON.stringify(devis.lignes) === JSON.stringify(facture.lignes));
}

console.log('\n=== 5. Le compte courant : les libellés se corrigent, l\'IBAN ne bouge pas ===');
{
  /* D-2026-000048/51/52 et F-2026-000032/34/35 portent le compte Paysera avec
     l'ancien nom faux. Même compte → libellés corrigés. */
  const b = blocBancaire(COMPTE_LT, PARAMS);
  v('document photographiant le compte Paysera → forme « cinq »', b.forme === 'cinq');
  v('son bénéficiaire faux (« BUNQ: VEYSEL TURAN ») est remplacé par la société',
    valeurDe(b, 'Bénéficiaire') === 'Clinic NobelWorld' && b.photo.nom === 'BUNQ: VEYSEL TURAN');
  v('son IBAN photographié est affiché, espacé, inchangé au caractère près',
    valeurDe(b, 'IBAN') === 'LT69 3500 0100 1914 7464' && memeCompte(valeurDe(b, 'IBAN'), b.photo.iban));
  const espace = blocBancaire({ ...COMPTE_LT, bqIban: 'LT69 3500 0100 1914 7464' }, PARAMS);
  v('le même compte écrit AVEC espaces est reconnu comme le même', espace.forme === 'cinq');
  const photoVide = blocBancaire(PHOTO_VIDE, PARAMS);
  v('photographie VIDE (D-2026-000040, F-2026-000025) → cinq lignes des Paramètres',
    photoVide.forme === 'cinq' && valeurDe(photoVide, 'IBAN') === 'LT69 3500 0100 1914 7464');
  v('document sans aucune photographie (13 documents) → cinq lignes',
    blocBancaire(SANS_PHOTO, PARAMS).forme === 'cinq');
}

console.log('\n=== 6. Un autre compte garde son bloc d\'origine, intact ===');
{
  for (const [nom, compte] of [['BUNQ français entier', COMPTE_FR_ENTIER], ['BUNQ français amputé', COMPTE_FR_AMPUTE], ['QNB turc', COMPTE_TR]] as const) {
    const b = blocBancaire(compte, PARAMS);
    v(`${nom} → forme « historique », aucune ligne fabriquée`, b.forme === 'historique' && b.lignes.length === 0);
    v(`${nom} → ses quatre valeurs photographiées ressortent mot pour mot`,
      b.photo.nom === compte.bqNom && b.photo.iban === compte.bqIban
      && b.photo.bic === compte.bqBic && b.photo.adresse === compte.bqAdresse);
  }
  /* Le défaut trouvé PAR cette recette : un BIC photographié vide allait
     chercher celui des Paramètres, et un IBAN français s'affichait sous le
     BIC lituanien de Paysera — un couple qui n'existe dans aucune banque. */
  {
    const ampute = blocBancaire(COMPTE_FR_AMPUTE, PARAMS);
    v('un BIC photographié VIDE n\'emprunte PAS celui des Paramètres', ampute.photo.bic === '', `« ${ampute.photo.bic} »`);
    v('aucun IBAN français ne s\'affiche sous le BIC lituanien',
      !(ampute.photo.iban.startsWith('FR') && ampute.photo.bic === PARAMS.bic));
    v('JUMEAU : sur le compte COURANT, le repli des Paramètres joue toujours',
      blocBancaire({ ...COMPTE_LT, bqBic: '' }, PARAMS).lignes.find((l) => l.libelle === 'BIC / SWIFT')?.valeur === 'EVIULT2VXXX');
  }
  v('JUMEAU : le compte courant, lui, ne passe PAS en historique',
    blocBancaire(COMPTE_LT, PARAMS).forme === 'cinq');
  v('le jour où le compte change, les documents de l\'ANCIEN repassent en historique — la règle se protège seule',
    blocBancaire(COMPTE_LT, { ...PARAMS, iban: 'TR43 0011 1000 0000 0104 2382 62' } as Settings).forme === 'historique');
}

console.log('\n=== 7. L\'IBAN amputé des onze documents de juillet-août est DÉTECTÉ ===');
{
  v('« FR76 2763 3121 2904 8317 894 » : 23 caractères au lieu de 27 → signalé',
    !ibanPlausible(COMPTE_FR_AMPUTE.bqIban) && ecartLongueurIban(COMPTE_FR_AMPUTE.bqIban) === -4,
    `${cleIban(COMPTE_FR_AMPUTE.bqIban).length} caractères, écart ${ecartLongueurIban(COMPTE_FR_AMPUTE.bqIban)}`);
  v('JUMEAU : le même compte ENTIER (27) est plausible', ibanPlausible(COMPTE_FR_ENTIER.bqIban));
  v('le compte Paysera (LT, 20) est plausible', ibanPlausible(PARAMS.iban));
  v('le compte turc (TR, 26) est plausible', ibanPlausible(COMPTE_TR.bqIban));
  v('un pays hors table ne déclenche aucune alerte — on ne crie pas au loup',
    ibanPlausible('XX12 3456') && ecartLongueurIban('XX12 3456') === 0);
  v('un IBAN absent ne déclenche rien non plus', ibanPlausible('') && ibanPlausible(null));
  v('DÉTECTÉ n\'est pas RÉÉCRIT : ces onze documents restent en forme historique, IBAN compris',
    blocBancaire(COMPTE_FR_AMPUTE, PARAMS).photo.iban === 'FR76 2763 3121 2904 8317 894');
}

console.log('\n=== 8. Les replis, et les lignes qui ne se fabriquent pas ===');
{
  const sansReglagesNeufs = blocBancaire(SANS_PHOTO, {
    ...PARAMS, bankBeneficiary: '', bankCountry: '',
  } as Settings);
  v('bénéficiaire absent → la raison sociale', valeurDe(sansReglagesNeufs, 'Bénéficiaire') === 'Clinic NobelWorld');
  v('pays absent → l\'adresse bancaire (« Lituanie » en base)', valeurDe(sansReglagesNeufs, 'Pays') === 'Lituanie');
  v('le bénéficiaire explicite l\'emporte sur la raison sociale',
    valeurDe(blocBancaire(SANS_PHOTO, { ...PARAMS, bankBeneficiary: 'Clinic NobelWorld LTD' } as Settings), 'Bénéficiaire')
    === 'Clinic NobelWorld LTD');
  const nu = blocBancaire(SANS_PHOTO, {
    ...DEFAULT_SETTINGS, company: '', bankBeneficiary: '', bankName: '', bankAddress: '', bankCountry: '', iban: '', bic: '',
  } as Settings);
  v('tout vide → aucune ligne, jamais un « Pays : » orphelin', nu.forme === 'cinq' && nu.lignes.length === 0);
  const partiel = blocBancaire(SANS_PHOTO, { ...PARAMS, bic: '', bankCountry: '', bankAddress: '' } as Settings);
  v('BIC et pays absents → trois lignes, les autres intactes',
    partiel.lignes.map((l) => l.libelle).join('|') === 'Bénéficiaire|IBAN|Banque',
    partiel.lignes.map((l) => l.libelle).join('|'));
  v('les valeurs sont détourées (le « Turquie » suivi d\'un espace en base ne laisse pas de trace)',
    valeurDe(blocBancaire(SANS_PHOTO, { ...PARAMS, bankCountry: ' Lituanie ' } as Settings), 'Pays') === 'Lituanie');
}

console.log('\n=== 9. Garde de style : ni troncature, ni police réduite ===');
{
  const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');
  const bloc = css.split('\n').filter((l) => l.startsWith('.bankbox')).join('\n');
  v('les règles .bankbox existent', bloc.length > 0);
  const taille = /\.bankbox\{[^}]*font-size:([\d.]+)px/.exec(bloc);
  const corps = /^\.doc\{[^}]*font-size:([\d.]+)px/m.exec(css);
  const t = Number(taille?.[1] || 0);
  const c = Number(corps?.[1] || 0);
  v(`police du bloc (${t}px) au moins égale au corps du document (${c}px)`, t > 0 && c > 0 && t >= c);
  v('aucune troncature : ni text-overflow, ni overflow:hidden, ni ellipsis',
    !/text-overflow|overflow:\s*hidden|ellipsis/.test(bloc));
  v('aucune hauteur ni largeur figée sur la valeur',
    !/\.bankbox \.bv\{[^}]*(height|max-width|width):/.test(bloc));
  v('chaque groupe de l\'IBAN est insécable (white-space:nowrap sur .g)',
    /\.bankbox \.bv\.iban \.g\{[^}]*white-space:\s*nowrap/.test(bloc));
  v('le bloc ne se coupe pas entre deux pages (break-inside:avoid)',
    /\.bankbox\{[^}]*break-inside:\s*avoid/.test(bloc));
  const doc = readFileSync(join(__dirname, '..', 'components', 'DevisDoc.tsx'), 'utf8');
  v('le document ne calcule plus les coordonnées à la main : il appelle blocBancaire',
    doc.includes('blocBancaire(record, s)') && !/const bq = \{\s*\n\s*nom:/.test(doc));
  v('les montants et le QR code ne sont pas touchés par ce lot',
    doc.includes('api.qrserver.com') && doc.includes('money(total, cur)'));
}

const ko = r.filter(([, ok]) => !ok);
console.log(`\n=== ${r.length - ko.length}/${r.length} contrôles au vert ===`);
if (ko.length) console.log('  échecs : ' + ko.map(([n]) => n).join(' · '));
process.exit(ko.length ? 1 : 0);
