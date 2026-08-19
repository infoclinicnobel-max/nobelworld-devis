/* La garde du chemin dédié à l'agenda. ÉCHOUE si la surface s'élargit.

   Ce contrôle existe parce que le danger n'est pas dans le code écrit
   aujourd'hui : il est dans la ligne qu'on ajoutera dans six mois. La voie
   évidente — inscrire « rdvs » dans TABLES_ECRITURE — ouvrirait INSERT, UPDATE
   ET DELETE, parce que cette liste commande aussi `supprimer()`. Elle a été
   écartée ; ce fichier est ce qui empêche qu'elle revienne par distraction.

   Usage :  npx tsx scripts/garde-agenda.ts        (sortie 1 si un contrôle casse)  */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RACINE = new URL('..', import.meta.url).pathname;
const IGNORES = new Set(['node_modules', '.next', '.git', 'scripts']);

function sources(dossier: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dossier)) {
    if (IGNORES.has(e)) continue;
    const p = join(dossier, e);
    if (statSync(p).isDirectory()) sources(p, acc);
    else if (/\.(ts|tsx)$/.test(e)) acc.push(p);
  }
  return acc;
}

/* On compte le CODE, pas les commentaires. Sans cela la garde crierait sur ses
   propres explications : ce fichier et lib/agenda.ts nomment la fonction dans
   leur en-tête, et une garde qui crie pour rien finit par ne plus être lue.
   Le retrait est volontairement conservateur — blocs et lignes entièrement
   commentées — pour ne jamais faire disparaître du code par accident. */
const sansCommentaires = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '')
   .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

const fichiers = sources(RACINE)
  .map((p) => ({ p: p.replace(RACINE, ''), t: sansCommentaires(readFileSync(p, 'utf8')) }));
const compter = (motif: RegExp) =>
  fichiers.flatMap((f) => (f.t.match(motif) || []).map(() => f.p));

let casses = 0;
const controle = (titre: string, ok: boolean, detail: string) => {
  console.log(`  ${ok ? '✓' : '✗'} ${titre}${ok ? '' : ' — ' + detail}`);
  if (!ok) casses++;
};

console.log("\n=== Garde du chemin agenda ===\n");

/* ① Une seule porte d'ÉCRITURE. Lire l'agenda n'est pas l'écrire : le pas
      anti-doublon doit bien interroger les rendez-vous existants, et compter
      cette lecture comme une infraction rendrait la garde inapplicable.
      `scripts/` est exclu du balayage : un rapport hors ligne n'est pas un
      chemin d'écriture de l'application. */
const portes = compter(/\.from\(\s*['"]rdvs['"]\s*\)[\s\S]{0,200}?\.insert\(/g);
controle(
  "un seul .from('rdvs') suivi d'un .insert() dans l'application",
  portes.length === 1 && portes[0] === 'lib/data.ts',
  `trouvé ${portes.length} fois : ${portes.join(', ') || '(nulle part)'}`,
);

/* ② Un seul appelant. La définition compte pour une occurrence, l'appel pour
      une seconde : trois signifierait qu'un second appelant est apparu. */
const mentions = compter(/insererRendezVousOperation/g);
controle(
  'insererRendezVousOperation : une définition, un appel, pas davantage',
  mentions.length === 2,
  `${mentions.length} mention(s) : ${mentions.join(', ')}`,
);

/* ③ Un seul verbe. Un .update/.delete/.upsert sur rdvs est le scénario que la
      contre-proposition existait pour empêcher. */
for (const verbe of ['update', 'delete', 'upsert']) {
  const m = compter(new RegExp(`\\.from\\(\\s*['"]rdvs['"]\\s*\\)[\\s\\S]{0,200}?\\.${verbe}\\(`, 'g'));
  controle(`aucun .${verbe}() sur rdvs`, m.length === 0, `dans ${m.join(', ')}`);
}

/* ④ La liste blanche n'a pas bougé — le diff d'une ligne n'est pas appliqué. */
const dataTs = fichiers.find((f) => f.p === 'lib/data.ts')!.t;
const liste = dataTs.match(/const TABLES_ECRITURE[\s\S]*?\);/)?.[0] || '';
controle("'rdvs' absent de TABLES_ECRITURE", !/['"]rdvs['"]/.test(liste), liste.trim());

/* ⑤ Aucun appelant ne peut même NOMMER la table par la voie générique. */
const typesTs = fichiers.find((f) => f.p === 'lib/types.ts')!.t;
controle(
  "'rdvs' absent du type Collection",
  !/export type Collection[^\n]*rdvs/.test(typesTs),
  'le type Collection mentionne rdvs',
);
const tableOf = dataTs.match(/const TABLE_OF[\s\S]*?\};/)?.[0] || '';
controle("'rdvs' absent de TABLE_OF", !/rdvs/.test(tableOf), tableOf.trim());

/* ⑥ Le type écrit ne peut pas venir de l'appelant. */
controle(
  "l'INSERT repose `type` depuis la constante",
  /\.insert\(\{\s*\.\.\.ligne,\s*type:\s*TYPE_OPERATION\s*\}\)/.test(dataTs),
  "l'insert ne réaffirme pas TYPE_OPERATION",
);

console.log(
  casses
    ? `\n=== ${casses} contrôle(s) CASSÉ(S) — la surface d'écriture s'est élargie ===\n`
    : '\n=== garde intacte : rdvs reste en INSERT seul, par une seule porte ===\n',
);
process.exit(casses ? 1 : 0);
