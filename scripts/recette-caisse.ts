/* Recette de la caisse de la coordinatrice — lot 73, 30 août.

   Fonctions pures de lib/caisse.ts (classement, soldes par devise, taux,
   saisie de mémoire, rapprochement), gardes d'écriture de lib/mappers.ts
   (sens/lieu/devise obligatoires, montant lisible, updated_at posé à la main),
   et gardes de SOURCE (un mouvement ne se supprime pas, aucun taux stocké, la
   vue reste la source du solde affiché).

   Les COMBINAISONS type/methode/statut sont les sept réelles des 64 lignes
   relevées le 30/08 ; le solde 46 683,00 EUR est le RELEVÉ du même jour,
   rejoué en agrégat (57 450 encaissés espèces − 10 767 sorties réalisées) et
   vérifié des deux côtés — vue SQL et miroir pur. Un banc éprouve un
   mécanisme ; il ne décrit pas la base, qui bouge.

   soldesCaisse est le MIROIR de vue_caisse_solde : même règle, autre nature
   d'instrument. Si l'une des deux change sans l'autre, le rapprochement
   d'après-coup (vue vs local, affiché à l'écran en cas de repli) divergera.

   Usage : npx tsx scripts/recette-caisse.ts */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  classerMouvements, DEVISE_CAISSE, devisePourPaiementChirurgien, deltasCaisse, estSaisieDeMemoire,
  montantNumerique, rapprochementParPatiente, sensLieuPourReprise, soldesCaisse, tauxDuChange,
} from '../lib/caisse';
import { arreteToRow, mouvementToRow, rowToMouvement } from '../lib/mappers';
import type { Arrete, Mouvement, Paiement } from '../lib/types';

const r: [string, boolean][] = [];
const v = (nom: string, ok: boolean, detail = '') => {
  r.push([nom, ok]);
  console.log(`  ${ok ? '✓' : '✗'} ${nom}${detail ? ' — ' + detail : ''}`);
};
const egal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const jette = (f: () => unknown): string => {
  try { f(); return ''; } catch (e) { return e instanceof Error ? e.message : String(e); }
};

let n = 0;
const mvt = (o: Partial<Mouvement>): Mouvement => ({
  id: 'm' + (n += 1), patientId: '', type: '', procedure: '', montant: '0', date: '2026-08-30',
  statut: 'Complété', methode: 'Espèces', creePar: 'ceyda', devise: 'EUR', notes: '',
  sens: 'entree', lieu: 'caisse', montantContrepartie: '', deviseContrepartie: '',
  createdAt: '2026-08-30T18:00:00Z', ...o,
});

console.log('\n=== 1. La reprise du 30/08 : correspondance explicite, jamais une déduction ===');
{
  const cas: [string, string, { sens: string; lieu: string } | null][] = [
    ['Acompte', 'Virement', { sens: 'entree', lieu: 'compte' }],
    ['Devis', 'Virement', { sens: 'entree', lieu: 'compte' }],
    ['Paiement total', 'Espèces', { sens: 'entree', lieu: 'caisse' }],
    ['Honoraires chirurgien', '', { sens: 'sortie', lieu: 'caisse' }],
    ['Paiement chirurgien', 'Espèces', { sens: 'sortie', lieu: 'caisse' }],
    ['Commission commerciale', 'Espèces', { sens: 'sortie', lieu: 'caisse' }],
  ];
  v('les sept combinaisons réelles tombent toutes dans la correspondance de la migration',
    cas.every(([t, m, attendu]) => egal(sensLieuPourReprise(t, m), attendu)));
  v('un type inconnu (« Remboursement ») → null : à trancher le jour où il apparaît, pas à deviner',
    sensLieuPourReprise('Remboursement', 'Virement') === null);
  v('une entrée à méthode inconnue → null : le lieu ne se devine pas', sensLieuPourReprise('Acompte', 'Carte') === null);
}

console.log('\n=== 2. Le montant reste du texte : lisible ou signalé, jamais NaN ===');
{
  v('« 2360 » → 2360 ; « 12,5 » → 12.5 ; « -50 » → -50',
    montantNumerique('2360') === 2360 && montantNumerique('12,5') === 12.5 && montantNumerique('-50') === -50);
  v('vide, « abc », « 1 234 » (espace) → null, jamais 0',
    montantNumerique('') === null && montantNumerique('abc') === null && montantNumerique('1 234') === null);
}

console.log('\n=== 3. Le classement : compté, en attente, à trancher, à classer, illisible, annulé ===');
{
  const liste = [
    mvt({}),                                                     // réalisé
    mvt({ statut: 'En attente' }),                               // pas encore dans la caisse
    mvt({ sens: 'sortie', statut: '' }),                         // les 4 honoraires : ni payé ni dû
    mvt({ sens: '' }),                                           // écrit par le monolithe : à classer
    mvt({ montant: 'abc' }),                                     // illisible : signalé, jamais sommé
    mvt({ statut: 'Annulé' }),                                   // annulé : visible, hors solde
    mvt({ sens: 'change', montantContrepartie: 'xx', deviseContrepartie: 'TRY' }), // contrepartie illisible
  ];
  const c = classerMouvements(liste);
  v('1 réalisé · 1 en attente · 1 à trancher · 1 à classer · 2 illisibles · 1 annulé',
    c.realises.length === 1 && c.enAttente.length === 1 && c.aTrancher.length === 1
      && c.aClasser.length === 1 && c.illisibles.length === 2 && c.annules.length === 1);
  v('liste absente → tout vide, jamais une erreur', classerMouvements(undefined).realises.length === 0);
}

console.log('\n=== 4. Les soldes : par devise, jamais mêlés, depuis le dernier arrêté ===');
{
  /* Le relevé du 30/08, rejoué en agrégat : 57 450 € encaissés en espèces,
     10 767 € de sorties réalisées → 46 683,00 — le nombre vérifié le même
     jour sur vue_caisse_solde avec les 64 lignes réelles. */
  const releve = [
    mvt({ montant: '57450' }),
    mvt({ sens: 'sortie', montant: '10767', statut: 'Payé' }),
    mvt({ sens: 'sortie', montant: '7720', statut: '' }),        // les honoraires : EXCLUS
    mvt({ montant: '17250', lieu: 'compte' }),                   // virements : pas la caisse
    mvt({ montant: '1500', statut: 'En attente' }),              // pas encore là
  ];
  const s = soldesCaisse(releve, []);
  v('le relevé du 30/08 : EUR 46 683,00 — comme la vue SQL le même jour',
    egal(s, [{ devise: 'EUR', solde: 46683, depuisArrete: '' }]));

  const avecChange = [...releve, mvt({ sens: 'change', montant: '1000', montantContrepartie: '47000', deviseContrepartie: 'TRY' })];
  const s2 = soldesCaisse(avecChange, []);
  v('un change EUR→TL : l\'euro baisse, la livre naît — DEUX soldes, jamais un total mixte',
    egal(s2, [{ devise: 'EUR', solde: 45683, depuisArrete: '' }, { devise: 'TRY', solde: 47000, depuisArrete: '' }]));
  v('…et la perte au change ne se dissout plus : elle est LA différence entre les deux lignes du mouvement',
    deltasCaisse(avecChange[5]).length === 2);

  const avecRemise = [...avecChange, mvt({ sens: 'remise', montant: '45000' })];
  v('« j\'ai rendu » diminue la caisse EUR', soldesCaisse(avecRemise, [])[0].solde === 683);

  /* L'arrêté vaut FIN de journée : sa base remplace l'historique, seuls les
     mouvements STRICTEMENT postérieurs s'ajoutent. */
  const arrete: Arrete = { id: 'a1', date: '2026-08-30', devise: 'EUR', montantCompte: 3240, montantCalcule: 46683, ecart: -43443, par: 'ceyda', notes: '', createdAt: '2026-08-30T20:00:00Z' };
  const apres = [
    mvt({ montant: '100', date: '2026-08-31' }),                 // après : compte
    mvt({ montant: '999', date: '2026-08-30' }),                 // jour de l'arrêté : déjà dans le tiroir compté
    mvt({ montant: '888', date: '2026-08-29', createdAt: '2026-09-01T10:00:00Z' }), // saisie APRÈS l'arrêté, datée AVANT : déjà comptée
  ];
  v('base = le comptage (3 240), + les seuls mouvements datés APRÈS l\'arrêté → 3 340',
    egal(soldesCaisse(apres, [arrete]), [{ devise: 'EUR', solde: 3340, depuisArrete: '2026-08-30' }]));
  const arrete2: Arrete = { ...arrete, id: 'a2', date: '2026-08-31', montantCompte: 5000, createdAt: '2026-08-31T20:00:00Z' };
  v('deux arrêtés : le plus récent fait la base', soldesCaisse(apres, [arrete, arrete2])[0].solde === 5000);
}

console.log('\n=== 5. Le taux : calculé à l\'affichage, stocké nulle part ===');
{
  v('1 000 € → 47 000 TL : taux 47', tauxDuChange({ montant: '1000', montantContrepartie: '47000' }) === 47);
  v('montant nul ou illisible → null, pas Infinity',
    tauxDuChange({ montant: '0', montantContrepartie: '47000' }) === null
      && tauxDuChange({ montant: 'abc', montantContrepartie: '47000' }) === null);
}

console.log('\n=== 6. Zeynalov en euros, les autres en livres — lu sur la référence ===');
{
  v('med_azar_zeynalov → EUR', devisePourPaiementChirurgien('med_azar_zeynalov') === 'EUR');
  v('med_anvar_ahmedov → TRY ; vide → TRY',
    devisePourPaiementChirurgien('med_anvar_ahmedov') === 'TRY' && devisePourPaiementChirurgien('') === 'TRY');
}

console.log('\n=== 7. La saisie de mémoire se signale — une information, pas une faute ===');
{
  v('mouvement daté du jour de sa saisie : rien', !estSaisieDeMemoire(mvt({ date: '2026-08-30', createdAt: '2026-08-30T22:00:00Z' })));
  v('changé à 11 h, saisi le lendemain : « de mémoire »', estSaisieDeMemoire(mvt({ date: '2026-08-30', createdAt: '2026-08-31T08:00:00Z' })));
  v('sans createdAt (banc) : rien — on ne signale pas sur du vide', !estSaisieDeMemoire({ date: '2026-08-30', createdAt: undefined }));
}

console.log('\n=== 8. Le rapprochement : l\'écart se voit avant que la patiente reparte ===');
{
  const mouvements = [
    mvt({ patientId: 'p1', montant: '5000' }),
    mvt({ patientId: 'p1', montant: '500' }),                    // l'extra acheté sur place
    mvt({ patientId: 'p1', montant: '999', statut: 'En attente' }), // pas encaissé : pas compté
    mvt({ patientId: 'p3', montant: '100', lieu: 'compte' }),    // un virement COMPTE : encaissé quand même
  ];
  const factures = new Map([['p1', 5000], ['p2', 3000], ['p3', 100]]);
  const paiements = [{ patientId: 'p1', montant: 5000 } as Paiement];
  const lignes = rapprochementParPatiente(mouvements, factures, paiements);
  const p1 = lignes.find((l) => l.patientId === 'p1')!;
  const p2 = lignes.find((l) => l.patientId === 'p2')!;
  const p3 = lignes.find((l) => l.patientId === 'p3')!;
  v('p1 : encaissé 5 500 (extra compris), facturé 5 000, écart +500 — l\'extra doit finir sur la facture',
    p1.encaisse === 5500 && p1.facture === 5000 && p1.ecart === 500);
  v('…et l\'AUTRE registre (nw_paiements) dit 5 000 : l\'écart entre registres se montre, il ne s\'additionne pas',
    p1.regleNw === 5000);
  v('p2 : facturée, rien d\'encaissé → écart −3 000', p2.ecart === -3000);
  v('p3 : le virement au compte est bien un encaissement', p3.encaisse === 100 && p3.ecart === 0);
  v('trié par écart absolu décroissant', lignes[0].patientId === 'p2');
}

console.log('\n=== 9. L\'écrivain : les obligations du lot vivent dans le mapper ===');
{
  const bon: Partial<Mouvement> = {
    sens: 'entree', lieu: 'caisse', devise: 'EUR', montant: '250', date: '2026-08-30',
    type: 'Encaissement', statut: '', methode: 'Espèces', patientId: 'p1', notes: '',
  };
  const row = mouvementToRow(bon, 'ceyda');
  v('un mouvement complet passe, statut par défaut « Complété », creePar = auteur',
    row.montant === '250' && row.statut === 'Complété' && row.creePar === 'ceyda');
  v('updated_at posé À LA MAIN, en ISO — finances n\'a aucun déclencheur',
    typeof row.updated_at === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(row.updated_at as string));
  v('sens manquant → REFUSÉ', /sens/.test(jette(() => mouvementToRow({ ...bon, sens: '' }, 'x'))));
  v('lieu manquant → REFUSÉ', /lieu/.test(jette(() => mouvementToRow({ ...bon, lieu: '' }, 'x'))));
  v('devise manquante → REFUSÉ — la devise facultative est la dette qu\'on vient de payer',
    /devise/.test(jette(() => mouvementToRow({ ...bon, devise: '' }, 'x'))));
  v('montant illisible → REFUSÉ à l\'écriture (l\'existant, lui, se signale)',
    /illisible/.test(jette(() => mouvementToRow({ ...bon, montant: '12a' }, 'x'))));
  v('date manquante → REFUSÉE', /date/.test(jette(() => mouvementToRow({ ...bon, date: '' }, 'x'))));
  v('un change sans contrepartie → REFUSÉ', /contrepartie/.test(jette(() => mouvementToRow({ ...bon, sens: 'change' }, 'x'))));
  v('un change EUR→EUR → REFUSÉ : un change traverse les devises',
    /identiques/.test(jette(() => mouvementToRow({ ...bon, sens: 'change', montantContrepartie: '100', deviseContrepartie: 'EUR' }, 'x'))));
  v('hors change, la contrepartie repart VIDE — pas de résidu',
    mouvementToRow({ ...bon, montantContrepartie: '99', deviseContrepartie: 'TRY' }, 'x').montant_contrepartie === '');
  v('aller-retour row → Mouvement → row : les colonnes camelCase de finances sont respectées',
    (() => { const m = rowToMouvement({ id: 'f1', patientId: 'p1', montant: '10', date: '2026-08-30', sens: 'entree', lieu: 'caisse', devise: 'EUR', creePar: 'ib' });
      const w = mouvementToRow(m, 'x'); return w.patientId === 'p1' && w.creePar === 'ib'; })());

  const a = arreteToRow({ date: '2026-08-30', devise: 'EUR', montantCompte: 3240, montantCalcule: 46683, ecart: 999999 });
  v('l\'écart d\'un arrêté est RECALCULÉ (compté − calculé) : une seule formule, jamais deux',
    a.ecart === -43443);
  v('arrêté sans date ou sans devise → REFUSÉ',
    /date/.test(jette(() => arreteToRow({ devise: 'EUR', montantCompte: 1, montantCalcule: 1 })))
      && /devise/.test(jette(() => arreteToRow({ date: '2026-08-30', montantCompte: 1, montantCalcule: 1 }))));
}

console.log('\n=== 10. Gardes de source — rien ne se supprime, rien ne stocke un taux, la vue fait foi ===');
{
  const lire = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  const dataTs = lire('../lib/data.ts');
  v('supprimer(finances) REFUSE : un mouvement s\'annule avec sa trace', /mouvement de caisse s'annule/.test(dataTs));
  v('supprimer(arretes) REFUSE : un arrêté est immuable', /arrêté de caisse est immuable/.test(dataTs));
  v('finances et caisse_arretes sont DÉCLARÉES dans la liste blanche d\'écriture',
    /'finances', 'caisse_arretes'/.test(dataTs));
  const caisseTsx = lire('../components/Caisse.tsx');
  v('l\'écran n\'appelle jamais remove() sur la caisse', !/remove\(\s*'(finances|arretes)'/.test(caisseTsx));
  v('la date des gestes propose « maintenant » par défaut (todayISO), changée en deux gestes',
    (caisseTsx.match(/useState\(todayISO\(\)\)/g) || []).length >= 4);
  v('la rafale : après un enregistrement, retour au choix du geste, pas à l\'accueil',
    /setGeste\('menu'\)/.test(caisseTsx));
  v('le solde affiché vient de la vue (data.soldesCaisse), le calcul local n\'est qu\'un repli dit',
    /data\.soldesCaisse/.test(caisseTsx) && /repli|indisponible/.test(caisseTsx));
  const migration = lire('../db/migration-20260830-lot73-caisse.sql');
  v('la migration ne crée AUCUNE colonne de taux — le taux se calcule, ne se stocke pas',
    !/taux\s+(text|numeric|integer|real)/i.test(migration));
  v('la vue est en security_invoker : elle ne contourne pas la RLS de finances',
    /security_invoker = on/.test(migration));
  v('la sauvegarde datée précède toute écriture, RLS activée dessus',
    /sauvegarde_finances_20260830 as select \* from finances/.test(migration)
      && /alter table sauvegarde_finances_20260830 enable row level security/.test(migration));
  v('aucun arrêté d\'ouverture inséré par la migration — le comptage appartient à Ceyda',
    !/insert into caisse_arretes/i.test(migration));
}

const ko = r.filter(([, ok]) => !ok);
console.log(`\n=== ${r.length - ko.length}/${r.length} contrôles au vert ===`);
if (ko.length) console.log('  échecs : ' + ko.map(([nom]) => nom).join(' · '));
process.exit(ko.length ? 1 : 0);
