/* Rapport de rattrapage des fiches CRM — N'ÉCRIT RIEN.

   Pourquoi un script et non du SQL : le rapport doit employer EXACTEMENT la
   même comparaison et la même hiérarchie que le flux. Réécrites en SQL, elles
   divergeraient — c'est déjà arrivé (le premier rapport comparait en `lower()`
   et criait cinq fausses divergences « Dr Anvar Ahmedov » contre « Anvar
   Ahmedov »). Ici, `planifierRemontee` et `documentQuiFaitFoi` sont IMPORTÉES
   de lib/fiche.ts : il ne peut pas exister deux règles.

   Usage :
     npx tsx scripts/rattrapage-fiches.ts instantane.json

   Le fichier attendu :
     { "patients": [...lignes patients...],
       "devis":    [...lignes nw_devis...],
       "factures": [...lignes nw_factures...] } */

import { readFileSync } from 'node:fs';
import { rowToDevis, rowToFacture } from '../lib/mappers';
import { CHAMPS_REMONTES, documentQuiFaitFoi, normaliser, planifierRemontee } from '../lib/fiche';
import type { DocRecord } from '../lib/types';

type Row = Record<string, any>;

const snap = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const patients: Row[] = snap.patients || [];
const devis: DocRecord[] = (snap.devis || []).map(rowToDevis);
const factures: DocRecord[] = (snap.factures || []).map(rowToFacture);

const parPatient = <T extends DocRecord>(list: T[]) => {
  const m = new Map<string, T[]>();
  for (const d of list) {
    const k = String(d.patientId || '');
    if (!k) continue;
    (m.get(k) || m.set(k, []).get(k)!).push(d);
  }
  return m;
};
const devisDe = parPatient(devis);
const facturesDe = parPatient(factures);

/* Un nom de praticien sans patronyme (« Dr Anvar ») ne part jamais dans un
   dossier patient : on le signale au client, on ne devine pas le nom manquant. */
const patronymeManquant = (v: string) => normaliser(v).split(' ').filter(Boolean).length < 2;

const aRemplir: string[][] = [];
const divergences: string[][] = [];
const aCompleter: string[][] = [];
const sansSource: string[][] = [];

for (const p of patients) {
  const nom = `${p.prenom || ''} ${p.nom || ''}`.trim();
  const src = documentQuiFaitFoi(devisDe.get(String(p.id)) || [], facturesDe.get(String(p.id)) || []);
  if (!src) {
    if ((devisDe.get(String(p.id)) || []).length || (facturesDe.get(String(p.id)) || []).length) {
      sansSource.push([nom, 'aucun document vivant (brouillons ou facture annulée)']);
    }
    continue;
  }
  const doc = src.doc;
  const etiquette = `${src.type === 'facture' ? 'facture' : 'devis'} ${doc.numero || '(sans numéro)'}`;
  const plan = planifierRemontee(doc, p as never);

  for (const [colonne, valeur] of Object.entries(plan.aEcrire)) {
    const libelle = CHAMPS_REMONTES.find((c) => c.fiche === colonne)?.libelle || colonne;
    if (colonne === 'medecin' && patronymeManquant(valeur)) {
      aCompleter.push([nom, libelle, valeur, etiquette]);
    } else {
      aRemplir.push([nom, libelle, valeur, etiquette]);
    }
  }
  for (const d of plan.divergences) {
    divergences.push([nom, d.libelle, d.valeurCrm, d.valeurDevis, etiquette]);
  }
}

const table = (titre: string, entetes: string[], lignes: string[][]) => {
  console.log(`\n=== ${titre} — ${lignes.length} ligne(s) ===`);
  if (!lignes.length) { console.log('  (aucune)'); return; }
  const l = entetes.map((h, i) => Math.max(h.length, ...lignes.map((r) => (r[i] || '').length)));
  console.log('  ' + entetes.map((h, i) => h.padEnd(l[i])).join(' │ '));
  for (const r of lignes) console.log('  ' + r.map((c, i) => (c || '').padEnd(l[i])).join(' │ '));
};

table('SERAIT REMPLI (champ CRM vide)', ['fiche', 'colonne', 'valeur qui arrive', 'document'], aRemplir);
table('DIVERGE — non touché', ['fiche', 'colonne', 'au CRM', 'au document', 'document'], divergences);
table('NOM TRONQUÉ — à compléter par le client', ['fiche', 'colonne', 'valeur', 'document'], aCompleter);
table('AUCUN DOCUMENT VIVANT', ['fiche', 'raison'], sansSource);
console.log('\nAucune écriture. Ce script lit un instantané JSON et n\'ouvre aucune connexion.');
