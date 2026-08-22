/* Recette du refus persistant — 22 août.

   Le cas : D-2026-000045 (Sofia), chirurgien « AANVAR AHMEDOV » refusé par la
   traduction, fiche restée vide, journal de fiche portant cinq succès et zéro
   mention de l'échec ; onze minutes plus tard la même faute sur D-2026-000046,
   avec une date d'opération au 5 janvier 2026. Le refus vivait dans la boucle
   par colonne, sautée hors engagement : il ne pouvait se produire qu'à
   l'acceptation — au moment du dommage.

   Trois fonctions pures de lib/fiche.ts : evaluerDocument (évaluer ≠ écrire),
   planifierRemontee (la garde de date, dans la boucle d'écriture),
   journaliserRefus (le journal dit aussi le refus, une fois). Plus une garde
   de SOURCE sur lib/data.ts et components/Devis.tsx : l'évaluation précède le
   raccourci d'engagement, les deux appelants passent la date du jour et le
   second auteur, le rapport montre le refus.

   Les VALEURS de chirurgien et de date sont les valeurs RÉELLES des dix devis
   non engagés, relevées le 22 août au soir (statut envoye ou brouillon) ; le
   vocabulaire est la table medecins le même jour (6 lignes). Un banc éprouve
   un mécanisme ; il ne décrit pas la base, qui bouge.

   Usage : npx tsx scripts/recette-refus-persistant.ts */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  evaluerDocument, journaliserRefus, journaliserRemontee, planifierRemontee, STADE_CONFIRME,
  STADE_DEVIS_ENVOYE, type EntreeJournal, type Refus,
} from '../lib/fiche';
import type { DocRecord, Patient } from '../lib/types';

const r: [string, boolean][] = [];
const v = (nom: string, ok: boolean, detail = '') => {
  r.push([nom, ok]);
  console.log(`  ${ok ? '✓' : '✗'} ${nom}${detail ? ' — ' + detail : ''}`);
};

const AUJOURDHUI = '2026-08-22';
const MEDECINS = ['Dr Akin Unal', 'Dr Anvar Ahmedov', 'Dr Azar Zeynalov', 'Dr Elif Ozturk', 'Dr Orkun Uyanik', 'Dr VSC Dental'];

/* ---- les dix devis non engagés, relevés le 22 août au soir ---- */
const DEVIS: { numero: string; statut: string; chirurgien: string; dateIntervention: string }[] = [
  { numero: 'D-2026-000023', statut: 'envoye', chirurgien: 'AZAR ZEYNALOV', dateIntervention: '2026-09-01' },
  { numero: 'D-2026-000025', statut: 'envoye', chirurgien: 'Anvar Ahmedov', dateIntervention: '2026-10-21' },
  { numero: 'D-2026-000026', statut: 'envoye', chirurgien: 'Anvar Ahmedov', dateIntervention: '' },
  { numero: 'D-2026-000027', statut: 'envoye', chirurgien: 'Anvar Ahmedov', dateIntervention: '' },
  { numero: 'D-2026-000029', statut: 'brouillon', chirurgien: 'Anvar Ahmedov', dateIntervention: '2026-06-02' },
  { numero: 'D-2026-000030', statut: 'brouillon', chirurgien: 'Anvar Ahmedov', dateIntervention: '2026-08-16' },
  { numero: 'D-2026-000033', statut: 'envoye', chirurgien: 'Anvar Ahmedov', dateIntervention: '2026-08-12' },
  { numero: 'D-2026-000041', statut: 'envoye', chirurgien: 'Anvar Ahmedov', dateIntervention: '2026-09-17' },
  { numero: 'D-2026-000043', statut: 'brouillon', chirurgien: '', dateIntervention: '' },
  { numero: 'D-2026-000046', statut: 'envoye', chirurgien: 'AANVAR AHMEDOV', dateIntervention: '2026-01-05' },
];
const doc = (o: Partial<DocRecord> = {}): DocRecord =>
  ({ numero: 'D-2026-000046', patientId: 'p1', date: '2026-08-22', chirurgien: 'AANVAR AHMEDOV',
    dateIntervention: '2026-01-05', forfait: 5500, actes: [{ id: 'a1', acte: 'Abdominoplastie', inclus: '' }],
    statut: 'envoye', ...o }) as DocRecord;
const fiche = (o: Record<string, string> = {}): Patient =>
  ({ id: 'p1', prenom: 'SHERLINE', nom: 'DESULME DANTICA', stade: '', medecin: '', dateOperation: '',
    dateDevis: '', budget: '', procedure: '', historique: '', ...o }) as unknown as Patient;
const evaluer = (d: Partial<DocRecord>, medecins: readonly string[] | undefined = MEDECINS, jour = AUJOURDHUI) =>
  evaluerDocument(doc(d), medecins, jour);
const champs = (refus: Refus[]) => refus.map((x) => x.champ).sort().join('+');

console.log('\n=== 1. evaluerDocument — les dix devis réels, et ce qu\'ils attendent ===');
{
  const parDevis = DEVIS.map((d) => ({ numero: d.numero, refus: evaluer(d) }));
  const dates = parDevis.filter((x) => x.refus.some((y) => y.champ === 'dateOperation')).map((x) => x.numero);
  const chir = parDevis.filter((x) => x.refus.some((y) => y.champ === 'medecin')).map((x) => x.numero);
  v('quatre dates d\'opération déjà passées : D-29, D-30, D-33, D-46',
    dates.join(',') === 'D-2026-000029,D-2026-000030,D-2026-000033,D-2026-000046', dates.join(','));
  v('un chirurgien inconnu : D-46 « AANVAR AHMEDOV »', chir.join(',') === 'D-2026-000046', chir.join(','));
  v('D-46 cumule les deux', champs(parDevis[9].refus) === 'dateOperation+medecin');
  v('D-43, chirurgien VIDE : rien à refuser — un vide n\'est pas une faute', parDevis[8].refus.length === 0);
  v('« AZAR ZEYNALOV » (D-23) → traduit, pas refusé ; sa date du 1er septembre non plus', parDevis[0].refus.length === 0);
  v('« Anvar Ahmedov » sans « Dr » → traduit (sept devis)', parDevis.slice(1, 8).every((x) => !x.refus.some((y) => y.champ === 'medecin')));
  v('cinq refus au total sur les dix — le compte de l\'orchestrateur, retrouvé par l\'instrument du code',
    parDevis.reduce((s, x) => s + x.refus.length, 0) === 5);
}

console.log('\n=== 2. evaluerDocument — les bornes ===');
{
  v('« Dr Anvar » (sans patronyme) → refusé', champs(evaluer({ chirurgien: 'Dr Anvar', dateIntervention: '' })) === 'medecin');
  v('« Dr. Anvar AHMEDOV » → traduit (ponctuation, casse)', evaluer({ chirurgien: 'Dr. Anvar AHMEDOV', dateIntervention: '' }).length === 0);
  v('vocabulaire PRÉSENT et vide → tout chirurgien refusé, et la raison le dit',
    /vide ou illisible/.test(evaluer({ chirurgien: 'Anvar Ahmedov', dateIntervention: '' }, [])[0]?.pourquoi || ''));
  /* Appel DIRECT : passer `undefined` au helper déclencherait sa valeur par
     défaut (le vocabulaire), et le contrôle évaluerait l'inverse de ce qu'il
     dit — c'est arrivé à la première exécution. */
  v('vocabulaire ABSENT (appelant ancien) → pas d\'évaluation du chirurgien',
    evaluerDocument(doc({ chirurgien: 'AANVAR AHMEDOV', dateIntervention: '' }), undefined, AUJOURDHUI).length === 0);
  v('date du jour même → pas passée', evaluer({ chirurgien: '', dateIntervention: AUJOURDHUI }).length === 0);
  v('veille → passée', champs(evaluer({ chirurgien: '', dateIntervention: '2026-08-21' })) === 'dateOperation');
  v('date illisible (« 05/01/2026 ») → refusée comme illisible',
    /pas une date lisible/.test(evaluer({ chirurgien: '', dateIntervention: '05/01/2026' })[0]?.pourquoi || ''));
  v('`aujourdhui` illisible → la date n\'est pas jugée passée (rien deviné)',
    evaluer({ chirurgien: '', dateIntervention: '2026-01-05' }, MEDECINS, '').length === 0);
  const p = evaluer({ chirurgien: '', dateIntervention: '2026-01-05' })[0];
  v('le « pourquoi » est STABLE : pas d\'« aujourd\'hui » dedans (clé de dédoublonnage)',
    !!p && !/aujourd/.test(p.pourquoi) && /2026-01-05/.test(p.pourquoi));
  v('la valeur refusée est transmise telle quelle', evaluer({ chirurgien: ' AANVAR AHMEDOV ', dateIntervention: '' })[0]?.valeur === 'AANVAR AHMEDOV');
}

console.log('\n=== 3. planifierRemontee — la garde de date dans la boucle d\'écriture ===');
{
  const engage = planifierRemontee(doc(), fiche(), { engagement: 'engage', medecins: MEDECINS, aujourdhui: AUJOURDHUI });
  v('engagé, fiche vide, date passée : dateOperation N\'EST PAS écrite', !('dateOperation' in engage.aEcrire));
  v('… et c\'est DIT dans « laissés », avec la raison', engage.laisses.some((l) => /déjà passée/.test(l.pourquoi) && /non écrite/.test(l.pourquoi)));
  v('… les autres colonnes partent normalement (budget, date du devis, intervention, stade)',
    engage.aEcrire.budget === '5500' && engage.aEcrire.dateDevis === '2026-08-22' && !!engage.aEcrire.procedure && engage.aEcrire.stade === STADE_CONFIRME);
  v('… le chirurgien inconnu est refusé (pas écrit) et nommé', !('medecin' in engage.aEcrire) && engage.chirurgienInconnu === 'AANVAR AHMEDOV');
  v('… le plan porte les deux refus', champs(engage.refus) === 'dateOperation+medecin');
  const futur = planifierRemontee(doc({ dateIntervention: '2026-10-13' }), fiche(), { engagement: 'engage', medecins: MEDECINS, aujourdhui: AUJOURDHUI });
  v('JUMEAU : même montage, date future → dateOperation écrite', futur.aEcrire.dateOperation === '2026-10-13');
  const envoye = planifierRemontee(doc(), fiche(), { engagement: 'envoye', medecins: MEDECINS, aujourdhui: AUJOURDHUI });
  v('ENVOYÉ : le stade seul s\'écrit, comme avant', Object.keys(envoye.aEcrire).join(',') === 'stade' && envoye.aEcrire.stade === STADE_DEVIS_ENVOYE);
  v('… mais les deux refus sont déjà évalués — des semaines avant l\'acceptation', champs(envoye.refus) === 'dateOperation+medecin');
  const aucun = planifierRemontee(doc({ statut: 'brouillon' }), fiche(), { engagement: 'aucun', medecins: MEDECINS, aujourdhui: AUJOURDHUI });
  v('BROUILLON : rien n\'est écrit, les refus sont évalués quand même', Object.keys(aucun.aEcrire).length === 0 && champs(aucun.refus) === 'dateOperation+medecin');
  const sansJour = planifierRemontee(doc(), fiche(), { engagement: 'engage', medecins: MEDECINS });
  v('sans `aujourdhui` (appelant ancien) la date passée s\'écrirait : la garde de source vérifie que le flux le passe',
    sansJour.aEcrire.dateOperation === '2026-01-05');
  const occupee = planifierRemontee(doc(), fiche({ dateOperation: '2026-03-01' }), { engagement: 'engage', medecins: MEDECINS, aujourdhui: AUJOURDHUI });
  v('fiche déjà datée : la date passée du document ne produit ni écriture ni divergence — laissée, dite',
    !('dateOperation' in occupee.aEcrire) && !occupee.divergences.some((d) => d.colonne === 'dateOperation') && occupee.laisses.some((l) => /déjà passée/.test(l.pourquoi)));
  /* Le choix du 22 août au soir : un dossier CLÔTURÉ n'est pas une exception.
     Ashley Munao — « Clôturé ✓ », devis sans numéro, « Dr Anvar », medecin
     vide depuis le 24 juillet : si son devis est rouvert et enregistré, le
     refus est évalué et journalisé comme sur tout autre dossier. Un dossier
     qu'on rouvre est un dossier qu'on modifie ; le refus explique un vide
     qu'aucun journal n'expliquait. */
  const clos = planifierRemontee(doc({ numero: '', chirurgien: 'Dr Anvar', dateIntervention: '' }), fiche({ stade: 'Clôturé ✓' }),
    { engagement: 'engage', medecins: MEDECINS, aujourdhui: AUJOURDHUI });
  v('dossier « Clôturé ✓ » (Munao) : le refus du chirurgien est évalué quand même', champs(clos.refus) === 'medecin' && clos.chirurgienInconnu === 'Dr Anvar');
  v('… le stade, lui, ne recule pas : « Clôturé ✓ » reste, et c\'est dit', !('stade' in clos.aEcrire) && clos.laisses.some((l) => /Clôturé/.test(l.pourquoi)));
  const journalClos = journaliserRefus('[]', clos.refus, { u: 'veys', date: '2026-08-23', heure: '10:00', motif: 'Remontée automatique du devis' });
  v('… et le journal reçoit l\'entrée — aucune règle de stade dans journaliserRefus', journalClos.nouvelles.length === 1 && /Dr Anvar/.test(journalClos.nouvelles[0].motif));
}

console.log('\n=== 3 bis. Les deux factures vivantes du recensement — bancs posés AVANT tout lot « facture » ===');
{
  /* Relevées en base le 22 août tard. Aujourd'hui, ni l'une ni l'autre ne
     parle : une facture ne parle qu'à sa création. Si un lot les faisait parler
     à chaque enregistrement, voici ce que la règle ACTUELLE en ferait — fixé
     ici pour que ce lot, s'il vient, se mesure contre ces deux cas et non
     contre une intuition. */
  // F-2026-000028 — Sofia : porte la faute et la date. Sa fiche a déjà la date (écrite par le devis 52 s plus tôt).
  /* `date` des deux factures non relevée : alignée sur la fiche, pour que le
     banc ne parle que du chirurgien et de la date d'opération — une date de
     document différente de dateDevis ferait une divergence, vraie mais hors
     sujet (le premier passage de ce banc l'a montré). */
  const f28: Partial<DocRecord> = { numero: 'F-2026-000028', date: '2026-08-11', chirurgien: 'AANVAR AHMEDOV', dateIntervention: '2026-09-06', forfait: 5500, statut: 'envoye' };
  const sofia = fiche({ prenom: 'SOFIA', nom: 'BENABEDRABOU', stade: 'Confirmé', dateOperation: '2026-09-06', dateDevis: '2026-08-11', budget: '5500' });
  const pS = planifierRemontee(doc(f28), sofia, { engagement: 'engage', medecins: MEDECINS, aujourdhui: AUJOURDHUI });
  v('F-28 (Sofia) parlerait : le chirurgien est REFUSÉ — le bon comportement, la faute est sur la facture',
    champs(pS.refus) === 'medecin' && !('medecin' in pS.aEcrire));
  v('… sa date, déjà sur la fiche et identique, n\'est ni réécrite ni en divergence',
    !('dateOperation' in pS.aEcrire) && pS.dejaConformes.includes("date d'opération"));
  // F-2026-000016 — Alma : ORPHELINE. Sans devis, sans chirurgien, sans date. Elle gagne par son rang, et ne porte rien.
  const f16: Partial<DocRecord> = { numero: 'F-2026-000016', date: '2026-07-28', chirurgien: '', dateIntervention: '', forfait: 6400, actes: [], statut: 'envoye' };
  const almaReparee = fiche({ prenom: 'Gaëlle', nom: 'Alma', stade: 'Confirmé', medecin: 'Dr Anvar Ahmedov', dateOperation: '2027-03-09', dateDevis: '2026-07-28', budget: '6400' });
  const pA = planifierRemontee(doc(f16), almaReparee, { engagement: 'engage', medecins: MEDECINS, aujourdhui: AUJOURDHUI });
  v('F-16 (Alma, orpheline) parlerait après une réparation à la main : elle n\'ÉCRIT rien',
    Object.keys(pA.aEcrire).length === 0);
  v('… et n\'EFFACE rien — aucune divergence, aucun refus : une valeur absente n\'est pas une valeur',
    pA.divergences.length === 0 && pA.refus.length === 0);
  const almaVide = fiche({ prenom: 'Gaëlle', nom: 'Alma', stade: 'Confirmé', budget: '6400' });
  const pV = planifierRemontee(doc(f16), almaVide, { engagement: 'engage', medecins: MEDECINS, aujourdhui: AUJOURDHUI });
  v('… et sur une fiche encore vide, elle ne RÉPARE ni le chirurgien ni la date d\'opération : un document vide qui parle reste vide',
    !('medecin' in pV.aEcrire) && !('dateOperation' in pV.aEcrire) && pV.refus.length === 0);
}

console.log('\n=== 4. journaliserRefus — le journal dit aussi le refus, une fois ===');
{
  const sig = { u: 'veys', date: '2026-08-22', heure: '09:43', motif: 'Remontée automatique du devis D-2026-000046' };
  const refus = evaluer({});
  const humain: EntreeJournal = { u: 'ceyda', date: '2026-08-20', heure: '11:02', champ: 'telephone', ancien: '', nouveau: '+33…', motif: 'Appel' };
  const premiere = journaliserRefus(JSON.stringify([humain]), refus, sig);
  const arr = JSON.parse(premiere.journal || '[]') as EntreeJournal[];
  v('deux entrées nouvelles (chirurgien, date), l\'entrée humaine conservée devant', arr.length === 3 && arr[0].champ === 'telephone' && premiere.nouvelles.length === 2);
  const med = arr.find((e) => e.champ === 'medecin')!;
  v('format du CRM : u, date, heure, champ, ancien, nouveau, motif', ['u', 'date', 'heure', 'champ', 'ancien', 'nouveau', 'motif'].every((k) => k in med));
  v('`nouveau` VIDE — rien n\'a été écrit, le dire autrement serait le mensonge inverse', med.nouveau === '' && med.ancien === '');
  v('le motif porte la valeur refusée, la raison, « non écrit » et le document source',
    /AANVAR AHMEDOV/.test(med.motif) && /aucun médecin/.test(med.motif) && /non écrit/.test(med.motif) && /D-2026-000046/.test(med.motif));
  v('la date refusée est journalisée de même', /2026-01-05/.test(arr.find((e) => e.champ === 'dateOperation')!.motif));
  const seconde = journaliserRefus(premiere.journal, refus, { ...sig, date: '2026-08-29', heure: '10:00' });
  v('RÉPÉTITION : le même document réenregistré une semaine après ne repose rien', seconde.journal === null && seconde.nouvelles.length === 0);
  const autre = journaliserRefus(premiere.journal, evaluer({ chirurgien: 'ANVAR AHMEDOF', dateIntervention: '' }), sig);
  v('JUMEAU : une AUTRE faute sur le même champ pose une nouvelle entrée', autre.nouvelles.length === 1 && /AHMEDOF/.test(autre.nouvelles[0].motif));
  const autreDoc = journaliserRefus(premiere.journal, refus, { ...sig, motif: 'Remontée automatique de la facture F-2026-000030' });
  v('le même refus venu d\'un AUTRE document (facture) se journalise — c\'est un autre événement', autreDoc.nouvelles.length === 2);
  v('aucun refus → rien', journaliserRefus('[]', [], sig).journal === null);
  v('journal vide → tableau neuf', JSON.parse(journaliserRefus('', refus, sig).journal || '[]').length === 2);
  v('journal ILLISIBLE (pas un tableau JSON) → null, jamais écrasé', journaliserRefus('{pas du json', refus, sig).journal === null && journaliserRefus('{"a":1}', refus, sig).journal === null);
  /* Enchaînement avec journaliserRemontee, comme dans lib/data.ts : les refus
     d'abord, les colonnes écrites ensuite, un seul tableau. */
  const ecrits = journaliserRemontee(premiere.journal, { stade: STADE_DEVIS_ENVOYE }, () => '', sig);
  const tout = JSON.parse(ecrits || '[]') as EntreeJournal[];
  v('enchaîné avec journaliserRemontee : refus + colonne écrite dans le MÊME journal', tout.length === 4 && tout[3].champ === 'stade' && tout[3].nouveau === STADE_DEVIS_ENVOYE);
}

console.log('\n=== 5. Garde de source — l\'évaluation précède le raccourci, les appelants passent le jour ===');
{
  const lire = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  const data = lire('../lib/data.ts');
  const corps = data.slice(data.indexOf('export async function remonterVersFiche'));
  const iEval = corps.indexOf('evaluerDocument(');
  /* Le raccourci, c'est le `if` qui rend la main — pas la condition du ternaire
     qui décide de journaliser, qui porte les mêmes mots un peu plus haut. */
  const iRaccourci = corps.indexOf("if (engagement === 'aucun' && !forcer) {");
  v('remonterVersFiche évalue le document AVANT le raccourci d\'engagement', iEval > 0 && iRaccourci > 0 && iEval < iRaccourci);
  /* La limite nommée, fixée pour qu'on la voie bouger : la facture vivante rend
     la main AVANT l'évaluation. Le devis d'Alma (F-2026-000016 envoyée) ne
     journalise donc rien — c'est voulu aujourd'hui (le devis ne parle plus au
     CRM), et ce contrôle rougira le jour où l'ordre change, pour que le
     changement soit décidé, pas subi. */
  const iFactureVivante = corps.indexOf('factureEstVivante(f.statut)');
  v('… mais la facture vivante rend la main AVANT l\'évaluation : limite nommée (Alma)', iFactureVivante > 0 && iFactureVivante < iEval);
  v('… et journalise les refus (journaliserRefus) avant de rendre la main', corps.indexOf('journaliserRefus(') > 0 && corps.indexOf('journaliserRefus(') < iRaccourci);
  v('… passe `aujourdhui` à planifierRemontee', /planifierRemontee\(devis[\s\S]*?aujourdhui[\s\S]*?\}\)/.test(corps));
  v('… écrit le second journal (nw_historique) pour chaque refus nouveau', /for \(const n of journalRefus\.nouvelles\)[\s\S]*?journaliser\(/.test(corps));
  v('poserAuCalendrier passe `aujourdhui` à planifierRendezVous', /suffixe: suffixeRdv\(\), aujourdhui: todayISO\(\)/.test(data));
  const devisTsx = lire('../components/Devis.tsx');
  /* Un niveau de parenthèses imbriquées : `signatureJournal(user)` fermerait
     une capture naïve en `[^)]*` avant `userLabel(user)`. */
  const appels = devisTsx.match(/remonterVersFiche\((?:[^()]|\([^()]*\))*\)/g) || [];
  v('les deux appelants passent la signature de fiche ET le nom nw_historique', appels.length === 2 && appels.every((a) => /signatureJournal\(user\), userLabel\(user\)/.test(a)));
  v('le rapport de fiche s\'ouvre sur un refus, dans les deux flux', (devisTsx.match(/\|\| r\.refus\.length \|\|/g) || []).length === 2);
  v('la fenêtre de rapport nomme les refus', /r\.refus\.map\(/.test(devisTsx));
}

const ko = r.filter(([, ok]) => !ok);
console.log(`\n=== ${r.length - ko.length}/${r.length} contrôles au vert ===`);
if (ko.length) console.log('  échecs : ' + ko.map(([n]) => n).join(' · '));
process.exit(ko.length ? 1 : 0);
