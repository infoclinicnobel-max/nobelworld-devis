/* Recette du lien devis → agenda. Fonctions pures, aucune connexion.

   Usage :  npx tsx scripts/recette-agenda.ts   (sortie 1 si un contrôle casse) */

import {
  CREE_PAR, HEURE_PAR_DEFAUT, planifierRendezVous, statutPourStade,
  STATUT_CONFIRME, STATUT_PLANIFIE, TYPE_OPERATION,
  type FicheAgenda, type PlanAgenda, type RdvExistant,
} from '../lib/agenda';
import type { Engagement } from '../lib/fiche';

let ok = 0, ko = 0;
const verifier = (titre: string, condition: boolean, detail = '') => {
  if (condition) { ok++; console.log(`  ✓ ${titre}`); }
  else { ko++; console.log(`  ✗ ${titre}${detail ? ' — ' + detail : ''}`); }
};
const section = (t: string) => console.log(`\n--- ${t} ---`);

const HORO = 1787141014962;
const SUF = 'nw01';
const plan = (f: Partial<FicheAgenda>, rdvs: RdvExistant[], e: Engagement = 'engage', aujourdhui?: string): PlanAgenda =>
  planifierRendezVous(
    { id: 'p1', dateOperation: '2026-10-12', medecin: 'Dr Anvar Ahmedov', hopital: '', stade: 'Confirmé', ...f },
    rdvs, { engagement: e, horodatage: HORO, suffixe: SUF, aujourdhui },
  );
const op = (date: string, id = 'r1'): RdvExistant => ({ id, type: TYPE_OPERATION, date });

section('1 · les trois cas');

const memeDate = plan({}, [op('2026-10-12')]);
verifier("même date → « deja-la », rien n'est créé", memeDate.cas === 'deja-la', memeDate.cas);
verifier('… et il nomme le rendez-vous trouvé',
  memeDate.cas === 'deja-la' && memeDate.rdvId === 'r1');

const aucun = plan({}, []);
verifier("aucun rendez-vous « Opération » → « a-creer »", aucun.cas === 'a-creer', aucun.cas);

const autre = plan({}, [op('2026-10-13')]);
verifier("autre date → « ecart », et RIEN n'est créé", autre.cas === 'ecart', autre.cas);
verifier('… et il dit les deux dates',
  autre.cas === 'ecart' && autre.dateAgenda === '2026-10-13' && autre.dateFiche === '2026-10-12');

section('2 · le cas qui a motivé le lot');

/* Maera Dagrain : un rendez-vous existe le même jour, mais c'est une
   consultation vidéo. Le confondre avec une opération priverait la patiente de
   son bloc — c'est le cas réel qui a fait passer le relevé de six à sept. */
const video = plan({}, [{ id: 'rv', type: 'Consultation vidéo', date: '2026-10-12' }]);
verifier("une consultation vidéo au même jour ne vaut PAS une opération", video.cas === 'a-creer', video.cas);

/* Cindy Doli : fiche complète, donc rien à écrire dans patients — et pourtant
   le calendrier doit recevoir sa ligne. Le pas agenda ne dépend pas de ce
   qu'on a écrit dans la fiche. */
const complete = plan({ dateOperation: '2026-10-12', medecin: 'ANVAR AHMEDOV', stade: 'Confirmé' }, []);
verifier('fiche déjà complète → le rendez-vous est créé quand même', complete.cas === 'a-creer');

section('3 · les bornes');

verifier("devis envoyé → rien", plan({}, [], 'envoye').cas === 'rien');
verifier("aucun engagement → rien", plan({}, [], 'aucun').cas === 'rien');
const sansDate = plan({ dateOperation: '' }, []);
verifier("pas de date d'opération → rien", sansDate.cas === 'rien');
verifier('… et la raison est dite',
  sansDate.cas === 'rien' && /date/.test(sansDate.pourquoi), (sansDate as any).pourquoi);
verifier("date faite d'espaces → rien", plan({ dateOperation: '   ' }, []).cas === 'rien');

section('4 · le contenu écrit');

const l = aucun.cas === 'a-creer' ? aucun.ligne : null!;
verifier(`type = « ${TYPE_OPERATION} »`, l.type === TYPE_OPERATION);
verifier(`heure = « ${HEURE_PAR_DEFAUT} » — convention assumée`, l.heure === HEURE_PAR_DEFAUT);
verifier(`creePar = « ${CREE_PAR} » — la trace qui permet de les retrouver`, l.creePar === CREE_PAR);
verifier('id au format du CRM : 13 chiffres + 4 caractères',
  /^[0-9]{13}[a-z0-9]{4}$/.test(l.id), l.id);

/* La casse de la fiche part telle quelle. On compare normalisé, on écrit non
   normalisé : reformater en douce ferait mentir la fiche. */
const casse = plan({ medecin: 'ANVAR AHMEDOV', hopital: 'Avrasya Hospital' }, []);
verifier('medecin recopié mot pour mot, casse comprise',
  casse.cas === 'a-creer' && casse.ligne.medecin === 'ANVAR AHMEDOV');
verifier('hopital recopié depuis la fiche',
  casse.cas === 'a-creer' && casse.ligne.hopital === 'Avrasya Hospital');
verifier('hopital vide reste vide', l.hopital === '');

section('4 bis · une date passée ne se pose pas au calendrier (22 août)');
{
  /* D-2026-000046 porte date_intervention = 2026-01-05 sur une fiche vide : le
     jour de son acceptation, sans cette garde, une opération se posait en
     janvier dernier. Mesuré le 22 août : quatre devis non engagés sur dix
     portent une date déjà passée. */
  const AUJOURDHUI = '2026-08-22';
  const passee = plan({ dateOperation: '2026-01-05' }, [], 'engage', AUJOURDHUI);
  verifier('date passée, aucun rendez-vous → « rien », et la raison le dit',
    passee.cas === 'rien' && /déjà passée/.test(passee.pourquoi), passee.cas);
  const future = plan({ dateOperation: '2026-10-12' }, [], 'engage', AUJOURDHUI);
  verifier('JUMEAU : date future → « a-creer »', future.cas === 'a-creer', future.cas);
  const cejour = plan({ dateOperation: AUJOURDHUI }, [], 'engage', AUJOURDHUI);
  verifier('le jour même n’est pas passé → « a-creer »', cejour.cas === 'a-creer', cejour.cas);
  const dejaLa = plan({ dateOperation: '2026-01-05' }, [op('2026-01-05')], 'engage', AUJOURDHUI);
  verifier('date passée mais rendez-vous déjà posé → « deja-la » : l’existant se reconnaît, passé ou non',
    dejaLa.cas === 'deja-la', dejaLa.cas);
  const ecart = plan({ dateOperation: '2026-01-05' }, [op('2026-10-13')], 'engage', AUJOURDHUI);
  verifier('date passée et autre date au calendrier → « ecart » : signalé, rien créé', ecart.cas === 'ecart', ecart.cas);
  const sansJour = plan({ dateOperation: '2026-01-05' }, []);
  verifier('sans `aujourdhui` (appelant ancien) la garde ne joue pas — la recette du flux vérifie qu’il le passe',
    sansJour.cas === 'a-creer', sansJour.cas);
}

section('5 · le statut suit le stade, pas l’écriture');

verifier('Confirmé → Confirmé', statutPourStade('Confirmé') === STATUT_CONFIRME);
verifier('Post-opératoire → Confirmé', statutPourStade('Post-opératoire') === STATUT_CONFIRME);
verifier('Clôturé ✓ → Confirmé', statutPourStade('Clôturé ✓') === STATUT_CONFIRME);
verifier('Devis envoyé → Planifié', statutPourStade('Devis envoyé') === STATUT_PLANIFIE);
verifier('Nouveau → Planifié', statutPourStade('Nouveau') === STATUT_PLANIFIE);
verifier('vide → Planifié', statutPourStade('') === STATUT_PLANIFIE);
verifier('hors échelle → Planifié, jamais Confirmé par défaut',
  statutPourStade('En cours') === STATUT_PLANIFIE);

console.log(ko ? `\n=== ${ok}/${ok + ko} — ${ko} CASSÉ(S) ===\n` : `\n=== ${ok}/${ok} contrôles au vert ===\n`);
process.exit(ko ? 1 : 0);
