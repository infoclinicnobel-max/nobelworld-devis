/* Recette des statuts « classés » des devis (refuse, expire) — Veys, 19 août.

   Le point central n'est pas ce que les nouveaux états FONT, c'est ce qu'ils
   ne font PAS : un devis classé ne remonte rien, ne fait jamais foi, ne
   propose aucun stade. Trois de ces comportements sont justes PAR ACCIDENT —
   des comparaisons strictes écrites avant que ces états existent. Cette
   recette les transforme en comportements PROUVÉS : le jour où un refactor
   assouplit une comparaison, elle rougit.

   Chaque négatif a son jumeau positif sur le même montage : sans lui,
   « l'état classé est ignoré » et « rien ne se déclenche » seraient
   indiscernables.

   Usage : npx tsx scripts/recette-statuts-devis.ts */

import {
  documentQuiFaitFoi, niveauEngagement, planifierRemontee, remonteeAutomatique,
  STADE_CONFIRME, STADE_DEVIS_ENVOYE,
} from '../lib/fiche';
import { devisEstClasse, estFige, STATUTS_DEVIS_CLASSES, validiteDepassee } from '../lib/calc';
import type { DocRecord, Patient } from '../lib/types';

const r: [string, boolean][] = [];
const v = (nom: string, ok: boolean, detail = '') => {
  r.push([nom, ok]);
  console.log(`  ${ok ? '✓' : '✗'} ${nom}${detail ? ' — ' + detail : ''}`);
};

const devis = (statut: string, o: Partial<DocRecord> = {}): DocRecord =>
  ({ id: 'dev_1', numero: 'D-2026-000025', patientId: 'p1', statut, date: '2026-07-04', ...o }) as DocRecord;
const fiche = (o: Record<string, string> = {}): Patient =>
  ({ dateOperation: '', dateDevis: '', medecin: '', budget: '', procedure: '', stade: '', ...o }) as never;

console.log('\n=== 1. Un devis classé ne déclenche RIEN — et son jumeau prouve le montage ===');
{
  const niv = (statut: string) => niveauEngagement([devis(statut)], false);
  v('refusé → aucun engagement', niv('refuse') === 'aucun', niv('refuse'));
  v('expiré → aucun engagement', niv('expire') === 'aucun', niv('expire'));
  v('JUMEAU : envoyé → envoye (le montage déclenche bien)', niv('envoye') === 'envoye', niv('envoye'));
  v('JUMEAU : accepté → engage', niv('accepte') === 'engage', niv('accepte'));
  v('mais un PAIEMENT engage même un devis classé — le OU du flux tient',
    niveauEngagement([devis('refuse')], true) === 'engage');
}

console.log('\n=== 2. Le stade ne reçoit rien d\'un devis classé ===');
{
  const plan = (statut: string) =>
    planifierRemontee(devis(statut), fiche(), { engagement: niveauEngagement([devis(statut)], false) });
  v('refusé : aucune écriture, pas même le stade', Object.keys(plan('refuse').aEcrire).length === 0,
    Object.keys(plan('refuse').aEcrire).join(', ') || 'rien');
  v('expiré : aucune écriture non plus', Object.keys(plan('expire').aEcrire).length === 0);
  v('JUMEAU : envoyé écrit le stade « Devis envoyé »', plan('envoye').aEcrire.stade === STADE_DEVIS_ENVOYE);
  v('JUMEAU : accepté propose « Confirmé »', plan('accepte').aEcrire.stade === STADE_CONFIRME);
}

console.log('\n=== 3. Un devis classé ne fait jamais foi, et ne remonte jamais ===');
{
  v('remonteeAutomatique : refusé non, expiré non, accepté oui',
    !remonteeAutomatique('refuse') && !remonteeAutomatique('expire') && remonteeAutomatique('accepte'));
  v('documentQuiFaitFoi ignore un devis classé', documentQuiFaitFoi([devis('refuse'), devis('expire')], []) === null);
  const src = documentQuiFaitFoi([devis('refuse'), devis('accepte', { id: 'dev_2' })], []);
  v('JUMEAU : l\'accepté du même lot fait foi, lui', src?.doc.id === 'dev_2', String(src?.doc.id));
}

console.log('\n=== 4. Figé et classé ===');
{
  v('refusé et expiré sont FIGÉS — un document parti reste figé quel que soit son sort',
    estFige(devis('refuse')) && estFige(devis('expire')));
  v('envoyé et accepté restent figés, brouillon libre',
    estFige(devis('envoye')) && estFige(devis('accepte')) && !estFige(devis('brouillon')));
  v('devisEstClasse : refuse et expire seulement',
    devisEstClasse('refuse') && devisEstClasse('expire')
    && !devisEstClasse('envoye') && !devisEstClasse('accepte') && !devisEstClasse('brouillon')
    && !devisEstClasse('') && !devisEstClasse(null));
  v('la liste blanche porte exactement deux états', STATUTS_DEVIS_CLASSES.length === 2);
}

console.log('\n=== 5. « Validité dépassée » : une mention d\'écran, jamais un reclassement ===');
{
  const AUJOURDHUI = '2026-08-20';
  v('envoyé, validité passée → dite (le cas D-2026-000025, dépassée depuis 39 jours)',
    validiteDepassee(devis('envoye', { validite: '2026-07-12' }), AUJOURDHUI));
  v('envoyé, encore valide → rien (le cas D-2026-000041, valide jusqu\'au 25/08)',
    !validiteDepassee(devis('envoye', { validite: '2026-08-25' }), AUJOURDHUI));
  v('ACCEPTÉ à validité passée → rien — le cas D-2026-000037, devis de MARS accepté, facturé, opéré',
    !validiteDepassee(devis('accepte', { validite: '2026-08-21' }), '2026-08-22'));
  v('sans validité → rien', !validiteDepassee(devis('envoye'), AUJOURDHUI));
  v('validité illisible → rien, jamais une alerte fausse',
    !validiteDepassee(devis('envoye', { validite: 'bientôt' }), AUJOURDHUI));
}

const ko = r.filter(([, ok]) => !ok);
console.log(`\n=== ${r.length - ko.length}/${r.length} contrôles au vert ===`);
if (ko.length) console.log('  échecs : ' + ko.map(([n]) => n).join(' · '));
process.exit(ko.length ? 1 : 0);
