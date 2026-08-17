/* Contrôle de non-régression des montants.

   Rejoue le total de chaque devis réellement présent en base à travers le vrai
   lib/calc.ts, et compare à un relevé de référence. C'est le garde-fou du lot
   « options retenues » : une option dépourvue du champ `retenue` doit continuer
   à compter, sans quoi des devis déjà acceptés changeraient de montant.

   Usage :
     npx tsx scripts/totaux-devis.ts devis.json            # imprime le relevé
     npx tsx scripts/totaux-devis.ts devis.json ref.json   # compare et sort en 1 si écart

   Le relevé « avant » se prend dans un arbre de travail placé sur le commit
   précédent (git worktree add --detach <dossier> HEAD), avec le même fichier.

   Le fichier attendu est un tableau de lignes nw_devis telles que renvoyées par
   Postgres : { numero, forfait, remise_type, remise_valeur, acompte, options, lignes }. */

import { readFileSync } from 'node:fs';
/* N'importe QUE totalOf, présent avant comme après le lot « options retenues » :
   le même script tourne donc à l'identique sur les deux versions du code, et la
   comparaison porte sur des montants réellement calculés, jamais recopiés. */
import { totalOf } from '../lib/calc';
import type { DocRecord } from '../lib/types';

type Row = Record<string, any>;

const versDoc = (r: Row): DocRecord => ({
  numero: r.numero,
  forfait: Number(r.forfait || 0),
  remiseType: r.remise_type ?? undefined,
  remiseValeur: Number(r.remise_valeur || 0),
  acompte: Number(r.acompte || 0),
  options: Array.isArray(r.options) ? r.options : [],
  lignes: Array.isArray(r.lignes) ? r.lignes : [],
});

const lire = (chemin: string) => JSON.parse(readFileSync(chemin, 'utf8'));

const rows: Row[] = lire(process.argv[2]);
const releve = rows.map((r) => {
  const d = versDoc(r);
  const total = totalOf(d);
  return {
    numero: r.numero || '(sans numéro)',
    statut: r.statut,
    total,
    reste: Math.max(0, total - Number(r.acompte || 0)),
    nbOptions: (d.options || []).length,
  };
});

const reference = process.argv[3] ? lire(process.argv[3]) : null;

if (!reference) {
  console.log(JSON.stringify(releve, null, 2));
  process.exit(0);
}

const parNumero = (l: typeof releve) => new Map(l.map((x) => [x.numero, x]));
const avant = parNumero(reference);
const apres = parNumero(releve);
const numeros = [...new Set([...avant.keys(), ...apres.keys()])].sort();

let ecarts = 0;
console.log('n° de devis'.padEnd(20), 'avant'.padStart(12), 'après'.padStart(12), '  reste avant / après');
for (const n of numeros) {
  const a = avant.get(n);
  const b = apres.get(n);
  const ok = a && b && a.total === b.total && a.reste === b.reste;
  if (!ok) ecarts++;
  console.log(
    (ok ? '  ' : '✗ ') + n.padEnd(18),
    String(a ? a.total : '—').padStart(12),
    String(b ? b.total : '—').padStart(12),
    '  ' + (a ? a.reste : '—') + ' / ' + (b ? b.reste : '—'),
  );
}
console.log(`\n${numeros.length - ecarts}/${numeros.length} devis au montant identique`);
process.exit(ecarts ? 1 : 0);
