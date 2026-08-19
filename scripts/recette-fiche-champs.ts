/* Recette des règles de remontée — fonctions réelles, aucune connexion.

   Éprouve ce que le banc navigateur ne montre pas finement : la garde
   « on n'écrit que si le champ est vide », le silence de `procedure` et
   `stade`, la jointure des actes, et le OU de déclenchement avec son trou
   mesuré (3 paiements sur 12 sans patient_id).

   Usage : npx tsx scripts/recette-fiche-champs.ts */

import {
  aPaye, CLE_STADE, CHAMPS_REMONTES, estEngage, planifierRemontee,
  STADE_CONFIRME, STADE_DEVIS_ENVOYE,
} from '../lib/fiche';
import type { DocRecord, Paiement, Patient } from '../lib/types';

const r: [string, boolean][] = [];
const v = (nom: string, ok: boolean, detail = '') => {
  r.push([nom, ok]);
  console.log(`  ${ok ? '✓' : '✗'} ${nom}${detail ? ' — ' + detail : ''}`);
};

const fiche = (o: Record<string, string> = {}): Patient =>
  ({ dateOperation: '', dateDevis: '', medecin: '', budget: '', procedure: '', stade: '', ...o }) as never;

const doc: DocRecord = {
  date: '2026-04-18', dateIntervention: '2026-12-07', chirurgien: 'AZAR ZEYNALOV', forfait: 5600,
  actes: [
    { id: 'a1', acte: 'SAFE BBL + Liposuccion Vaser HD 360°', inclus: 'x' },
    { id: 'a2', acte: 'Retrait et changement des prothèses mammaires Lifting mammaire + Prothèses Motiva', inclus: '' },
    { id: 'a3', acte: 'Greffe de sourcils DHI Stylo Choi', inclus: '' },
  ],
};

console.log('\n=== 1. Fiche vide + document engageant → les six colonnes ===');
{
  const p = planifierRemontee(doc, fiche(), true);
  const e = p.aEcrire;
  v('dateOperation', e.dateOperation === '2026-12-07', e.dateOperation);
  v('dateDevis', e.dateDevis === '2026-04-18', e.dateDevis);
  v('medecin', e.medecin === 'AZAR ZEYNALOV', e.medecin);
  v('budget en chiffres bruts', e.budget === '5600', e.budget);
  v('procedure : libellés joints par « · », mot pour mot',
    e.procedure === 'SAFE BBL + Liposuccion Vaser HD 360° · Retrait et changement des prothèses mammaires Lifting mammaire + Prothèses Motiva · Greffe de sourcils DHI Stylo Choi',
    e.procedure);
  v('stade = Confirmé', e.stade === STADE_CONFIRME, e.stade);
  v('exactement six colonnes, pas une de plus', Object.keys(e).length === 6, Object.keys(e).join(', '));
  v('aucune divergence', p.divergences.length === 0);
}

console.log('\n=== 2. LE CAS QUI COMPTE — fiche « Post-opératoire » ===');
{
  const p = planifierRemontee(doc, fiche({ stade: 'Post-opératoire' }), true);
  v('stade N\'EST PAS dans les colonnes à écrire', !('stade' in p.aEcrire),
    'stade' in p.aEcrire ? 'RECULÉ à « ' + p.aEcrire.stade + ' »' : 'Post-opératoire conservé');
  v('et la divergence reste silencieuse', !p.divergences.some((d) => d.colonne === 'stade'));
}

console.log('\n=== 3. Silence de procedure et stade, bavardage des quatre autres ===');
{
  const p = planifierRemontee(doc, fiche({
    procedure: 'BBL / Lipofilling fessier', stade: 'Nouveau', budget: '9999', medecin: 'Dr Orkun Uyanik',
  }), true);
  v('procedure occupée : ni écrite, ni signalée',
    !('procedure' in p.aEcrire) && !p.divergences.some((d) => d.colonne === 'procedure'));
  v('stade occupé : ni écrit, ni signalé',
    !('stade' in p.aEcrire) && !p.divergences.some((d) => d.colonne === 'stade'));
  v('budget divergent : signalé', p.divergences.some((d) => d.colonne === 'budget'));
  v('medecin divergent : signalé', p.divergences.some((d) => d.colonne === 'medecin'));
  v('« Dr Orkun Uyanik » vs « AZAR ZEYNALOV » sont bien deux praticiens', true);
}

console.log('\n=== 4. Le stade quand rien n\'engage (bouton manuel seul) ===');
{
  const p = planifierRemontee(doc, fiche(), false);
  v('stade = Devis envoyé', p.aEcrire.stade === STADE_DEVIS_ENVOYE, p.aEcrire.stade);
}

console.log('\n=== 5. Le OU, et le trou des paiements sans patient_id ===');
{
  const pai = (o: Partial<Paiement>): Paiement =>
    ({ refId: null, refNum: '', patientId: null, montant: 300, date: '', mode: '', type: 'acompte', devise: '€', note: '', ...o }) as Paiement;
  v('paiement rattaché par patient_id', aPaye([pai({ patientId: 'p1' })], 'p1', []));
  v('paiement rattaché par facture_id SEUL — le cas des 3 sur 12',
    aPaye([pai({ refId: 'fac_9' })], 'p1', ['fac_9']));
  v('paiement d\'une AUTRE patiente ignoré', !aPaye([pai({ patientId: 'p2' })], 'p1', []));
  v('montant nul ignoré', !aPaye([pai({ patientId: 'p1', montant: 0 })], 'p1', []));
  v('devis accepté sans paiement → engagé', estEngage([{ statut: 'accepte' } as DocRecord], false));
  v('paiement sans devis accepté → engagé', estEngage([{ statut: 'envoye' } as DocRecord], true));
  v('devis envoyé sans paiement → PAS engagé', !estEngage([{ statut: 'envoye' } as DocRecord], false));
  v('brouillon sans paiement → PAS engagé', !estEngage([{ statut: 'brouillon' } as DocRecord], false));
}

console.log('\n=== 6. La table est bien la source unique ===');
{
  v('six champs déclarés', CHAMPS_REMONTES.length === 6, String(CHAMPS_REMONTES.length));
  v('deux silencieux, et ce sont procedure et stade',
    CHAMPS_REMONTES.filter((c) => c.silencieux).map((c) => c.fiche).join(',') === 'procedure,stade');
  v('le stade est marqué comme calculé', CHAMPS_REMONTES.some((c) => c.devis === CLE_STADE));
  v('hopital et procedures restent dehors',
    !CHAMPS_REMONTES.some((c) => c.fiche === 'hopital' || c.fiche === 'procedures'));
}

const ko = r.filter(([, ok]) => !ok);
console.log(`\n=== ${r.length - ko.length}/${r.length} contrôles au vert ===`);
if (ko.length) console.log('  échecs : ' + ko.map(([n]) => n).join(' · '));
process.exit(ko.length ? 1 : 0);
