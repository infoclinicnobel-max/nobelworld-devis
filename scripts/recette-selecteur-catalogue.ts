/* Recette du branchement catalogue ↔ sélecteur d'actes — Veys, 17 août.

   Trois fonctions pures : la clé de comparaison (cleLibelle), la
   reconnaissance d'un libellé (resoudreLibelle), la recherche étendue aux
   libellés d'usage (filtrerModeles + correspondances), plus le nettoyage des
   lignes d'acte vides (nettoyerActes). Les LIBELLÉS sont les cas réels mesurés
   le 20 août sur les 22 devis ; les CIBLES des correspondances sont un banc
   synthétique — la vraie table vit en base et bouge (le 21 août, « Liposuccion
   1 zone » a été repointée de sup-zone-liposuccion vers alc-lipo-1-zone).
   Citer une fixture comme un relevé est exactement l'erreur commise le 21 : un
   banc éprouve un mécanisme, il ne décrit jamais la base.

   Le point sous garde : les correspondances « a_verifier » ne nourrissent
   JAMAIS la recherche — un tarif engagé sans relecture. Le jumeau positif :
   la MÊME correspondance, passée « valide », la nourrit.

   Usage : npx tsx scripts/recette-selecteur-catalogue.ts */

import {
  cleLibelle, filtrerModeles, nettoyerActes, resoudreLibelle, type Correspondance,
} from '../lib/catalogue';
import type { Acte, Modele } from '../lib/types';

const r: [string, boolean][] = [];
const v = (nom: string, ok: boolean, detail = '') => {
  r.push([nom, ok]);
  console.log(`  ${ok ? '✓' : '✗'} ${nom}${detail ? ' — ' + detail : ''}`);
};

const modele = (id: string, nom: string, o: Partial<Modele> = {}): Modele =>
  ({ id, nom, categorie: 'esthetique', sousCategorie: 'corps', prixBase: 1000, actif: true,
    synonymes: [], description: '', ...o }) as Modele;

/* Un extrait du catalogue réel — les cibles des cas mesurés. */
const MODELES: Modele[] = [
  modele('cat-bbl-seul', 'BBL seul (sans prothèses)'),
  modele('cat-fox-eyes', 'Fox eyes', { sousCategorie: 'visage' }),
  modele('cat-bichectomie', 'Bichectomie', { sousCategorie: 'visage' }),
  modele('alc-lipo-vaser-360-seule', 'Liposuccion Vaser 360 seule', { synonymes: ['lipo 360'] }),
];
const CORRESP: Correspondance[] = [
  { libelle: 'SAFE BBL', catalogueId: 'cat-bbl-seul', statut: 'valide' },
  { libelle: 'Fox Eyes', catalogueId: 'cat-fox-eyes', statut: 'valide' },
  { libelle: 'Liposuccion 1 zone', catalogueId: 'alc-lipo-vaser-360-seule', statut: 'a_verifier' }, // cible SYNTHÉTIQUE
  { libelle: 'Ancien libellé perdu', catalogueId: null, statut: 'sans_correspondance' },
];

console.log('\n=== 1. La clé de comparaison absorbe la typographie, pas le sens ===');
{
  v('casse effacée — « Fox Eyes » = « Fox eyes »', cleLibelle('Fox Eyes') === cleLibelle('Fox eyes'));
  v('accents effacés — « Blépharoplastie » = « Blepharoplastie »',
    cleLibelle('Blépharoplastie') === cleLibelle('Blepharoplastie'));
  v('espaces multiples repliés', cleLibelle('SAFE  BBL ') === cleLibelle('safe bbl'));
  v('la ponctuation reste — « & » ≠ « + »', cleLibelle('A & B') !== cleLibelle('A + B'));
}

console.log('\n=== 2. resoudreLibelle sur les cas réels du 20 août ===');
{
  const res = (l: string) => resoudreLibelle(l, MODELES, CORRESP);
  v('« Bichectomie » → exact au catalogue', res('Bichectomie').etat === 'exact');
  v('« Fox Eyes » → exact malgré la majuscule — la casse ne passe plus par la table',
    res('Fox Eyes').etat === 'exact', res('Fox Eyes').etat);
  v('« SAFE BBL » → reconnu par correspondance valide, cible nommée',
    res('SAFE BBL').etat === 'valide' && res('SAFE BBL').modele?.id === 'cat-bbl-seul');
  v('« Liposuccion 1 zone » → à vérifier, cible visible mais non engagée',
    res('Liposuccion 1 zone').etat === 'a_verifier' && res('Liposuccion 1 zone').modele?.id === 'alc-lipo-vaser-360-seule');
  v('« Liposuccion 360 » → aucun (le cas des 12 hors catalogue)', res('Liposuccion 360').etat === 'aucun');
  v('libellé vide → aucun, pas de pastille', res('   ').etat === 'aucun');
}

console.log('\n=== 3. LA GARDE — les « a_verifier » ne nourrissent pas la recherche ===');
{
  const trouve = (q: string, corresp: Correspondance[]) =>
    filtrerModeles(MODELES, q, corresp).map((m) => m.id);
  v('« safe bbl » (valide) trouve la ligne officielle',
    trouve('safe bbl', CORRESP).includes('cat-bbl-seul'));
  v('« liposuccion 1 zone » (a_verifier) ne trouve RIEN par la table',
    !trouve('liposuccion 1 zone', CORRESP).length, trouve('liposuccion 1 zone', CORRESP).join(','));
  v('JUMEAU : la MÊME correspondance passée « valide » trouve la cible',
    trouve('liposuccion 1 zone',
      CORRESP.map((c) => (c.libelle === 'Liposuccion 1 zone' ? { ...c, statut: 'valide' } : c)),
    ).includes('alc-lipo-vaser-360-seule'));
  v('sans correspondances (appelant ancien), la recherche nom+synonymes est intacte',
    filtrerModeles(MODELES, 'lipo 360').some((m) => m.id === 'alc-lipo-vaser-360-seule'));
  v('une correspondance sans cible (catalogueId null) n\'apporte rien',
    !trouve('ancien libellé perdu', CORRESP).length);
}

console.log('\n=== 4. nettoyerActes — la ligne vide ne part plus ===');
{
  const a = (acte: string, inclus = ''): Acte => ({ id: 'a' + Math.abs(acte.length + inclus.length), acte, inclus });
  const actes = [a('SAFE BBL', 'détail'), a('', ''), a('  ', ' '), a('', 'détail seul')];
  const propres = nettoyerActes(actes);
  v('les lignes entièrement vides sont retirées', propres.length === 2, String(propres.length));
  v('une ligne à détail seul est CONSERVÉE — elle porte quelque chose',
    propres.some((x) => x.inclus === 'détail seul'));
  v('liste absente → liste vide, jamais une erreur', nettoyerActes(undefined).length === 0);
}

const ko = r.filter(([, ok]) => !ok);
console.log(`\n=== ${r.length - ko.length}/${r.length} contrôles au vert ===`);
if (ko.length) console.log('  échecs : ' + ko.map(([n]) => n).join(' · '));
process.exit(ko.length ? 1 : 0);
