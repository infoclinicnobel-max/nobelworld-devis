/* Recette du crayon des factures — la TRACE, éprouvée sans connexion.

   Le crayon lui-même est de l'interface ; ce qui se prouve ici est sa moitié
   mémoire : differencesFacture() dit-elle exactement ce qui a changé, avec
   l'ancienne et la nouvelle valeur ? Le scénario central est celui du 17 août
   2026 — retirer une option de 2 000 € d'une facture émise — qui était passé
   par supprimer/refaire faute de crayon, en brûlant F-2026-000024.

   Usage : npx tsx scripts/recette-crayon-facture.ts */

import { differencesFacture, messageModificationFacture } from '../lib/trace';
import { money } from '../lib/format';
import type { DocRecord } from '../lib/types';

const r: [string, boolean][] = [];
const v = (nom: string, ok: boolean, detail = '') => {
  r.push([nom, ok]);
  console.log(`  ${ok ? '✓' : '✗'} ${nom}${detail ? ' — ' + detail : ''}`);
};

const CUR = '€';
const facture = (o: Partial<DocRecord> = {}): DocRecord => ({
  id: 'fac_1', numero: 'F-2026-000024', patientId: 'p1', statut: 'envoye',
  date: '2026-08-17', forfait: 8500,
  actes: [{ id: 'a1', acte: 'SAFE BBL + Liposuccion Vaser HD 360°', inclus: 'x' }],
  options: [{ id: 'o1', nom: 'Lifting fessier', prix: 2000, qty: 1 }],
  inc: ['Transferts VIP'], exc: ['Vols internationaux'],
  ...o,
});

console.log('\n=== 1. LE SCÉNARIO DU 17 AOÛT — retirer une option de 2 000 € ===');
{
  const avant = facture();
  const apres = facture({ options: [] });
  const d = differencesFacture(avant, apres, CUR);
  v('le total dit l\'ancien ET le nouveau montant',
    d.includes(`total : ${money(10500, CUR)} → ${money(8500, CUR)}`), d[0] || 'rien');
  v('l\'option retirée est nommée, avec son montant',
    d.includes(`option retirée : « Lifting fessier » (${money(2000, CUR)})`),
    d.find((x) => /retirée/.test(x)) || 'absente');
  v('et rien d\'autre n\'est déclaré', d.length === 2, String(d.length));
}

console.log('\n=== 2. Montants : forfait, acompte, remise ===');
{
  const d = differencesFacture(facture(), facture({ forfait: 9000, acompte: 300 }), CUR);
  v('forfait : ancien → nouveau', d.includes(`forfait : ${money(8500, CUR)} → ${money(9000, CUR)}`));
  v('acompte : ancien → nouveau', d.includes(`acompte : ${money(0, CUR)} → ${money(300, CUR)}`));
  const d2 = differencesFacture(facture(), facture({ remiseValeur: 500, remiseType: 'montant' }), CUR);
  v('remise déclarée avec son unité', d2.some((x) => /^remise : 0 € → 500 €$/.test(x)),
    d2.find((x) => /remise/.test(x)) || 'absente');
}

console.log('\n=== 3. Options : prix, retenue, ajout ===');
{
  const d = differencesFacture(
    facture(),
    facture({ options: [{ id: 'o1', nom: 'Lifting fessier', prix: 1500, qty: 1 }] }), CUR,
  );
  v('changement de prix d\'option : ancien → nouveau',
    d.includes(`option « Lifting fessier » : ${money(2000, CUR)} → ${money(1500, CUR)}`));
  const d2 = differencesFacture(
    facture(),
    facture({ options: [{ id: 'o1', nom: 'Lifting fessier', prix: 2000, qty: 1, retenue: false }] }), CUR,
  );
  v('option sortie du total (« plus retenue ») — la règle du champ absent est respectée',
    d2.includes('option « Lifting fessier » plus retenue')
    && d2.includes(`total : ${money(10500, CUR)} → ${money(8500, CUR)}`));
  const d3 = differencesFacture(
    facture(),
    facture({
      options: [
        { id: 'o1', nom: 'Lifting fessier', prix: 2000, qty: 1 },
        { id: 'o2', nom: 'Massage drainage', prix: 300, qty: 2, retenue: false },
      ],
    }), CUR,
  );
  v('option ajoutée non retenue : montant dit, total inchangé',
    d3.includes(`option ajoutée : « Massage drainage » (${money(600, CUR)}, non retenue)`)
    && !d3.some((x) => /^total/.test(x)));
}

console.log('\n=== 4. Actes et listes ===');
{
  const d = differencesFacture(
    facture(),
    facture({ actes: [{ id: 'a1', acte: 'SAFE BBL seul', inclus: 'x' }] }), CUR,
  );
  v('acte renommé : ancien → nouveau',
    d.includes('acte : « SAFE BBL + Liposuccion Vaser HD 360° » → « SAFE BBL seul »'));
  const d2 = differencesFacture(facture(), facture({ inc: ['Transferts VIP', 'Hôtel 5★'] }), CUR);
  v('prestation incluse ajoutée, nommée', d2.includes('prestation incluse ajoutée : « Hôtel 5★ »'));
  const d3 = differencesFacture(facture(), facture({ exc: [] }), CUR);
  v('prestation exclue retirée, nommée', d3.includes('prestation exclue retirée : « Vols internationaux »'));
}

console.log('\n=== 5. Textes longs : prouvés par extrait, jamais recopiés en entier ===');
{
  const long = 'Le présent devis en promotion est valable 8 jours à compter de sa date d\'émission, '
    + 'et les conditions générales de vente s\'appliquent dans leur intégralité à toute prestation.';
  const d = differencesFacture(facture(), facture({ cgv: long }), CUR);
  const ligne = d.find((x) => /notes médicales/.test(x)) || '';
  v('le changement est déclaré', !!ligne, ligne);
  v('l\'extrait est borné (pas de paragraphe entier dans l\'historique)', ligne.length < 180, String(ligne.length));
  v('l\'ancien état vide est dit « (vide) »', /« \(vide\) »/.test(ligne));
}

console.log('\n=== 6. Patient, statut, et le silence quand rien ne change ===');
{
  const noms: Record<string, string> = { p1: 'Pieggy Kandice', p2: 'Ashley Munao' };
  const d = differencesFacture(facture(), facture({ patientId: 'p2' }), CUR, (id) => noms[id] || id);
  v('changement de patiente : en toutes lettres', d.includes('patient : Pieggy Kandice → Ashley Munao'));
  const d2 = differencesFacture(facture(), facture({ statut: 'annulee' }), CUR);
  v('changement de statut déclaré', d2.includes('statut : envoye → annulee'));
  v('AUCUNE modification → AUCUNE ligne — le crayon ne crie pas pour rien',
    differencesFacture(facture(), facture(), CUR).length === 0);
}

console.log('\n=== 7. Le message d\'historique ===');
{
  const m = messageModificationFacture('F-2026-000025', ['total : 10 → 8', 'option retirée : « x » (2)']);
  v('il nomme la facture et joint les changements',
    m === 'a modifié la facture F-2026-000025 — total : 10 → 8 · option retirée : « x » (2)', m);
  const beaucoup = Array.from({ length: 20 }, (_, i) => `champ${i} : a → b`);
  const m2 = messageModificationFacture('F-X', beaucoup);
  v('au-delà de 14 changements, le compte des restants est dit',
    /…et 6 autre\(s\) changement\(s\)$/.test(m2), m2.slice(-40));
}

const ko = r.filter(([, ok]) => !ok);
console.log(`\n=== ${r.length - ko.length}/${r.length} contrôles au vert ===`);
if (ko.length) console.log('  échecs : ' + ko.map(([n]) => n).join(' · '));
process.exit(ko.length ? 1 : 0);
