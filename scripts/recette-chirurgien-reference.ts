/* Recette du chirurgien référencé — 23 août.

   Le préalable de la majoration par chirurgien : un document porte désormais
   `medecinId`, référence vers `medecins.id`, À CÔTÉ du texte `chirurgien` qui
   s'imprime. Les 25 devis et 15 factures d'avant ce jour ont reçu la
   référence par correspondance normalisée du texte (18 Ahmedov, 5 Zeynalov,
   1 Uyanik ; « AANVAR AHMEDOV » et la ligne vide restent NULL) — sans qu'une
   seule autre colonne bouge, ce que le diff contre les tables de sauvegarde
   du 23 août a mesuré. Ce banc éprouve le MÉCANISME applicatif :

   1. la colonne traverse lecture et écriture sans jamais être déduite du
      texte, ni le texte de la colonne ;
   2. la liste de l'éditeur — six lignes de la table, Dr Ahmedov en tête,
      aucun pré-remplissage ;
   3. le geste de choisir, seule voie par laquelle le texte change.

   Les six chirurgiens sont la table `medecins` relevée le 23 août. Un banc
   éprouve un mécanisme ; il ne décrit pas la base, qui bouge.

   Usage : npx tsx scripts/recette-chirurgien-reference.ts */

import { devisToRow, factureToRow, rowToDevis, rowToFacture, rowToMedecin } from '../lib/mappers';
import { choisirMedecin, MEDECIN_EN_TETE, ordonnerMedecins } from '../lib/medecins';
import type { DocRecord, Medecin } from '../lib/types';

const r: [string, boolean][] = [];
const v = (nom: string, ok: boolean, detail = '') => {
  r.push([nom, ok]);
  console.log(`  ${ok ? '✓' : '✗'} ${nom}${detail ? ' — ' + detail : ''}`);
};

const AUTEUR = 'Veys Turan';

/* ---- la table medecins, relevée le 23 août (ordre de la base : nomAffiche) ---- */
const TABLE = [
  { id: 'med_akin_unal', nomAffiche: 'Dr Akin Unal', spec: 'Chirurgie bariatrique', actif: 'true' },
  { id: 'med_anvar_ahmedov', nomAffiche: 'Dr Anvar Ahmedov', spec: 'Chirurgie esthétique', actif: 'true' },
  { id: 'med_azar_zeynalov', nomAffiche: 'Dr Azar Zeynalov', spec: 'Chirurgie esthétique', actif: 'true' },
  { id: 'med_elif_ozturk', nomAffiche: 'Dr Elif Ozturk', spec: 'Greffe capillaire', actif: 'true' },
  { id: 'med_orkun_uyanik', nomAffiche: 'Dr Orkun Uyanik', spec: 'Chirurgie esthétique', actif: 'true' },
  { id: 'med_vsc_dental', nomAffiche: 'Dr VSC Dental', spec: 'Dentaire', actif: 'true' },
];
const MEDECINS: Medecin[] = TABLE.map(rowToMedecin);

/* Une ligne nw_devis telle que PostgREST la rend, colonnes du 23 août. */
const ligne = (o: Record<string, unknown> = {}) => ({
  id: 'dev_banc', numero: 'D-2026-000099', patient_id: 'pat_banc', date: '2026-08-23', validite: '2026-08-31',
  date_intervention: null, chirurgien: '', medecin_id: null, hopital: 'Avrasya Hastanesi — Istanbul, Türkiye',
  statut: 'brouillon', devise: 'EUR', acompte: 0, forfait: 3300, remise_type: 'montant', remise_valeur: 0,
  remise_motif: null, contenu: { actes: [{ id: 'a1', acte: 'Rhinoplastie', inclus: '' }], promoJours: 8 },
  cree_par: AUTEUR, created_at: '2026-08-23T08:00:00+00:00', updated_at: '2026-08-23T08:00:00+00:00',
  ...o,
});

console.log('\n— 1. La colonne traverse la lecture et l’écriture, jamais déduite du texte —');
{
  /* F-2026-000028 : texte fautif, référence NULL — la reprise ne l'a pas rattaché. */
  const d = rowToDevis(ligne({ chirurgien: 'AANVAR AHMEDOV', medecin_id: null }));
  v('medecin_id NULL se lit vide', d.medecinId === '');
  v('le texte libre se lit tel quel', d.chirurgien === 'AANVAR AHMEDOV');
  const w = devisToRow(d, AUTEUR);
  v('…et se réécrit NULL : la référence n’est pas devinée depuis le texte',
    w.medecin_id === null && w.chirurgien === 'AANVAR AHMEDOV');
}
{
  /* D-2026-000024 : « Dr Azar », rattaché à Zeynalov par la reprise. */
  const d = rowToDevis(ligne({ chirurgien: 'Dr Azar', medecin_id: 'med_azar_zeynalov' }));
  v('la référence se lit', d.medecinId === 'med_azar_zeynalov');
  v('le texte « Dr Azar » n’est PAS remplacé par le libellé canonique à la lecture', d.chirurgien === 'Dr Azar');
  const w = devisToRow(d, AUTEUR);
  v('réouvert puis réécrit sans geste : référence et texte identiques à la ligne',
    w.medecin_id === 'med_azar_zeynalov' && w.chirurgien === 'Dr Azar');
  v('…et le contenu gelé l’est toujours (promoJours)', (w.contenu as { promoJours?: number }).promoJours === 8);
}
{
  const f = rowToFacture(ligne({
    id: 'fac_banc', chirurgien: 'Anvar Ahmedov', medecin_id: 'med_anvar_ahmedov',
    numero_devis: 'D-2026-000099', devis_id: 'dev_banc', type_facture: 'acompte', note_interne: null,
  }));
  const w = factureToRow(f, AUTEUR);
  v('la facture lit et réécrit la colonne de la même façon',
    f.medecinId === 'med_anvar_ahmedov' && w.medecin_id === 'med_anvar_ahmedov' && w.chirurgien === 'Anvar Ahmedov');
}
{
  /* Devis NEUF, sans aucun geste sur le chirurgien : rien n'est pré-rempli. */
  const w = devisToRow({ chirurgien: '', forfait: 0, actes: [] } as DocRecord, AUTEUR);
  v('document neuf sans geste : medecin_id NULL et chirurgien vide — aucun Ahmedov par défaut',
    w.medecin_id === null && w.chirurgien === '');
  const w2 = devisToRow({ forfait: 0 } as DocRecord, AUTEUR);
  v('même sans le champ du tout', w2.medecin_id === null && w2.chirurgien === '');
}

console.log('\n— 2. La liste de l’éditeur —');
{
  const liste = ordonnerMedecins(MEDECINS);
  v('six lignes : aucune n’est filtrée (pas de filtre sur actif, doctrine v1.84)', liste.length === 6);
  v('Dr Ahmedov en tête', liste[0].id === MEDECIN_EN_TETE && liste[0].nomAffiche === 'Dr Anvar Ahmedov');
  v('puis l’ordre alphabétique',
    liste.slice(1).map((m) => m.nomAffiche).join(' | ')
      === 'Dr Akin Unal | Dr Azar Zeynalov | Dr Elif Ozturk | Dr Orkun Uyanik | Dr VSC Dental');
  v('la table reçue n’est pas réordonnée sur place', MEDECINS[0].id === 'med_akin_unal');
  v('une ligne sans libellé garde un id lisible, le filtrage est du ressort du chargement',
    rowToMedecin({ id: 'med_x', nomAffiche: '  ' }).nomAffiche === '');
}

console.log('\n— 3. Le geste de choisir, seule voie par laquelle le texte change —');
{
  const base: DocRecord = { chirurgien: '', medecinId: '', forfait: 0, actes: [] };
  const z = choisirMedecin(base, 'med_azar_zeynalov', MEDECINS);
  v('choisir Zeynalov pose la référence ET le texte canonique',
    z.medecinId === 'med_azar_zeynalov' && z.chirurgien === 'Dr Azar Zeynalov');
  v('le document de départ n’est pas muté', base.medecinId === '' && base.chirurgien === '');
  v('un identifiant absent de la liste ne change rien', choisirMedecin(z, 'med_inconnu', MEDECINS) === z);
  const vide = choisirMedecin(z, '', MEDECINS);
  v('revenir à « À confirmer » efface la référence et le texte', vide.medecinId === '' && vide.chirurgien === '');

  const ancien: DocRecord = { chirurgien: 'AANVAR AHMEDOV', medecinId: '', forfait: 5500, statut: 'envoye' };
  const corrige = choisirMedecin(ancien, 'med_anvar_ahmedov', MEDECINS);
  v('un ancien texte fautif, corrigé par le geste, prend le libellé canonique',
    corrige.chirurgien === 'Dr Anvar Ahmedov' && corrige.medecinId === 'med_anvar_ahmedov');
  v('…et rien d’autre ne bouge', corrige.forfait === 5500 && corrige.statut === 'envoye');
  v('sans liste (table illisible), choisir est refusé et ne change rien',
    choisirMedecin(ancien, 'med_anvar_ahmedov', []) === ancien);
}

/* ---- bilan ---- */
const ko = r.filter(([, ok]) => !ok);
console.log(`\n${ko.length ? '✗' : '✓'} ${r.length - ko.length}/${r.length} contrôles passés`);
if (ko.length) {
  console.log('Échecs :\n' + ko.map(([n]) => '  - ' + n).join('\n'));
  process.exit(1);
}
