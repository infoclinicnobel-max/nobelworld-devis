/* Recette du remplissage des prestations depuis le catalogue — Veys, 22 août.

   Quatre fonctions pures de lib/catalogue.ts : natureLigne (ce qu'une ligne
   est), acteLePlusLong (qui donne les nuits), modelesDesActes (ce qu'un devis
   désigne), remplirPrestations (la fusion). Plus une garde de SOURCE : l'acte
   et le modèle passent par une seule règle.

   Les LISTES d'inclusions / exclusions sont des extraits RÉELS du catalogue,
   relevés en base le 22 août (après la réécriture de Veys) — BBL 7 j (2 nuits
   clinique + 4 hôtel), Rhinoplastie 6 j (1 + 4), Sleeve 4 j (2 + 1), Allurion
   1 j sans nuit, greffe osseuse dentaire sans durée, alopécie androgénétique
   sans durée mais avec deux lignes de nuits SANS NOMBRE (défaut de donnée
   signalé, non corrigé ici). Les DÉFAUTS sont ceux de nw_parametres (clé
   « societe ») le même jour. Un banc éprouve un mécanisme ; il ne décrit pas
   la base, qui bouge.

   Les trois points sous garde, chacun avec son jumeau positif :
   ① les services s'unissent sans doublon (clé du sélecteur) ;
   ② les nuits viennent du plus long et de lui seul, quel que soit l'ordre de
      sélection — et sans durée, aucune nuit ;
   ③ une ligne écrite par une main n'est jamais écrasée, rien n'est jamais
      retiré — seul le vocabulaire du système se remplace.

   Usage : npx tsx scripts/recette-remplissage-prestations.ts */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  acteLePlusLong, modelesDesActes, natureLigne, remplirPrestations, type Correspondance,
  type ContexteRemplissage,
} from '../lib/catalogue';
import type { Acte, Modele } from '../lib/types';

const r: [string, boolean][] = [];
const v = (nom: string, ok: boolean, detail = '') => {
  r.push([nom, ok]);
  console.log(`  ${ok ? '✓' : '✗'} ${nom}${detail ? ' — ' + detail : ''}`);
};
const egal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/* ---- extraits réels du catalogue (22 août) ---- */
const SERVICES_7J = [
  'consultation avec notre chirurgien', 'analyses préopératoires sanguine', 'anesthésie générale',
];
const SERVICES_FIN = [
  'transferts internes dans Istanbul', 'traductrice spécialiste médicale',
  '1 corset/gaine/coussin selon intervention', 'bas de contention', 'suivi postopératoire',
];
const INC_BBL = [...SERVICES_7J, '2 nuits en clinique', "4 nuits d'hôtel 5★", ...SERVICES_FIN];
const INC_RHINO = [...SERVICES_7J, '1 nuit en clinique', "4 nuits d'hôtel 5★", ...SERVICES_FIN];
const INC_SLEEVE = [...SERVICES_7J, '2 nuits en clinique', "1 nuit d'hôtel 5★", ...SERVICES_FIN];
const EXC = ["billets d'avion", 'médicaments', 'massages de drainage'];
const INC_ALLURION = [
  'consultation', 'analyses préopératoires', 'anesthésie', 'transferts', 'traductrice',
  'corset/gaine/coussin selon intervention', 'bas de contention', 'suivi postopératoire',
];
const INC_DENT = ['anesthésie', 'suivi postopératoire'];
const EXC_DENT = ["billets d'avion", 'médicaments', 'hôtel', 'transferts'];
const INC_ALOPECIE = [
  'consultation', 'analyses préopératoires', 'anesthésie', 'nuits en clinique', "nuits d'hôtel 5★",
  'transferts', 'traductrice', 'corset/gaine/coussin selon intervention', 'bas de contention',
  'suivi postopératoire',
];

const modele = (id: string, nom: string, o: Partial<Modele> = {}): Modele =>
  ({ id, nom, categorie: 'esthetique', sousCategorie: 'corps', nature: 'catalogue', prixBase: 1000,
    prixStandard: null, surDevis: false, description: '', notesInternes: '', synonymes: [],
    inc: [], exc: [], dureeJours: null, dureeNuits: null, actif: true, ordre: null, ...o }) as Modele;

const BBL = modele('cat-bbl-seul', 'BBL seul', { inc: INC_BBL, exc: EXC, dureeJours: 7, dureeNuits: 6 });
const ABDO = modele('cat-abdominoplastie', 'Abdominoplastie', { inc: INC_BBL, exc: EXC, dureeJours: 7, dureeNuits: 6 });
const RHINO = modele('alc-rhinoplastie', 'Rhinoplastie', { inc: INC_RHINO, exc: EXC, dureeJours: 6, dureeNuits: 5, sousCategorie: 'visage' });
const SLEEVE = modele('pkg-sleeve-gastrectomie', 'Sleeve gastrectomie', { inc: INC_SLEEVE, exc: EXC, dureeJours: 4, dureeNuits: 3, categorie: 'bariatrique' });
const ALLURION = modele('bar-ballon-gastrique-allurion', 'Ballon gastrique / Allurion', { inc: INC_ALLURION, exc: EXC, dureeJours: 1, dureeNuits: 0, categorie: 'bariatrique' });
const DENT = modele('dent-greffe-osseuse', 'Greffe osseuse synthétique', { inc: INC_DENT, exc: EXC_DENT, categorie: 'dentaire', nature: 'acte' });
const ALOPECIE = modele('cap-alopecie-androgenetique', 'Traitement alopécie androgénétique', { inc: INC_ALOPECIE, exc: EXC, categorie: 'capillaire' });
const TOUS = [BBL, ABDO, RHINO, SLEEVE, ALLURION, DENT, ALOPECIE];

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
const nuits = (inc: string[], nature: 'clinique' | 'hotel') => inc.filter((l) => natureLigne(l) === nature);

console.log('\n=== 1. natureLigne — ce qu\'une ligne est ===');
{
  v('« 2 nuits en clinique » → clinique', natureLigne('2 nuits en clinique') === 'clinique');
  v('« 1 nuit en clinique » (singulier) → clinique', natureLigne('1 nuit en clinique') === 'clinique');
  v('« 4 nuits d\'hôtel 5★ » → hôtel', natureLigne("4 nuits d'hôtel 5★") === 'hotel');
  v('« 1 nuit d\'hôtel » (sans étoiles) → hôtel', natureLigne("1 nuit d'hôtel") === 'hotel');
  v('« nuits d\'hôtel 5★ » (sans nombre, alopécie) → hôtel quand même', natureLigne("nuits d'hôtel 5★") === 'hotel');
  v('« Hôtel 5★ avec petit-déjeuner » (défaut) → service : pas de nuit dedans',
    natureLigne('Hôtel 5★ avec petit-déjeuner') === 'service');
  v('« Bloc opératoire et hospitalisation » → service', natureLigne('Bloc opératoire et hospitalisation') === 'service');
  v('« suivi postopératoire » → service', natureLigne('suivi postopératoire') === 'service');
  v('vide → service (inerte)', natureLigne('') === 'service');
}

console.log('\n=== 2. acteLePlusLong — qui donne les nuits ===');
{
  v('[Rhino 6 j, BBL 7 j] → BBL', acteLePlusLong([RHINO, BBL])?.id === BBL.id);
  v('[BBL 7 j, Rhino 6 j] → BBL — l\'ordre ne compte pas', acteLePlusLong([BBL, RHINO])?.id === BBL.id);
  v('ex æquo [BBL, Abdo] → BBL, le premier du devis', acteLePlusLong([BBL, ABDO])?.id === BBL.id);
  v('JUMEAU ex æquo [Abdo, BBL] → Abdo — stable, jamais le dernier choisi', acteLePlusLong([ABDO, BBL])?.id === ABDO.id);
  v('[Dentaire sans durée, Sleeve 4 j] → Sleeve', acteLePlusLong([DENT, SLEEVE])?.id === SLEEVE.id);
  v('[Dentaire sans durée] → personne', acteLePlusLong([DENT]) === undefined);
  v('[] → personne', acteLePlusLong([]) === undefined);
}

console.log('\n=== 3. modelesDesActes — ce que le devis désigne, jamais une « a_verifier » ===');
{
  const a = (acte: string): Acte => ({ id: 'a' + acte.length, acte, inclus: '' });
  const CORRESP: Correspondance[] = [
    { libelle: 'SAFE BBL', catalogueId: BBL.id, statut: 'a_verifier' },
  ];
  const VALIDE: Correspondance[] = CORRESP.map((c) => ({ ...c, statut: 'valide' }));
  v('« Rhinoplastie » → exact', egal(modelesDesActes([a('Rhinoplastie')], TOUS).map((m) => m.id), [RHINO.id]));
  v('« RHINOPLASTIE » → exact malgré la casse', egal(modelesDesActes([a('RHINOPLASTIE')], TOUS).map((m) => m.id), [RHINO.id]));
  v('GARDE — « SAFE BBL » par une correspondance a_verifier ne désigne RIEN',
    modelesDesActes([a('SAFE BBL')], TOUS, CORRESP).length === 0);
  v('JUMEAU — la MÊME correspondance passée valide désigne BBL',
    egal(modelesDesActes([a('SAFE BBL')], TOUS, VALIDE).map((m) => m.id), [BBL.id]));
  v('libellé inconnu → rien', modelesDesActes([a('Liposuccion 360')], TOUS).length === 0);
  v('le même acte cité deux fois compte une fois',
    modelesDesActes([a('Rhinoplastie'), a('rhinoplastie')], TOUS).length === 1);
  v('ligne vide → rien ; liste absente → rien',
    modelesDesActes([a('')], TOUS).length === 0 && modelesDesActes(undefined, TOUS).length === 0);
}

console.log('\n=== 4. Devis neuf — la liste encore aux défauts est remplacée franchement ===');
{
  const res = remplir({ inc: [...DEFAUTS.inc], exc: [...DEFAUTS.exc] }, [RHINO], RHINO);
  v('inc = la liste du catalogue, dans SON ordre (nuits au milieu)', egal(res.inc, INC_RHINO));
  v('exc = les exclusions du catalogue', egal(res.exc, EXC));
  v('les nuits font foi par Rhinoplastie', res.nuitsDe?.id === RHINO.id);
  v('13 lignes ajoutées, 0 remplacée', res.ajoutees.length === 13 && res.remplacees.length === 0);
  const vide = remplir({ inc: [], exc: [] }, [RHINO], RHINO);
  v('liste vide → même résultat', egal(vide.inc, INC_RHINO) && egal(vide.exc, EXC));
  const blanches = remplir({ inc: ['', '  '], exc: undefined }, [RHINO], RHINO);
  v('liste de lignes blanches → même résultat', egal(blanches.inc, INC_RHINO) && egal(blanches.exc, EXC));
  const casse = remplir({ inc: DEFAUTS.inc.map((l) => l.toUpperCase()), exc: [...DEFAUTS.exc] }, [RHINO], RHINO);
  v('défauts en MAJUSCULES = toujours les défauts (clé du sélecteur) → remplacés', egal(casse.inc, INC_RHINO));
}

console.log('\n=== 5. ② Les nuits viennent du plus long, et de lui seul ===');
{
  // Rhinoplastie d'abord, puis BBL : le devis devient un séjour de 7 jours.
  const apres = remplir({ inc: [...INC_RHINO], exc: [...EXC] }, [RHINO, BBL], BBL);
  v('Rhino puis BBL : toujours 10 lignes — les services ne doublent pas', apres.inc.length === 10, String(apres.inc.length));
  v('la nuit de clinique devient « 2 nuits en clinique »', egal(nuits(apres.inc, 'clinique'), ['2 nuits en clinique']));
  v('l\'hôtel reste « 4 nuits d\'hôtel 5★ » — identique, donc rien à dire', egal(nuits(apres.inc, 'hotel'), ["4 nuits d'hôtel 5★"]));
  v('le remplacement est DIT : 1 nuit → 2 nuits', egal(apres.remplacees, [{ avant: '1 nuit en clinique', apres: '2 nuits en clinique' }]));
  v('il reste à sa place (index 3), pas à la fin', apres.inc[3] === '2 nuits en clinique');
  v('aucune ligne ajoutée — rien ne manquait', apres.ajoutees.length === 0);
  v('les nuits font foi par BBL', apres.nuitsDe?.id === BBL.id);

  // JUMEAU : BBL d'abord, puis Rhinoplastie — le plus long reste BBL.
  const inverse = remplir({ inc: [...INC_BBL], exc: [...EXC] }, [BBL, RHINO], RHINO);
  v('JUMEAU BBL puis Rhino : la liste ne bouge pas d\'une ligne', egal(inverse.inc, INC_BBL));
  v('… rien remplacé, rien ajouté, BBL fait toujours foi',
    inverse.remplacees.length === 0 && inverse.ajoutees.length === 0 && inverse.nuitsDe?.id === BBL.id);

  // Ex æquo : un second acte de 7 jours ne fait pas basculer les nuits.
  const exaequo = remplir({ inc: [...INC_BBL], exc: [...EXC] }, [BBL, ABDO], ABDO);
  v('BBL puis Abdominoplastie (7 j aussi) : inchangé, BBL garde la main', egal(exaequo.inc, INC_BBL) && exaequo.nuitsDe?.id === BBL.id);

  /* Conséquence LITTÉRALE de la règle « du plus long et de lui seul » : une
     sleeve (4 j, 2 nuits clinique) jointe à une rhinoplastie (6 j, 1 nuit) perd
     sa seconde nuit de clinique. C'est la spécification telle qu'écrite ;
     l'alternative (le maximum PAR NATURE : 2 clinique + 4 hôtel) est signalée
     à Veys, pas construite. Ce contrôle fige le comportement pour que tout
     changement soit visible. */
  const mixte = remplir({ inc: [...INC_SLEEVE], exc: [...EXC] }, [SLEEVE, RHINO], RHINO);
  v('Sleeve puis Rhino : les nuits sont celles de la Rhino (1 + 4) — littéral, signalé',
    egal(nuits(mixte.inc, 'clinique'), ['1 nuit en clinique']) && egal(nuits(mixte.inc, 'hotel'), ["4 nuits d'hôtel 5★"]));
}

console.log('\n=== 6. ③ Une main n\'est jamais écrasée, rien n\'est jamais retiré ===');
{
  const negocie = "5 nuits d'hôtel 5★ (négocié)";
  const humain = INC_RHINO.map((l) => (l === "4 nuits d'hôtel 5★" ? negocie : l));
  humain.splice(5, 0, 'Massage lymphatique offert');        // une ligne de la main, au milieu
  const res = remplir({ inc: humain, exc: [...EXC] }, [RHINO, BBL], BBL);
  v('la nuit d\'hôtel négociée reste mot pour mot', res.inc.includes(negocie));
  v('… et aucune seconde ligne d\'hôtel n\'apparaît', nuits(res.inc, 'hotel').length === 1, nuits(res.inc, 'hotel').join(' | '));
  v('la nuit de clinique, vocabulaire du système, est remplacée (1 → 2)', egal(nuits(res.inc, 'clinique'), ['2 nuits en clinique']));
  v('la ligne de la main est toujours là, à sa place', res.inc[5] === 'Massage lymphatique offert');
  v('chaque ligne d\'avant est encore présente — rien retiré', humain.every((l) => res.inc.includes(l) || l === '1 nuit en clinique'));
  v('l\'ordre des lignes d\'avant est conservé',
    humain.filter((l) => l !== '1 nuit en clinique').every((l, i, arr) => i === 0 || res.inc.indexOf(l) > res.inc.indexOf(arr[i - 1])));

  // JUMEAU : la même liste où la nuit d'hôtel est restée « du système » est, elle, alignée.
  const systeme = INC_RHINO.map((l) => (l === "4 nuits d'hôtel 5★" ? "1 nuit d'hôtel 5★" : l));
  const al = remplir({ inc: systeme, exc: [...EXC] }, [RHINO, BBL], BBL);
  v('JUMEAU : « 1 nuit d\'hôtel 5★ » (vocabulaire du catalogue) est alignée sur BBL → 4 nuits',
    egal(nuits(al.inc, 'hotel'), ["4 nuits d'hôtel 5★"]));

  // Doublons par la clé : casse et accents ne font pas une seconde ligne.
  const retouche = ['Suivi Postopératoire', 'ANESTHÉSIE GÉNÉRALE', 'Massage lymphatique offert'];
  const dd = remplir({ inc: retouche, exc: ['Médicaments'] }, [RHINO], RHINO);
  v('« Suivi Postopératoire » / « ANESTHÉSIE GÉNÉRALE » ne sont pas réajoutés',
    dd.inc.filter((l) => natureLigne(l) === 'service').length === retouche.length + (INC_RHINO.length - 2) - 2);
  v('les lignes retouchées gardent leur graphie', dd.inc[0] === 'Suivi Postopératoire' && dd.inc[1] === 'ANESTHÉSIE GÉNÉRALE');
  v('« Médicaments » (majuscule) n\'est pas doublé dans les exclusions', dd.exc.filter((l) => /m[ée]dicaments/i.test(l)).length === 1);
  v('les nuits manquantes s\'ajoutent (liste retouchée sans nuit)', nuits(dd.inc, 'clinique').length === 1 && nuits(dd.inc, 'hotel').length === 1);

  // Les lignes blanches de saisie restent des lignes blanches.
  const blanches = remplir({ inc: ['Massage lymphatique offert', '', ''], exc: [] }, [RHINO], RHINO);
  v('deux lignes blanches d\'une liste retouchée sont conservées', blanches.inc.filter((l) => l === '').length === 2);

  // Idempotence : rechoisir le même acte ne change rien.
  const une = remplir({ inc: [...DEFAUTS.inc], exc: [...DEFAUTS.exc] }, [RHINO], RHINO);
  const deux = remplir(une, [RHINO], RHINO);
  v('rechoisir Rhinoplastie : rien n\'est ajouté ni remplacé', egal(deux.inc, une.inc) && egal(deux.exc, une.exc) && !deux.ajoutees.length && !deux.remplacees.length);
}

console.log('\n=== 7. Sans durée au catalogue, aucune nuit — rien n\'est deviné ===');
{
  const dent = remplir({ inc: [...DEFAUTS.inc], exc: [...DEFAUTS.exc] }, [DENT], DENT);
  v('greffe osseuse seule : 2 lignes, aucune nuit, personne ne fait foi',
    egal(dent.inc, INC_DENT) && dent.nuitsDe === undefined);
  v('… exclusions dentaires (hôtel, transferts) reprises', egal(dent.exc, EXC_DENT));
  const alo = remplir({ inc: [...DEFAUTS.inc], exc: [...DEFAUTS.exc] }, [ALOPECIE], ALOPECIE);
  v('alopécie (séance d\'1 h) : ses deux lignes « nuits » SANS NOMBRE ne passent pas',
    nuits(alo.inc, 'clinique').length === 0 && nuits(alo.inc, 'hotel').length === 0 && alo.inc.length === 8);
  const allurion = remplir({ inc: [...DEFAUTS.inc], exc: [...DEFAUTS.exc] }, [ALLURION], ALLURION);
  v('Allurion (1 j, 0 nuit) : la liste du catalogue telle quelle, sans nuit', egal(allurion.inc, INC_ALLURION));
  const dentSurRhino = remplir({ inc: [...INC_RHINO], exc: [...EXC] }, [RHINO, DENT], DENT);
  v('dentaire ajouté à une rhino : les nuits de la rhino ne bougent pas', egal(nuits(dentSurRhino.inc, 'clinique'), ['1 nuit en clinique']) && dentSurRhino.nuitsDe?.id === RHINO.id);
  v('… « hôtel » et « transferts » rejoignent les exclusions — union, visible, à la main de Veys',
    dentSurRhino.exc.includes('hôtel') && dentSurRhino.exc.includes('transferts'));
}

console.log('\n=== 8. Garde de source — une seule règle, à la sélection seulement ===');
{
  const chemin = fileURLToPath(new URL('../components/Devis.tsx', import.meta.url));
  const src = readFileSync(chemin, 'utf8');
  const corps = (nom: string) => {
    const debut = src.indexOf(`const ${nom} = `);
    if (debut < 0) return '';
    const fin = src.indexOf('\n  };', debut);
    return fin < 0 ? src.slice(debut) : src.slice(debut, fin);
  };
  const apply = corps('applyModele');
  const acte = corps('acteDepuisModele');
  const opt = corps('optDepuisModele');
  v('applyModele existe et ne porte plus sa propre règle inc/exc', !!apply && !/\binc:/.test(apply) && !/\bexc:/.test(apply));
  v('applyModele passe par acteDepuisModele — une règle, pas deux', /acteDepuisModele\(m\)/.test(apply));
  v('acteDepuisModele appelle remplirPrestations', /remplirPrestations\(/.test(acte));
  v('acteDepuisModele résout les actes par modelesDesActes (exact / valide seulement)', /modelesDesActes\(/.test(acte));
  v('optDepuisModele (options) ne remplit PAS les prestations', !!opt && !/remplirPrestations\(/.test(opt));
  v('aucun useEffect ne déclenche le remplissage — sélection seulement',
    !/useEffect\([^)]*remplirPrestations/s.test(src) && (src.match(/remplirPrestations\(/g) || []).length === 1);
}

const ko = r.filter(([, ok]) => !ok);
console.log(`\n=== ${r.length - ko.length}/${r.length} contrôles au vert ===`);
if (ko.length) console.log('  échecs : ' + ko.map(([n]) => n).join(' · '));
process.exit(ko.length ? 1 : 0);
