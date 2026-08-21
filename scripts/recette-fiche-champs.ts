/* Recette des règles de remontée — fonctions réelles, aucune connexion.

   Éprouve ce que le banc navigateur ne montre pas finement : la garde
   « on n'écrit que si le champ est vide », le silence de `procedure` et
   `stade`, la jointure des actes, et le OU de déclenchement avec son trou
   mesuré (3 paiements sur 12 sans patient_id).

   Usage : npx tsx scripts/recette-fiche-champs.ts */

import {
  annulationBloqueConfirmation, aPaye, CLE_STADE, CHAMPS_REMONTES, documentQuiFaitFoi,
  ECHELLE_STADE, journaliserRemontee, niveauEngagement, planifierRemontee,
  rangStade, STADE_CONFIRME, STADE_DEVIS_ENVOYE,
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
  const p = planifierRemontee(doc, fiche(), { engagement: 'engage' });
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
  const p = planifierRemontee(doc, fiche({ stade: 'Post-opératoire' }), { engagement: 'engage' });
  v('stade N\'EST PAS dans les colonnes à écrire', !('stade' in p.aEcrire),
    'stade' in p.aEcrire ? 'RECULÉ à « ' + p.aEcrire.stade + ' »' : 'Post-opératoire conservé');
  v('et la divergence reste silencieuse', !p.divergences.some((d) => d.colonne === 'stade'));
}

console.log('\n=== 3. Silence de procedure et stade, bavardage des quatre autres ===');
{
  const p = planifierRemontee(doc, fiche({
    procedure: 'BBL / Lipofilling fessier', stade: 'Clôturé ✓', budget: '9999', medecin: 'Dr Orkun Uyanik',
  }), { engagement: 'engage' });
  v('procedure occupée : ni écrite, ni signalée',
    !('procedure' in p.aEcrire) && !p.divergences.some((d) => d.colonne === 'procedure'));
  v('stade plus avancé : ni écrit, ni signalé',
    !('stade' in p.aEcrire) && !p.divergences.some((d) => d.colonne === 'stade'));
  v('budget divergent : signalé', p.divergences.some((d) => d.colonne === 'budget'));
  v('medecin divergent : signalé', p.divergences.some((d) => d.colonne === 'medecin'));
  v('« Dr Orkun Uyanik » vs « AZAR ZEYNALOV » sont bien deux praticiens', true);
}

console.log('\n=== 4. Le stade quand rien n\'engage (bouton manuel seul) ===');
{
  const p = planifierRemontee(doc, fiche(), { engagement: 'envoye' });
  v('stade = Devis envoyé', p.aEcrire.stade === STADE_DEVIS_ENVOYE, p.aEcrire.stade);
  v('et RIEN d\'autre : un devis envoyé n\'écrit que le stade',
    Object.keys(p.aEcrire).length === 1, Object.keys(p.aEcrire).join(', '));
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
  const niv = (statut: string, paye: boolean) => niveauEngagement([{ statut } as DocRecord], paye);
  v('devis accepté sans paiement → engage', niv('accepte', false) === 'engage', niv('accepte', false));
  v('paiement sans devis accepté → engage', niv('envoye', true) === 'engage', niv('envoye', true));
  v('devis envoyé sans paiement → envoye', niv('envoye', false) === 'envoye', niv('envoye', false));
  v('brouillon sans paiement → aucun', niv('brouillon', false) === 'aucun', niv('brouillon', false));
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

console.log('\n=== 7. L\'échelle du stade, aux bornes ===');
{
  v('vide → -1', rangStade('') === -1);
  ECHELLE_STADE.forEach((e, i) => v(`« ${e} » → ${i}`, rangStade(e) === i, String(rangStade(e))));
  v('« Clôturé » sans le ✓ → reconnu rang 4', rangStade('Clôturé') === 4, String(rangStade('Clôturé')));
  v('« confirmé » en minuscules → rang 2', rangStade('confirmé') === 2, String(rangStade('confirmé')));
  v('« En cours » → hors échelle (null)', rangStade('En cours') === null, String(rangStade('En cours')));
}

console.log('\n=== 8. LA MORSURE 1 — le stade ne recule jamais ===');
{
  const p = planifierRemontee(doc, fiche({ stade: 'Post-opératoire' }), { engagement: 'engage' });
  v('Post-opératoire (3) face à Confirmé (2) : pas écrit', !('stade' in p.aEcrire),
    'stade' in p.aEcrire ? 'RECULÉ à « ' + p.aEcrire.stade + ' »' : 'conservé');
  v('et la raison est dite', p.laisses.some((l) => l.libelle === 'stade' && /déjà à/.test(l.pourquoi)),
    p.laisses.map((l) => l.pourquoi).join(' | ') || 'aucune');
  const q = planifierRemontee(doc, fiche({ stade: 'Clôturé ✓' }), { engagement: 'engage' });
  v('Clôturé ✓ (4) : pas écrit non plus', !('stade' in q.aEcrire));
}

console.log('\n=== 9. LA MORSURE 2 — mais il AVANCE quand le rang monte ===');
{
  const p = planifierRemontee(doc, fiche({ stade: 'Devis envoyé' }), { engagement: 'engage' });
  v('Devis envoyé (1) → Confirmé (2) : ÉCRIT', p.aEcrire.stade === STADE_CONFIRME,
    p.aEcrire.stade ? '« ' + p.aEcrire.stade + ' »' : 'BLOQUÉ — la fiche ne peut plus avancer');
  const q = planifierRemontee(doc, fiche({ stade: 'Nouveau' }), { engagement: 'engage' });
  v('Nouveau (0) → Confirmé (2) : ÉCRIT', q.aEcrire.stade === STADE_CONFIRME, q.aEcrire.stade);
  const w = planifierRemontee(doc, fiche({ stade: 'Confirmé' }), { engagement: 'engage' });
  v('Confirmé (2) face à Confirmé (2) : pas de réécriture', !('stade' in w.aEcrire));
}

console.log('\n=== 10. Hors échelle : fiche intacte, ET portée au rapport ===');
{
  const p = planifierRemontee(doc, fiche({ stade: 'En cours' }), { engagement: 'engage' });
  v('rien n\'est écrit dans stade', !('stade' in p.aEcrire));
  v('la valeur est remontée pour le rapport', p.stadeHorsEchelle === 'En cours', String(p.stadeHorsEchelle));
  v('et la raison est dite', p.laisses.some((l) => /hors de l/.test(l.pourquoi)));
}

console.log('\n=== 11. Le bouton manuel : la donnée, jamais l\'avancement ===');
{
  const p = planifierRemontee(doc, fiche(), { engagement: 'aucun', forcerDonnees: true });
  v('les cinq colonnes de données sont écrites', Object.keys(p.aEcrire).length === 5,
    Object.keys(p.aEcrire).join(', '));
  v('le stade n\'est PAS écrit sur un brouillon', !('stade' in p.aEcrire));
}

/* ------------------------------------------------- la clause d'annulation

   Le MÊME montage pour les trois contrôles, et c'est le point : le négatif
   seul ne prouve rien. Si l'avancement était débranché, « le stade n'a pas
   bougé » serait vrai aussi — « la garde a retenu » et « rien ne s'est
   produit » sont indiscernables. Le jumeau positif (13) passe le même chemin
   — documentQuiFaitFoi, niveauEngagement, planifierRemontee, comme le flux et
   le rattrapage — et exige l'écriture : il prouve que 12 échoue pour la bonne
   raison. Les deux se lisent ensemble ou pas du tout. */
const monter = (stadeFiche: string, statutFacture: string) => {
  const sesDevis = [{ ...doc, id: 'dev_1', patientId: 'p1', statut: 'accepte' } as DocRecord];
  const sesFactures = [{ ...doc, id: 'fac_1', patientId: 'p1', statut: statutFacture } as DocRecord];
  const src = documentQuiFaitFoi(sesDevis, sesFactures);
  const engagement = niveauEngagement(sesDevis, false);
  return planifierRemontee(src!.doc, fiche({ stade: stadeFiche }), { engagement, factures: sesFactures });
};

console.log('\n=== 12. LA CLAUSE — devis accepté, facture ANNULÉE : le stade ne bouge pas ===');
{
  const p = monter(STADE_DEVIS_ENVOYE, 'annulee');
  v('stade N\'EST PAS écrit — le cas Tresor', !('stade' in p.aEcrire),
    'stade' in p.aEcrire ? 'PROMU à « ' + p.aEcrire.stade + ' »' : 'Devis envoyé conservé');
  v('et la raison est dite', p.laisses.some((l) => l.libelle === 'stade' && /annulée/.test(l.pourquoi)),
    p.laisses.map((l) => l.pourquoi).join(' | ') || 'aucune');
}

console.log('\n=== 13. SON JUMEAU POSITIF — même montage, facture ENVOYÉE : Confirmé ===');
{
  const p = monter(STADE_DEVIS_ENVOYE, 'envoye');
  v('stade = Confirmé — l\'avancement est bien branché', p.aEcrire.stade === STADE_CONFIRME,
    p.aEcrire.stade ? '« ' + p.aEcrire.stade + ' »' : 'RIEN — le montage n\'appelle rien, le 12 ne prouve rien');
}

console.log('\n=== 14. JAMAIS EN ARRIÈRE — même montage, fiche « Clôturé ✓ » : rien ne bouge ===');
{
  const p = monter('Clôturé ✓', 'envoye');
  v('stade N\'EST PAS écrit — le cas Munao clôturé', !('stade' in p.aEcrire),
    'stade' in p.aEcrire ? 'RECULÉ à « ' + p.aEcrire.stade + ' »' : 'Clôturé ✓ conservé');
}

console.log('\n=== 15. La clause aux bornes ===');
{
  const fac = (statut: string) => ({ id: 'f', statut } as DocRecord);
  v('annulée seule → bloque', annulationBloqueConfirmation([fac('annulee')]));
  v('annulée + vivante → ne bloque PAS (le futur « annuler et remplacer »)',
    !annulationBloqueConfirmation([fac('annulee'), fac('envoye')]));
  v('annulée + brouillon → bloque (un brouillon n\'engage personne)',
    annulationBloqueConfirmation([fac('annulee'), fac('brouillon')]));
  v('aucune facture → ne bloque pas', !annulationBloqueConfirmation([]));
  v('sans la liste (appelant ancien) → ne bloque pas, la remontée reste entière',
    planifierRemontee(doc, fiche(), { engagement: 'engage' }).aEcrire.stade === STADE_CONFIRME);
}

/* --------------------------------------------------- le journal de fiche

   La remontée en service a écrit Cindy, Diallo et El Acmaoui sans laisser une
   ligne dans `patients.historique`, pendant que le CRM y journalise les
   corrections humaines. Désormais la trace part avec l'écriture ; ces
   contrôles fixent son format — celui des entrées existantes du CRM. */
console.log('\n=== 16. Le journal de fiche : la remontée laisse une trace ===');
{
  const sig = { u: 'veys', date: '2026-08-19', heure: '18:00', motif: 'Remontée automatique du devis D-2026-000040' };
  /* L'entrée réelle de la fiche Annen, écrite par le CRM le 17 août. */
  const existant = JSON.stringify([{
    u: 'veys', date: '2026-08-17', heure: '09:52', champ: 'dateOperation',
    ancien: '', nouveau: '2026-08-24', motif: 'Demande du patient',
  }]);
  const j = journaliserRemontee(existant, { medecin: 'ANVAR AHMEDOV', stade: 'Confirmé' },
    (c) => (c === 'stade' ? 'Devis envoyé' : ''), sig);
  const arr = JSON.parse(j || '[]') as Record<string, string>[];
  v('une entrée PAR colonne écrite, après les existantes', arr.length === 3, String(arr.length));
  v("l'entrée humaine d'origine est intacte", arr[0]?.motif === 'Demande du patient');
  const m = arr.find((e) => e.champ === 'medecin');
  v('champ, ancien, nouveau, auteur, document portés',
    !!m && m.ancien === '' && m.nouveau === 'ANVAR AHMEDOV' && m.u === 'veys' && /D-2026-000040/.test(m.motif));
  const s = arr.find((e) => e.champ === 'stade');
  v("le stade journalise l'étage quitté", !!s && s.ancien === 'Devis envoyé' && s.nouveau === 'Confirmé');
}

console.log('\n=== 17. Le journal aux bornes : tracer sans jamais détruire ===');
{
  const sig = { u: 'veys', date: '2026-08-19', heure: '18:00', motif: 'x' };
  v('journal vide → tableau créé',
    (JSON.parse(journaliserRemontee('', { budget: '5600' }, () => '', sig) || '[]') as unknown[]).length === 1);
  v('rien à écrire → null, pas de ligne vide', journaliserRemontee('', {}, () => '', sig) === null);
  v('journal ILLISIBLE → null, jamais écrasé', journaliserRemontee('pas du JSON', { budget: '5600' }, () => '', sig) === null);
  v('JSON mais pas un tableau → null aussi', journaliserRemontee('{"u":"x"}', { budget: '5600' }, () => '', sig) === null);
}

/* --------------------------------------------- la traduction du chirurgien

   Règle du chapitre 1, qui a enfin sa cible depuis le 19 août : la table
   medecins (4 nomAffiche). On écrit la forme canonique quand la comparaison
   normalisée aboutit, on refuse et on signale sinon. Le négatif (refus) a son
   jumeau positif (canonique écrit) sur le même montage : sans lui, « rien
   n'a été écrit » ne distingue pas la garde d'un mécanisme débranché. */
console.log('\n=== 18. Le chirurgien se TRADUIT, ne se recopie pas ===');
{
  const VOCAB = ['Dr Anvar Ahmedov', 'Dr Azar Zeynalov', 'Dr Orkun Uyanik', 'Dr VSC Dental'];
  const avec = (chirurgien: string, ficheOpts: Record<string, string> = {}) =>
    planifierRemontee({ ...doc, chirurgien }, fiche(ficheOpts), { engagement: 'engage', medecins: VOCAB });

  const p = avec('AZAR ZEYNALOV');
  v('« AZAR ZEYNALOV » → « Dr Azar Zeynalov » ÉCRIT — le jumeau positif',
    p.aEcrire.medecin === 'Dr Azar Zeynalov', p.aEcrire.medecin || 'RIEN');
  const q = avec('anvar ahmedov');
  v('casse et « Dr » ignorés à la comparaison, canonique à l\'écriture',
    q.aEcrire.medecin === 'Dr Anvar Ahmedov', q.aEcrire.medecin || 'RIEN');

  const inc = avec('Dr Jean Dupont');
  v('inconnu du vocabulaire : REFUSÉ, rien d\'écrit', !('medecin' in inc.aEcrire),
    'medecin' in inc.aEcrire ? 'ÉCRIT « ' + inc.aEcrire.medecin + ' »' : 'refusé');
  v('et il est signalé, pas tu', inc.chirurgienInconnu === 'Dr Jean Dupont'
    && inc.laisses.some((l) => l.libelle === 'chirurgien' && /aucun médecin/.test(l.pourquoi)));

  const tronque = avec('Dr Anvar');
  v('patronyme manquant (« Dr Anvar ») : refusé aussi — on ne devine pas un nom',
    !('medecin' in tronque.aEcrire) && tronque.chirurgienInconnu === 'Dr Anvar');

  const videV = planifierRemontee(doc, fiche(), { engagement: 'engage', medecins: [] });
  v('vocabulaire VIDE : tout refusé — l\'interdit v1.83 se réimpose seul',
    !('medecin' in videV.aEcrire) && videV.laisses.some((l) => /v1\.83/.test(l.pourquoi)));

  const occupe = avec('ORKUN UYANIK', { medecin: 'Dr Orkun Uyanik' });
  v('champ CRM occupé par le même praticien : conforme, pas réécrit',
    !('medecin' in occupe.aEcrire) && occupe.dejaConformes.includes('chirurgien'));

  const sans = planifierRemontee(doc, fiche(), { engagement: 'engage' });
  v('sans l\'option (appelant ancien) : comportement d\'avant, mot pour mot',
    sans.aEcrire.medecin === 'AZAR ZEYNALOV', sans.aEcrire.medecin);

  /* La garde des clés vides — le piège vu dans une jointure SQL le 20 août :
     une chaîne vide s'apparie à une chaîne vide, et la correspondance est
     FABRIQUÉE au lieu d'être trouvée. Un libellé de pure ponctuation (« ... »)
     se normalise à vide ; face à un vocabulaire portant une entrée dégénérée
     (« Pr  » seul se normalise à vide aussi), il ne doit rien épouser. */
  const degenere = planifierRemontee({ ...doc, chirurgien: '...' }, fiche(),
    { engagement: 'engage', medecins: ['Pr ', 'Dr Anvar Ahmedov'] });
  v('clé normalisée à vide : REFUSÉ, jamais apparié à une entrée dégénérée',
    !('medecin' in degenere.aEcrire) && degenere.chirurgienInconnu === '...',
    'medecin' in degenere.aEcrire ? 'APPARIÉ à « ' + degenere.aEcrire.medecin + ' »' : 'refusé');
}

const ko = r.filter(([, ok]) => !ok);
console.log(`\n=== ${r.length - ko.length}/${r.length} contrôles au vert ===`);
if (ko.length) console.log('  échecs : ' + ko.map(([n]) => n).join(' · '));
process.exit(ko.length ? 1 : 0);
