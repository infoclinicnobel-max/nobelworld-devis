/* Recette du remplissage des prestations depuis le catalogue — Veys, 22 août.

   Fonctions pures de lib/catalogue.ts : natureLigne / nombreDeNuits /
   renumeroter (lire et réécrire une ligne de nuits), acteLePlusLong (qui donne
   le séjour), modelesDesActes (ce qu'un devis désigne), verifierSejours (le
   contrôle permanent), planifierNuits (la règle ②), remplirPrestations (la
   fusion). Plus une garde de SOURCE : l'acte et le modèle passent par une
   seule règle, et le contrôle permanent est bien branché à l'écran.

   Les LISTES sont des extraits RÉELS du catalogue, relevés en base le 22 août
   à 07:47 UTC (après les réécritures de l'orchestrateur) — BBL 7 j / 6 n
   (2 + 4), Rhinoplastie 6 j / 5 n (1 + 4), Lipofilling mammaire 5 j / 4 n
   (1 + 3), Sleeve 4 j / 3 n (2 + 1), Motiva 4 j / 3 n (1 + 2), Greffe de
   sourcils 3 j / 2 n (1 + 1), Blépharoplastie supérieure 1 j / 1 n (1 + 0,
   dictée de Veys), Allurion 1 j / 0 n, greffe osseuse dentaire sans durée,
   alopécie sans durée. L'ÉTAT ANCIEN de l'alopécie (deux lignes de nuits sans
   nombre, corrigé en base à 07:47) est gardé comme BANC, nommé comme tel. Les
   DÉFAUTS sont ceux de nw_parametres (clé « societe ») le même jour. Un banc
   éprouve un mécanisme ; il ne décrit pas la base, qui bouge.

   Les trois points sous garde, chacun avec son jumeau positif :
   ① les services s'unissent sans doublon (clé du sélecteur) ;
   ② séjour du plus long, clinique = maximum, hôtel = reste — quel que soit
      l'ordre de sélection ; deux invariants rejoués sur toutes les paires ;
      sans durée, aucune nuit ; une donnée qui viole l'invariant ne fait rien
      deviner ;
   ③ une ligne écrite par une main n'est jamais écrasée (et on le dit), rien
      n'est jamais retiré — seul le vocabulaire du système se remplace.

   Usage : npx tsx scripts/recette-remplissage-prestations.ts */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  acteLePlusLong, cliniqueDe, modelesDesActes, natureLigne, nombreDeNuits, planifierNuits,
  remplirPrestations, renumeroter, verifierSejours, type Correspondance, type ContexteRemplissage,
} from '../lib/catalogue';
import type { Acte, Modele } from '../lib/types';

const r: [string, boolean][] = [];
const v = (nom: string, ok: boolean, detail = '') => {
  r.push([nom, ok]);
  console.log(`  ${ok ? '✓' : '✗'} ${nom}${detail ? ' — ' + detail : ''}`);
};
const egal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/* ---- extraits réels du catalogue (22 août, 07:47 UTC) ---- */
const TETE = ['consultation avec notre chirurgien', 'analyses préopératoires sanguine', 'anesthésie générale'];
const FIN = [
  'transferts internes dans Istanbul', 'traductrice spécialiste médicale',
  '1 corset/gaine/coussin selon intervention', 'bas de contention', 'suivi postopératoire',
];
const sejour = (clinique: string, hotel?: string) => [...TETE, clinique, ...(hotel ? [hotel] : []), ...FIN];
const INC_BBL = sejour('2 nuits en clinique', "4 nuits d'hôtel 5★");
const INC_RHINO = sejour('1 nuit en clinique', "4 nuits d'hôtel 5★");
const INC_MAMMAIRE = sejour('1 nuit en clinique', "3 nuits d'hôtel 5★");
const INC_SLEEVE = sejour('2 nuits en clinique', "1 nuit d'hôtel 5★");
const INC_MOTIVA = sejour('1 nuit en clinique', "2 nuits d'hôtel 5★");
const INC_SOURCILS = sejour('1 nuit en clinique', "1 nuit d'hôtel 5★");
const INC_BLEPHARO = sejour('1 nuit en clinique');
const EXC = ["billets d'avion", 'médicaments', 'massages de drainage'];
const INC_SANS_SEJOUR = [
  'consultation avec notre chirurgien', 'analyses préopératoires sanguine', 'anesthésie',
  'transferts internes dans Istanbul', 'traductrice spécialiste médicale',
  '1 corset/gaine/coussin selon intervention', 'bas de contention', 'suivi postopératoire',
];
const INC_DENT = ['anesthésie', 'suivi postopératoire'];
const EXC_DENT = ["billets d'avion", 'médicaments', 'hôtel', 'transferts'];
/* BANC — l'état de cap-alopecie-androgenetique AVANT sa correction du 22 août 07:47. */
const INC_ALOPECIE_ANCIENNE = [
  'consultation', 'analyses préopératoires', 'anesthésie', 'nuits en clinique', "nuits d'hôtel 5★",
  'transferts', 'traductrice', 'corset/gaine/coussin selon intervention', 'bas de contention',
  'suivi postopératoire',
];

const modele = (id: string, nom: string, o: Partial<Modele> = {}): Modele =>
  ({ id, nom, categorie: 'esthetique', sousCategorie: 'corps', nature: 'catalogue', prixBase: 1000,
    prixStandard: null, surDevis: false, description: '', notesInternes: '', synonymes: [],
    inc: [], exc: [], dureeJours: null, dureeNuits: null, actif: true, ordre: null, ...o }) as Modele;
const duree = (jours: number, nuits: number, inc: string[], o: Partial<Modele> = {}): Partial<Modele> =>
  ({ inc, exc: EXC, dureeJours: jours, dureeNuits: nuits, ...o });

const BBL = modele('cat-bbl-seul', 'BBL seul', duree(7, 6, INC_BBL));
const ABDO = modele('cat-abdominoplastie-diastasis', 'Abdominoplastie + Diastasis', duree(7, 6, INC_BBL));
const RHINO = modele('alc-rhinoplastie', 'Rhinoplastie', duree(6, 5, INC_RHINO, { sousCategorie: 'visage' }));
const MAMMAIRE = modele('cat-lipofilling-mammaire', 'Lipofilling mammaire', duree(5, 4, INC_MAMMAIRE));
const SLEEVE = modele('pkg-sleeve-gastrectomie', 'Sleeve gastrectomie', duree(4, 3, INC_SLEEVE, { categorie: 'bariatrique' }));
const MOTIVA = modele('alc-augmentation-mammaire-motiva', 'Augmentation mammaire Motiva', duree(4, 3, INC_MOTIVA));
const SOURCILS = modele('cap-greffe-sourcils-dhi-choi', 'Greffe de sourcils DHI Stylo Choi', duree(3, 2, INC_SOURCILS, { categorie: 'capillaire' }));
const BLEPHARO = modele('pkg-blepharoplastie-superieure', 'Blépharoplastie supérieure', duree(1, 1, INC_BLEPHARO, { sousCategorie: 'visage' }));
const ALLURION = modele('bar-ballon-gastrique-allurion', 'Ballon gastrique / Allurion', duree(1, 0, INC_SANS_SEJOUR, { categorie: 'bariatrique' }));
const DENT = modele('dent-greffe-osseuse', 'Greffe osseuse synthétique', { inc: INC_DENT, exc: EXC_DENT, categorie: 'dentaire', nature: 'acte' });
const ALOPECIE = modele('cap-alopecie-androgenetique', 'Traitement alopécie androgénétique', { inc: INC_SANS_SEJOUR, exc: EXC, categorie: 'capillaire' });
const SUPPLEMENT = modele('sup-zone-liposuccion', 'Zone de liposuccion supplémentaire', { inc: [], exc: [], categorie: 'supplement', nature: 'supplement', prixBase: 500 });
const TOUS = [BBL, ABDO, RHINO, MAMMAIRE, SLEEVE, MOTIVA, SOURCILS, BLEPHARO, ALLURION, DENT, ALOPECIE, SUPPLEMENT];
/* Bancs HORS catalogue : l'état ancien de l'alopécie, et deux lignes qui violent l'invariant. */
const ALOPECIE_ANCIENNE = modele('cap-alopecie-androgenetique', 'Traitement alopécie androgénétique (état du 22/08 07:08)', { inc: INC_ALOPECIE_ANCIENNE, exc: EXC, categorie: 'capillaire' });
const TROP = modele('banc-trop', 'Banc : 6 nuits de clinique sur 2', duree(3, 2, sejour('6 nuits en clinique', "1 nuit d'hôtel 5★")));
const SOMME = modele('banc-somme', 'Banc : 1 + 3 sur 5', duree(6, 5, sejour('1 nuit en clinique', "3 nuits d'hôtel 5★")));
/* Une ligne HORS de la convention « nuits = jours − 1 » mais qui respecte
   l'invariant (4 nuits de clinique sur 4 nuits). Le catalogue n'en a pas ; la
   règle doit pourtant tenir pour TOUTE donnée où clinique ≤ nuits — c'est ce
   que la démonstration affirme. Avec elle dans le banc des paires, mesurer le
   plus long « en jours d'abord » rougit ; en jours seuls, la blépharoplastie
   suffisait déjà. */
const HORS_CONVENTION = modele('banc-hors-convention', 'Banc : 4 j / 4 n, tout en clinique', duree(4, 4, sejour('4 nuits en clinique')));
/* Et son pendant : plus de jours, moins de nuits (5 j / 3 n). Ensemble, les
   deux font que jours et nuits ne vont plus dans le même sens — c'est LÀ que
   « jours d'abord, nuits en départage » tombe (5 j l'emporte, séjour 3, et 4
   nuits de clinique à loger). Sur le catalogue réel, où nuits = jours − 1
   partout sauf la blépharoplastie, cette variante passait : le banc doit
   porter ce que la base ne porte pas encore. */
const HORS_CONVENTION_2 = modele('banc-hors-convention-2', 'Banc : 5 j / 3 n, des jours sans nuit', duree(5, 3, sejour('1 nuit en clinique', "2 nuits d'hôtel 5★")));

/* ---- défauts des Paramètres, relevés le 22 août (= DEFAULT_INC de lib/defaults.ts) ---- */
const DEFAUTS = {
  inc: [
    "Honoraires du chirurgien et de l'anesthésiste", 'Bloc opératoire et hospitalisation',
    'Consultation préopératoire et analyses sanguines', "Médicaments pendant l'hospitalisation",
    'Traducteur médical francophone', 'Suivi postopératoire et contrôles',
    'Corset médical, bas de contention et coussin BBL', 'Hôtel 5★ avec petit-déjeuner',
    'Transferts VIP : Aéroport ⇄ Hôtel ⇄ Clinique', '1 accompagnant inclus',
  ],
  exc: ["Billets d'avion / vols internationaux", 'Dépenses personnelles'],
};
const CTX: ContexteRemplissage = { modeles: TOUS, defauts: DEFAUTS };
const remplir = (courant: { inc?: string[]; exc?: string[] }, actes: Modele[], nouveau: Modele) =>
  remplirPrestations(courant, actes, nouveau, CTX);
const neuf = () => ({ inc: [...DEFAUTS.inc], exc: [...DEFAUTS.exc] });
const nuits = (inc: string[], nature: 'clinique' | 'hotel') => inc.filter((l) => natureLigne(l) === nature);
const chiffres = (p: ReturnType<typeof planifierNuits>) => (p ? [p.sejour, p.clinique, p.hotel] : null);

console.log('\n=== 1. Lire et réécrire une ligne de nuits ===');
{
  v('« 2 nuits en clinique » → clinique', natureLigne('2 nuits en clinique') === 'clinique');
  v('« 1 nuit en clinique » (singulier) → clinique', natureLigne('1 nuit en clinique') === 'clinique');
  v('« 4 nuits d\'hôtel 5★ » → hôtel', natureLigne("4 nuits d'hôtel 5★") === 'hotel');
  v('« nuits d\'hôtel 5★ » (sans nombre) → hôtel quand même', natureLigne("nuits d'hôtel 5★") === 'hotel');
  v('« Hôtel 5★ avec petit-déjeuner » (défaut) → service : pas de nuit dedans',
    natureLigne('Hôtel 5★ avec petit-déjeuner') === 'service');
  v('« Bloc opératoire et hospitalisation » → service', natureLigne('Bloc opératoire et hospitalisation') === 'service');
  v('vide → service (inerte)', natureLigne('') === 'service');
  v('nombreDeNuits : « 2 nuits en clinique » → 2, « 1 nuit d\'hôtel 5★ » → 1',
    nombreDeNuits('2 nuits en clinique') === 2 && nombreDeNuits("1 nuit d'hôtel 5★") === 1);
  v('nombreDeNuits : « 1 nuits en clinique » (faute d\'un ancien catalogue) → 1, lisible quand même',
    nombreDeNuits('1 nuits en clinique') === 1);
  v('nombreDeNuits : sans nombre → null ; un service → null',
    nombreDeNuits("nuits d'hôtel 5★") === null && nombreDeNuits('suivi postopératoire') === null);
  v('renumeroter : 4 → 3 nuits, le reste mot pour mot', renumeroter("4 nuits d'hôtel 5★", 3) === "3 nuits d'hôtel 5★");
  v('renumeroter : 1 nuit → 2 nuits (pluriel), 3 nuits → 1 nuit (singulier)',
    renumeroter("1 nuit d'hôtel 5★", 2) === "2 nuits d'hôtel 5★" && renumeroter("3 nuits d'hôtel 5★", 1) === "1 nuit d'hôtel 5★");
}

console.log('\n=== 2. acteLePlusLong — qui donne le séjour ===');
{
  v('[Rhino 6 j, BBL 7 j] → BBL', acteLePlusLong([RHINO, BBL])?.id === BBL.id);
  v('[BBL 7 j, Rhino 6 j] → BBL — l\'ordre ne compte pas', acteLePlusLong([BBL, RHINO])?.id === BBL.id);
  v('ex æquo [BBL, Abdo] → BBL, le premier du devis', acteLePlusLong([BBL, ABDO])?.id === BBL.id);
  v('JUMEAU ex æquo [Abdo, BBL] → Abdo — stable, jamais le dernier choisi', acteLePlusLong([ABDO, BBL])?.id === ABDO.id);
  v('[Dentaire sans durée, Sleeve 4 j] → Sleeve', acteLePlusLong([DENT, SLEEVE])?.id === SLEEVE.id);
  /* Trouvé par le banc des paires, pas raisonné : à égalité de jours, c'est le
     nombre de NUITS qui fait le plus long — sinon Allurion (0 n) l'emporte sur
     la blépharoplastie (1 n, dictée de Veys) et l'hôtel tombe à -1. */
  v('[Allurion 1 j / 0 n, Blépharoplastie 1 j / 1 n] → Blépharoplastie : le plus long se mesure en nuits',
    acteLePlusLong([ALLURION, BLEPHARO])?.id === BLEPHARO.id);
  v('JUMEAU [Blépharoplastie, Allurion] → Blépharoplastie aussi — l\'ordre ne départage que les vrais ex æquo',
    acteLePlusLong([BLEPHARO, ALLURION])?.id === BLEPHARO.id);
  v('[Dentaire sans durée] → personne', acteLePlusLong([DENT]) === undefined);
  v('[] → personne', acteLePlusLong([]) === undefined);
}

console.log('\n=== 3. modelesDesActes — ce que le devis désigne, jamais une « a_verifier » ===');
{
  const a = (acte: string): Acte => ({ id: 'a' + acte.length, acte, inclus: '' });
  const CORRESP: Correspondance[] = [{ libelle: 'SAFE BBL', catalogueId: BBL.id, statut: 'a_verifier' }];
  const VALIDE: Correspondance[] = CORRESP.map((c) => ({ ...c, statut: 'valide' }));
  v('« Rhinoplastie » → exact', egal(modelesDesActes([a('Rhinoplastie')], TOUS).map((m) => m.id), [RHINO.id]));
  v('« RHINOPLASTIE » → exact malgré la casse', egal(modelesDesActes([a('RHINOPLASTIE')], TOUS).map((m) => m.id), [RHINO.id]));
  v('GARDE — « SAFE BBL » par une correspondance a_verifier ne désigne RIEN',
    modelesDesActes([a('SAFE BBL')], TOUS, CORRESP).length === 0);
  v('JUMEAU — la MÊME correspondance passée valide désigne BBL',
    egal(modelesDesActes([a('SAFE BBL')], TOUS, VALIDE).map((m) => m.id), [BBL.id]));
  v('libellé inconnu → rien', modelesDesActes([a('Liposuccion 360')], TOUS).length === 0);
  v('le même acte cité deux fois compte une fois', modelesDesActes([a('Rhinoplastie'), a('rhinoplastie')], TOUS).length === 1);
  v('ligne vide → rien ; liste absente → rien',
    modelesDesActes([a('')], TOUS).length === 0 && modelesDesActes(undefined, TOUS).length === 0);
}

console.log('\n=== 4. verifierSejours — LE CONTRÔLE PERMANENT ===');
{
  v('le catalogue relevé le 22 août : 0 écart (clinique ≤ nuits, clinique + hôtel = nuits)',
    verifierSejours(TOUS).length === 0, verifierSejours(TOUS).join(' | '));
  v('Blépharoplastie 1 j / 1 n (1 + 0, dictée de Veys) : respecte l\'invariant, rien à dire',
    verifierSejours([BLEPHARO]).length === 0);
  v('une ligne qui promet 6 nuits de clinique sur 2 → DITE',
    verifierSejours([TROP]).some((x) => /6 nuit\(s\) de clinique pour un séjour de 2/.test(x)));
  v('une ligne où 1 + 3 ≠ 5 → DITE', verifierSejours([SOMME]).some((x) => /≠ 5/.test(x)));
  const alo = verifierSejours([ALOPECIE_ANCIENNE]);
  v('l\'alopécie d\'avant correction : sans durée mais promet des nuits → DITE',
    alo.some((x) => /sans durée/.test(x)));
  v('… et ses lignes de nuits SANS NOMBRE → DITES aussi', alo.some((x) => /sans nombre/.test(x)));
  v('l\'alopécie corrigée (07:47) ne dit plus rien', verifierSejours([ALOPECIE]).length === 0);
}

console.log('\n=== 5. planifierNuits — séjour du plus long, clinique = maximum, hôtel = reste ===');
{
  const p = planifierNuits([SLEEVE, RHINO]);
  v('Sleeve + Rhino : séjour 5, clinique 2, hôtel 3', egal(chiffres(p), [5, 2, 3]));
  v('… la ligne de clinique est celle de la sleeve, MOT POUR MOT', p?.ligneClinique === '2 nuits en clinique');
  v('… la ligne d\'hôtel est celle de la rhino, renumérotée 4 → 3', p?.ligneHotel === "3 nuits d'hôtel 5★");
  v('… le séjour est celui de la Rhinoplastie, aucune incohérence', p?.de.id === RHINO.id && p?.incoherences.length === 0);
  v('JUMEAU Rhino + Sleeve : exactement les mêmes nuits', egal(chiffres(planifierNuits([RHINO, SLEEVE])), [5, 2, 3]));
  v('Rhino + BBL : 6 = 2 + 4, lignes de BBL', egal(chiffres(planifierNuits([RHINO, BBL])), [6, 2, 4])
    && planifierNuits([RHINO, BBL])?.ligneHotel === "4 nuits d'hôtel 5★");
  v('BBL seul 2 + 4 ; Rhino seule 1 + 4 ; Sleeve seule 2 + 1 — un acte seul reprend sa ligne',
    egal(chiffres(planifierNuits([BBL])), [6, 2, 4]) && egal(chiffres(planifierNuits([RHINO])), [5, 1, 4])
    && egal(chiffres(planifierNuits([SLEEVE])), [3, 2, 1]));
  v('Sleeve + Greffe de sourcils : 3 = 2 + 1, « 1 nuit d\'hôtel 5★ » au singulier',
    egal(chiffres(planifierNuits([SLEEVE, SOURCILS])), [3, 2, 1]) && planifierNuits([SLEEVE, SOURCILS])?.ligneHotel === "1 nuit d'hôtel 5★");
  const m = planifierNuits([MAMMAIRE, SLEEVE]);
  v('Lipofilling mammaire (5 j : 1 + 3) + Sleeve : 4 = 2 + 2 — clinique de la sleeve, hôtel 3 → 2',
    egal(chiffres(m), [4, 2, 2]) && m?.ligneClinique === '2 nuits en clinique' && m?.ligneHotel === "2 nuits d'hôtel 5★");
  const t1 = planifierNuits([MOTIVA, SLEEVE]);
  const t2 = planifierNuits([SLEEVE, MOTIVA]);
  v('ex æquo 4 j : Motiva (1 + 2) + Sleeve (2 + 1) → 3 = 2 + 1, séjour du premier, mêmes nombres dans les deux ordres',
    egal(chiffres(t1), [3, 2, 1]) && egal(chiffres(t2), [3, 2, 1]) && t1?.de.id === MOTIVA.id && t2?.de.id === SLEEVE.id);
  v('Blépharoplastie (1 j / 1 n) + Sourcils (3 j / 2 n) : 2 = 1 + 1', egal(chiffres(planifierNuits([BLEPHARO, SOURCILS])), [2, 1, 1]));
  v('Allurion seul (1 j / 0 n) : 0 = 0 + 0, aucune ligne',
    egal(chiffres(planifierNuits([ALLURION])), [0, 0, 0]) && !planifierNuits([ALLURION])?.ligneClinique && !planifierNuits([ALLURION])?.ligneHotel);
  v('dentaire seul → pas de séjour ; [] → pas de séjour',
    planifierNuits([DENT]) === undefined && planifierNuits([]) === undefined);

  /* Les deux invariants, rejoués sur TOUTES les paires du banc à séjour déclaré —
     les lignes réelles, plus la ligne hors convention. */
  const avecSejour = [...TOUS.filter((x) => x.dureeNuits !== null), HORS_CONVENTION, HORS_CONVENTION_2];
  let paires = 0;
  let fautes = 0;
  for (const a of avecSejour) for (const b of avecSejour) {
    const q = planifierNuits([a, b]);
    paires++;
    const maxC = Math.max(cliniqueDe(a) ?? 0, cliniqueDe(b) ?? 0);
    if (!q || q.clinique + q.hotel !== q.sejour || q.clinique < maxC || q.hotel < 0 || q.incoherences.length) fautes++;
  }
  v(`toutes les paires (${paires}) : total = séjour, clinique ≥ l'acte le plus exigeant, hôtel ≥ 0, 0 incohérence`,
    fautes === 0, `${fautes} faute(s)`);
  v('hors convention (4 j / 4 n tout en clinique) + Lipofilling mammaire (5 j / 4 n) : 4 = 4 + 0 — aucun hôtel inventé',
    egal(chiffres(planifierNuits([MAMMAIRE, HORS_CONVENTION])), [4, 4, 0]) && !planifierNuits([MAMMAIRE, HORS_CONVENTION])?.ligneHotel);
  v('5 j / 3 n + 4 j / 4 n : le plus long est celui des 4 NUITS (pas des 5 jours) → 4 = 4 + 0',
    egal(chiffres(planifierNuits([HORS_CONVENTION_2, HORS_CONVENTION])), [4, 4, 0])
    && planifierNuits([HORS_CONVENTION_2, HORS_CONVENTION])?.de.id === HORS_CONVENTION.id);

  /* Une donnée qui viole l'invariant : on ne devine pas. */
  const x = planifierNuits([RHINO, TROP]);
  v('6 nuits de clinique (banc) sur un séjour de 5 : incohérence DITE, nuits de la Rhino reprises telles quelles',
    !!x && x.incoherences.length > 0 && x.ligneClinique === '1 nuit en clinique' && x.ligneHotel === "4 nuits d'hôtel 5★" && x.hotel >= 0);
}

console.log('\n=== 6. Devis neuf — la liste encore aux défauts est remplacée franchement ===');
{
  const res = remplir(neuf(), [RHINO], RHINO);
  v('inc = la liste du catalogue, dans SON ordre (nuits au milieu)', egal(res.inc, INC_RHINO));
  v('exc = les exclusions du catalogue', egal(res.exc, EXC));
  v('le séjour est celui de la Rhinoplastie : 5 = 1 + 4', res.nuitsDe?.id === RHINO.id && egal(chiffres(res.nuits), [5, 1, 4]));
  v('13 lignes ajoutées, 0 remplacée, 0 laissée', res.ajoutees.length === 13 && !res.remplacees.length && !res.laissees.length);
  v('liste vide → même résultat', egal(remplir({ inc: [], exc: [] }, [RHINO], RHINO).inc, INC_RHINO));
  v('liste de lignes blanches → même résultat', egal(remplir({ inc: ['', '  '], exc: undefined }, [RHINO], RHINO).inc, INC_RHINO));
  v('défauts en MAJUSCULES = toujours les défauts (clé du sélecteur) → remplacés',
    egal(remplir({ inc: DEFAUTS.inc.map((l) => l.toUpperCase()), exc: [...DEFAUTS.exc] }, [RHINO], RHINO).inc, INC_RHINO));
  v('Sleeve puis Rhino sur un devis neuf : 2 en clinique + 3 à l\'hôtel, à leur place',
    (() => { const s = remplir(remplir(neuf(), [SLEEVE], SLEEVE), [SLEEVE, RHINO], RHINO); return s.inc[3] === '2 nuits en clinique' && s.inc[4] === "3 nuits d'hôtel 5★" && s.inc.length === 10; })());
}

console.log('\n=== 7. ② Les nuits se calculent, dans les deux ordres ===');
{
  const apres = remplir({ inc: [...INC_RHINO], exc: [...EXC] }, [RHINO, BBL], BBL);
  v('Rhino puis BBL : toujours 10 lignes — les services ne doublent pas', apres.inc.length === 10, String(apres.inc.length));
  v('la nuit de clinique devient « 2 nuits en clinique », à sa place (index 3)', apres.inc[3] === '2 nuits en clinique');
  v('l\'hôtel reste « 4 nuits d\'hôtel 5★ » — identique, rien à dire', egal(nuits(apres.inc, 'hotel'), ["4 nuits d'hôtel 5★"]));
  v('le remplacement est DIT : 1 nuit → 2 nuits', egal(apres.remplacees, [{ avant: '1 nuit en clinique', apres: '2 nuits en clinique' }]));
  v('aucune ligne ajoutée, aucune laissée', !apres.ajoutees.length && !apres.laissees.length);

  const s1 = remplir({ inc: [...INC_SLEEVE], exc: [...EXC] }, [SLEEVE, RHINO], RHINO);
  v('Sleeve puis Rhino : la clinique reste « 2 nuits en clinique », l\'hôtel passe de 1 à 3',
    egal(nuits(s1.inc, 'clinique'), ['2 nuits en clinique']) && egal(nuits(s1.inc, 'hotel'), ["3 nuits d'hôtel 5★"]));
  v('… et c\'est DIT : 1 nuit d\'hôtel → 3 nuits', egal(s1.remplacees, [{ avant: "1 nuit d'hôtel 5★", apres: "3 nuits d'hôtel 5★" }]));
  const s2 = remplir({ inc: [...INC_RHINO], exc: [...EXC] }, [RHINO, SLEEVE], SLEEVE);
  v('JUMEAU Rhino puis Sleeve : clinique 1 → 2, hôtel 4 → 3 — les mêmes nuits à l\'arrivée',
    egal(nuits(s2.inc, 'clinique'), nuits(s1.inc, 'clinique')) && egal(nuits(s2.inc, 'hotel'), nuits(s1.inc, 'hotel')) && s2.remplacees.length === 2);
  v('BBL puis Abdominoplastie (7 j aussi) : inchangé, BBL garde le séjour',
    egal(remplir({ inc: [...INC_BBL], exc: [...EXC] }, [BBL, ABDO], ABDO).inc, INC_BBL));
}

console.log('\n=== 8. ③ Une main n\'est jamais écrasée (et on le dit), rien n\'est jamais retiré ===');
{
  const negocie = "5 nuits d'hôtel 5★ (négocié)";
  const humain = INC_RHINO.map((l) => (l === "4 nuits d'hôtel 5★" ? negocie : l));
  humain.splice(5, 0, 'Massage lymphatique offert');        // une ligne de la main, au milieu
  const res = remplir({ inc: humain, exc: [...EXC] }, [RHINO, BBL], BBL);
  v('la nuit d\'hôtel négociée reste mot pour mot', res.inc.includes(negocie));
  v('… aucune seconde ligne d\'hôtel n\'apparaît', nuits(res.inc, 'hotel').length === 1, nuits(res.inc, 'hotel').join(' | '));
  v('… et c\'est DIT dans « laissées », avec ce que le séjour aurait écrit',
    res.laissees.length === 1 && /négocié/.test(res.laissees[0]) && /4 nuits d'hôtel 5★/.test(res.laissees[0]));
  v('la nuit de clinique, vocabulaire du système, est remplacée (1 → 2)', egal(nuits(res.inc, 'clinique'), ['2 nuits en clinique']));
  v('la ligne de la main est toujours là, à sa place', res.inc[5] === 'Massage lymphatique offert');
  v('chaque ligne d\'avant est encore présente — rien retiré', humain.every((l) => res.inc.includes(l) || l === '1 nuit en clinique'));
  v('l\'ordre des lignes d\'avant est conservé',
    humain.filter((l) => l !== '1 nuit en clinique').every((l, i, arr) => i === 0 || res.inc.indexOf(l) > res.inc.indexOf(arr[i - 1])));

  const faute = INC_RHINO.map((l) => (l === '1 nuit en clinique' ? '1 nuits en clinique' : l));
  const f = remplir({ inc: faute, exc: [...EXC] }, [RHINO, BBL], BBL);
  v('JUMEAU : « 1 nuits en clinique » (faute d\'un ancien catalogue, D-2026-000044) est du système → remplacée',
    egal(nuits(f.inc, 'clinique'), ['2 nuits en clinique']) && f.remplacees[0]?.avant === '1 nuits en clinique');
  const systeme = INC_RHINO.map((l) => (l === "4 nuits d'hôtel 5★" ? "1 nuit d'hôtel 5★" : l));
  v('JUMEAU : « 1 nuit d\'hôtel 5★ » (vocabulaire du catalogue) est alignée sur le séjour → 4 nuits',
    egal(nuits(remplir({ inc: systeme, exc: [...EXC] }, [RHINO, BBL], BBL).inc, 'hotel'), ["4 nuits d'hôtel 5★"]));

  const retouche = ['Suivi Postopératoire', 'ANESTHÉSIE GÉNÉRALE', 'Massage lymphatique offert'];
  const dd = remplir({ inc: retouche, exc: ['Médicaments'] }, [RHINO], RHINO);
  v('« Suivi Postopératoire » / « ANESTHÉSIE GÉNÉRALE » ne sont pas réajoutés',
    dd.inc.filter((l) => natureLigne(l) === 'service').length === retouche.length + (INC_RHINO.length - 2) - 2);
  v('les lignes retouchées gardent leur graphie', dd.inc[0] === 'Suivi Postopératoire' && dd.inc[1] === 'ANESTHÉSIE GÉNÉRALE');
  v('« Médicaments » (majuscule) n\'est pas doublé dans les exclusions', dd.exc.filter((l) => /m[ée]dicaments/i.test(l)).length === 1);
  v('les nuits manquantes s\'ajoutent à la fin (liste retouchée sans nuit)',
    nuits(dd.inc, 'clinique').length === 1 && nuits(dd.inc, 'hotel').length === 1);
  v('deux lignes blanches d\'une liste retouchée sont conservées',
    remplir({ inc: ['Massage lymphatique offert', '', ''], exc: [] }, [RHINO], RHINO).inc.filter((l) => l === '').length === 2);
  const une = remplir(neuf(), [RHINO], RHINO);
  const deux = remplir(une, [RHINO], RHINO);
  v('rechoisir Rhinoplastie : rien n\'est ajouté, remplacé ni laissé',
    egal(deux.inc, une.inc) && egal(deux.exc, une.exc) && !deux.ajoutees.length && !deux.remplacees.length && !deux.laissees.length);
}

console.log('\n=== 9. Sans durée au catalogue, aucune nuit — rien n\'est deviné ===');
{
  const dent = remplir(neuf(), [DENT], DENT);
  v('greffe osseuse seule : 2 lignes, aucune nuit, aucun séjour', egal(dent.inc, INC_DENT) && dent.nuits === undefined);
  v('… exclusions dentaires (hôtel, transferts) reprises', egal(dent.exc, EXC_DENT));
  v('alopécie corrigée (séance d\'1 h) : 8 lignes, aucune nuit', egal(remplir(neuf(), [ALOPECIE], ALOPECIE).inc, INC_SANS_SEJOUR));
  const ancienne = remplir(neuf(), [ALOPECIE_ANCIENNE], ALOPECIE_ANCIENNE);
  v('BANC alopécie d\'avant correction : ses deux lignes « nuits » SANS NOMBRE ne passent pas',
    nuits(ancienne.inc, 'clinique').length === 0 && nuits(ancienne.inc, 'hotel').length === 0 && ancienne.inc.length === 8);
  v('Allurion (1 j / 0 n) : la liste du catalogue telle quelle, sans nuit', egal(remplir(neuf(), [ALLURION], ALLURION).inc, INC_SANS_SEJOUR));
  const mixte = remplir({ inc: [...INC_RHINO], exc: [...EXC] }, [RHINO, DENT], DENT);
  v('dentaire ajouté à une rhino : ses nuits ne bougent pas, « anesthésie » s\'ajoute à côté d\'« anesthésie générale »',
    egal(nuits(mixte.inc, 'clinique'), ['1 nuit en clinique']) && mixte.inc.includes('anesthésie') && mixte.inc.includes('anesthésie générale'));
  v('… « hôtel » et « transferts » rejoignent les exclusions — union, visible, à la main de Veys',
    mixte.exc.includes('hôtel') && mixte.exc.includes('transferts'));
  const sup = remplir({ inc: [...INC_RHINO], exc: [...EXC] }, [RHINO, SUPPLEMENT], SUPPLEMENT);
  v('un supplément (inclusions vides) n\'ajoute, ne remplace, ne laisse rien',
    egal(sup.inc, INC_RHINO) && !sup.ajoutees.length && !sup.remplacees.length && !sup.laissees.length);
  v('un supplément pris comme modèle d\'un devis neuf : liste vide, pas de nuit inventée',
    remplir(neuf(), [SUPPLEMENT], SUPPLEMENT).inc.length === 0);
}

console.log('\n=== 10. Garde de source — une seule règle, à la sélection seulement, contrôle branché ===');
{
  const lire = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  const src = lire('../components/Devis.tsx');
  const corps = (nom: string) => {
    const debut = src.indexOf(`const ${nom} = `);
    if (debut < 0) return '';
    const fin = src.indexOf('\n  };', debut);
    return fin < 0 ? src.slice(debut) : src.slice(debut, fin);
  };
  const apply = corps('applyModele');
  const acte = corps('acteDepuisModele');
  const opt = corps('optDepuisModele');
  const sig = corps('signaler');
  v('applyModele existe et ne porte plus sa propre règle inc/exc', !!apply && !/\binc:/.test(apply) && !/\bexc:/.test(apply));
  v('applyModele passe par acteDepuisModele, comme modèle — une règle, pas deux', /acteDepuisModele\(m\b/.test(apply) && /commeModele: true/.test(apply));
  v('acteDepuisModele appelle remplirPrestations', /remplirPrestations\(/.test(acte));
  v('acteDepuisModele résout les actes par modelesDesActes (exact / valide seulement)', /modelesDesActes\(/.test(acte));
  v('optDepuisModele (options) ne remplit PAS les prestations', !!opt && !/remplirPrestations\(/.test(opt));
  v('aucun useEffect ne déclenche le remplissage — sélection seulement',
    !/useEffect\([^)]*remplirPrestations/s.test(src) && (src.match(/remplirPrestations\(/g) || []).length === 1);
  v('le toast dit « rien rempli » devant un modèle sans prestation, et nomme le supplément pris comme modèle',
    /rien rempli/.test(sig) && /supplément ne porte pas de séjour/.test(sig));
  v('le toast relaie ce qui est laissé et les incohérences', /laissees/.test(sig) && /incoherences/.test(sig));
  const bib = lire('../components/Bibliotheque.tsx');
  v('le contrôle permanent est branché : la Bibliothèque appelle verifierSejours', /verifierSejours\(data\.modeles\)/.test(bib));
}

const ko = r.filter(([, ok]) => !ok);
console.log(`\n=== ${r.length - ko.length}/${r.length} contrôles au vert ===`);
if (ko.length) console.log('  échecs : ' + ko.map(([n]) => n).join(' · '));
process.exit(ko.length ? 1 : 0);
