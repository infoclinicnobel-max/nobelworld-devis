/* Rapport de rattrapage des fiches CRM — N'ÉCRIT RIEN, ET N'OUVRE AUCUNE CONNEXION.

   Pourquoi un script et non du SQL : le rapport doit employer EXACTEMENT la
   même comparaison et la même hiérarchie que le flux. Réécrites en SQL, elles
   divergeraient — c'est déjà arrivé (le premier rapport comparait en `lower()`
   et criait cinq fausses divergences « Dr Anvar Ahmedov » contre « Anvar
   Ahmedov »). Ici, `planifierRemontee` et `documentQuiFaitFoi` sont IMPORTÉES
   de lib/fiche.ts : il ne peut pas exister deux règles.

   Usage :
     npx tsx scripts/rattrapage-fiches.ts instantane.json          → les cinq listes
     npx tsx scripts/rattrapage-fiches.ts instantane.json --sql    → les UPDATE à passer

   `--sql` n'exécute rien : il IMPRIME le SQL, qui est relu puis passé à la main.
   L'invariant du fichier tient donc toujours — aucun client, aucune connexion,
   aucune écriture — et la consigne « rends le SQL exact avant de l'exécuter »
   est honorée par construction.

   Le fichier attendu :
     { "patients": [...lignes patients...],
       "devis":    [...lignes nw_devis...],
       "factures": [...lignes nw_factures...] } */

import { readFileSync } from 'node:fs';
import { rowToDevis, rowToFacture, rowToPaiement } from '../lib/mappers';
import {
  aPaye, CHAMPS_REMONTES, COLONNES_AUTORISEES, documentQuiFaitFoi, niveauEngagement, normaliser,
  planifierRemontee,
} from '../lib/fiche';
import type { DocRecord } from '../lib/types';

type Row = Record<string, any>;

const enSql = process.argv.includes('--sql');
const snap = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const patients: Row[] = snap.patients || [];
const devis: DocRecord[] = (snap.devis || []).map(rowToDevis);
const factures: DocRecord[] = (snap.factures || []).map(rowToFacture);
const paiements = (snap.paiements || []).map(rowToPaiement);

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
/* Une valeur de stade inconnue gèlerait la fiche en silence : on la nomme. */
const horsEchelle: string[][] = [];

/* Ce que `--sql` émettra. `avant` est la valeur LUE dans l'instantané : elle
   devient la condition de l'UPDATE, pas seulement une note. */
interface Ecriture { id: string; colonne: string; valeur: string; avant: string; nom: string; doc: string }
const ecritures: Ecriture[] = [];

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
  /* Même OU que le flux : devis accepté ou paiement existant. `aPaye` cherche
     aussi par facture, parce que 3 paiements sur 12 n'ont pas de patient_id. */
  const sesDevis = devisDe.get(String(p.id)) || [];
  const sesFactures = facturesDe.get(String(p.id)) || [];
  const engagement = niveauEngagement(
    sesDevis,
    aPaye(paiements, String(p.id), sesFactures.map((f) => String(f.id || ''))),
  );
  const plan = planifierRemontee(doc, p as never, { engagement });
  if (plan.stadeHorsEchelle) horsEchelle.push([nom, plan.stadeHorsEchelle, etiquette]);

  for (const [colonne, valeur] of Object.entries(plan.aEcrire)) {
    const libelle = CHAMPS_REMONTES.find((c) => c.fiche === colonne)?.libelle || colonne;
    if (colonne === 'medecin' && patronymeManquant(valeur)) {
      aCompleter.push([nom, libelle, valeur, etiquette]);
    } else {
      aRemplir.push([nom, libelle, valeur, etiquette]);
      ecritures.push({
        id: String(p.id), colonne, valeur, avant: String(p[colonne] ?? ''), nom, doc: etiquette,
      });
    }
  }
  for (const d of plan.divergences) {
    divergences.push([nom, d.libelle, d.valeurCrm, d.valeurDevis, etiquette]);
  }
}

/* ------------------------------------------------------------------ --sql

   Un UPDATE par champ, et chacun porte SA garde. La garde ne vit pas seulement
   dans ce script : elle part avec l'ordre. Deux conséquences voulues —
   l'opération est rejouable sans risque, et un instantané périmé ne peut pas
   écraser une saisie faite entre-temps.

   La condition est la même pour les six colonnes : « la case contient toujours
   exactement ce que le rapport y a lu ». Pour les cinq colonnes strictes cette
   valeur est la chaîne vide, ce qui redit la règle « on n'écrit que si vide ».
   Pour `stade`, c'est un verrou : si quelqu'un a fait avancer la fiche depuis
   l'instantané, la ligne n'est pas touchée — le rattrapage ne peut donc jamais
   faire RECULER un stade, même avec des données périmées. Le rang, lui, a été
   calculé plus haut par `planifierRemontee` ; le SQL ne réimplémente aucune
   règle, il ne fait que sceller ce qui a été observé. */
const litteral = (v: string) => `'${v.replace(/'/g, "''")}'`;
/* Les colonnes sont en camelCase et l'une d'elles s'appelle `procedure`, mot
   réservé : sans guillemets doubles, Postgres lit `procedure` en minuscules et
   refuse l'ordre. */
const colonne = (v: string) => `"${v.replace(/"/g, '""')}"`;

if (enSql) {
  /* Ceinture et bretelles : le même contrôle que `lib/data.ts` fait avant
     d'envoyer un PATCH. Une colonne hors liste ne doit pas pouvoir être émise,
     même par accident de programmation. */
  for (const e of ecritures) {
    if (!COLONNES_AUTORISEES.has(e.colonne)) {
      console.error(`REFUS : colonne « ${e.colonne} » hors liste blanche.`);
      process.exit(1);
    }
  }
  const lignes = [
    '-- Rattrapage des fiches CRM — engendré par scripts/rattrapage-fiches.ts',
    `-- ${ecritures.length} champ(s), ${new Set(ecritures.map((e) => e.id)).size} fiche(s).`,
    '-- UPDATE uniquement. Aucun INSERT, aucun DELETE, aucun DDL.',
    `-- Colonnes touchées : ${[...new Set(ecritures.map((e) => e.colonne))].sort().join(', ')}.`,
    '-- Chaque ordre est gardé sur la valeur lue : rejouable, et sans effet si',
    '-- la case a été renseignée entre-temps.',
    '',
  ];
  let fiche = '';
  for (const e of ecritures) {
    if (e.nom !== fiche) { lignes.push(`-- ${e.nom} — ${e.doc}`); fiche = e.nom; }
    lignes.push(
      `update public.patients set ${colonne(e.colonne)} = ${litteral(e.valeur)}`
      + ` where id = ${litteral(e.id)}`
      + ` and coalesce(${colonne(e.colonne)}, '') = ${litteral(e.avant)};`,
    );
  }
  console.log(lignes.join('\n'));
  process.exit(0);
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
table('STADE HORS ÉCHELLE — fiche gelée tant que la valeur n\'est pas corrigée',
  ['fiche', 'valeur trouvée', 'document'], horsEchelle);
console.log('\nAucune écriture. Ce script lit un instantané JSON et n\'ouvre aucune connexion.');
