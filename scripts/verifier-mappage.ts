/* Contrôle d'aller-retour des convertisseurs colonne ⇄ objet applicatif.
   Pour chaque ligne réellement présente en base : row → objet → row, puis
   comparaison colonne par colonne. Toute divergence signalerait une perte
   de données à la première réécriture d'un document.

   Usage : npx tsx scripts/verifier-mappage.ts <instantane.json>            */

import { readFileSync } from 'node:fs';
import {
  devisToRow, factureToRow, optionToRow, paiementToRow, patientToRow,
  rowToDevis, rowToFacture, rowToOption, rowToPaiement, rowToPatient,
} from '../lib/mappers';

type Row = Record<string, any>;
const snap = JSON.parse(readFileSync(process.argv[2] || 'db.json', 'utf8'));

let ecarts = 0;
/* Comparaison en profondeur, insensible à l'ordre des clés : Postgres ne conserve
   pas l'ordre d'insertion d'un jsonb, seule l'égalité structurelle a un sens. */
const trier = (v: any): any =>
  Array.isArray(v) ? v.map(trier)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, trier(v[k])]))
  : v;
const egal = (a: unknown, b: unknown) => JSON.stringify(trier(a ?? null)) === JSON.stringify(trier(b ?? null));

function verifier(nom: string, rows: Row[], aller: (r: Row) => any, retour: (o: any) => Row, ignore: string[]) {
  let ko = 0;
  for (const row of rows || []) {
    const refait = retour(aller(row));
    for (const col of Object.keys(row)) {
      if (ignore.includes(col)) continue;
      if (!(col in refait)) { console.log(`  ✗ ${nom} ${row.id} : colonne « ${col} » absente après conversion`); ko++; continue; }
      const av = row[col];
      const ap = refait[col];
      // numeric revient en chaîne depuis PostgREST ; on compare numériquement
      const num = typeof ap === 'number' && av != null && !isNaN(Number(av));
      const ok = num ? Number(av) === ap : egal(av, ap);
      if (!ok) { console.log(`  ✗ ${nom} ${row.id} · ${col} : ${JSON.stringify(av)} → ${JSON.stringify(ap)}`); ko++; }
    }
  }
  console.log(`${ko === 0 ? '✓' : '✗'} ${nom} : ${(rows || []).length} ligne(s), ${ko} écart(s)`);
  ecarts += ko;
}

const AUTEUR = 'Veys Turan';
verifier('nw_devis', snap.devis, rowToDevis, (o) => devisToRow(o, AUTEUR), ['created_at', 'updated_at']);
verifier('nw_factures', snap.factures, rowToFacture, (o) => factureToRow(o, AUTEUR), ['created_at', 'updated_at']);
verifier('nw_paiements', snap.paiements, rowToPaiement, (o) => paiementToRow(o), ['created_at', 'updated_at']);
verifier('nw_options', snap.options, rowToOption, (o) => optionToRow(o), ['created_at', 'updated_at']);
/* patients : Nobel World n'écrit qu'un sous-ensemble de colonnes (les autres
   appartiennent au CRM et ne sont jamais touchées) — on ne vérifie que celles-là. */
verifier(
  'patients (colonnes écrites)',
  (snap.patients || []).map((p: Row) => ({ id: p.id, prenom: p.prenom, nom: p.nom, email: p.email, tel: p.tel, pays: p.pays, ville: p.ville, notes: p.notes })),
  rowToPatient,
  (o) => patientToRow(o, AUTEUR),
  ['created_at', 'updated_at'],
);

console.log(ecarts === 0 ? '\n✓ Aucun écart : aucune donnée perdue à la réécriture.' : `\n✗ ${ecarts} écart(s)`);
process.exit(ecarts === 0 ? 0 : 1);
