/* La caisse de la coordinatrice — lot 73, 30 août 2026.

   Le cycle, confirmé par Veys : la patiente paie en euros (espèces à Ceyda,
   ou virement au compte) ; Ceyda change une partie des euros en livres au
   bureau de change ; elle paie les chirurgiens en livres — SAUF le
   Dr Azar Zeynalov, payé en euros — ; elle rend le reste à la société en
   euros. Le point qui décide de tout : le CHANGE est un mouvement à part
   entière. Sans lui, « encaissé 5 000 € » et « payé 180 000 TL » ne se
   comparent pas, et une perte au change se dissout entre les deux.

   Doctrine du module :
   · le solde ne se SAISIT jamais, il se CALCULE — ce qui se saisit, c'est le
     comptage physique (caisse_arretes), et l'écart entre compté et calculé
     est le seul chiffre qui mérite une alerte ;
   · JAMAIS deux devises dans un même total, même « pour information » ;
   · un mouvement ne se supprime pas — il s'annule avec sa trace ;
   · aucun taux stocké : le taux du bureau de change se lit sur la ligne de
     change (montant / contrepartie), à l'affichage seulement ;
   · un montant qui ne caste pas est SIGNALÉ, jamais absent d'un total en
     silence — `montant` est du texte en base et le reste dans ce lot.

   Tout est pur : la recette scripts/recette-caisse.ts rejoue chaque règle,
   et soldesCaisse est le miroir de la vue SQL vue_caisse_solde (vérifié des
   deux côtés sur les 64 lignes réelles le 30/08 : EUR 46 683,00). */

import type { Arrete, Mouvement, Paiement } from './types';

export const SENS_MOUVEMENT = ['entree', 'sortie', 'change', 'remise'] as const;
export const LIEUX = ['caisse', 'compte'] as const;
/** Vocabulaire EXISTANT de finances.statut : seuls ces deux-là sont dans la caisse. */
export const STATUTS_REALISES = ['Complété', 'Payé'] as const;
export const STATUT_EN_ATTENTE = 'En attente';
export const STATUT_ANNULE = 'Annulé';
export const DEVISE_CAISSE = 'EUR';
export const DEVISE_CHANGE = 'TRY';

/* ⚠ Règle de Veys (30/08) : les chirurgiens sont payés en livres, SAUF le
   Dr Azar Zeynalov, payé en euros. Lue sur la référence, jamais sur un nom. */
export const MEDECIN_PAYE_EN_EUROS = 'med_azar_zeynalov';
export const devisePourPaiementChirurgien = (medecinId: unknown): string =>
  String(medecinId || '') === MEDECIN_PAYE_EN_EUROS ? DEVISE_CAISSE : DEVISE_CHANGE;

/** Le texte de `montant`, casté comme la vue SQL le caste — ou null, jamais 0. */
export function montantNumerique(v: unknown): number | null {
  const t = String(v ?? '').trim();
  if (!/^-?[0-9]+([.,][0-9]+)?$/.test(t)) return null;
  return Number(t.replace(',', '.'));
}

export const estRealise = (m: Pick<Mouvement, 'statut'>): boolean =>
  (STATUTS_REALISES as readonly string[]).includes(m.statut);

/* Reprise du 30/08 : la correspondance EXPLICITE de la migration — la recette
   la rejoue sur les sept combinaisons réelles des 64 lignes. null = hors
   correspondance : à signaler, jamais à deviner. */
export function sensLieuPourReprise(type: string, methode: string): { sens: string; lieu: string } | null {
  if (['Acompte', 'Devis', 'Paiement total'].includes(type)) {
    if (methode === 'Virement') return { sens: 'entree', lieu: 'compte' };
    if (methode === 'Espèces') return { sens: 'entree', lieu: 'caisse' };
    return null;
  }
  if (['Honoraires chirurgien', 'Paiement chirurgien', 'Commission commerciale'].includes(type)) {
    return { sens: 'sortie', lieu: 'caisse' };
  }
  return null;
}

export interface ClassementCaisse {
  realises: Mouvement[];
  enAttente: Mouvement[];
  annules: Mouvement[];
  /** `sens` vide : écrit par un autre chemin (le monolithe) — à classer, jamais compté. */
  aClasser: Mouvement[];
  /** classé mais à statut vide ou inconnu (les 4 honoraires du 30/08) : ni payé ni dû — à trancher par Veys. */
  aTrancher: Mouvement[];
  /** réalisé mais montant qui ne caste pas : SIGNALÉ, exclu de tout total. */
  illisibles: Mouvement[];
}

export function classerMouvements(liste: Mouvement[] | undefined): ClassementCaisse {
  const c: ClassementCaisse = { realises: [], enAttente: [], annules: [], aClasser: [], aTrancher: [], illisibles: [] };
  for (const m of liste || []) {
    if (m.statut === STATUT_ANNULE) { c.annules.push(m); continue; }
    if (!m.sens) { c.aClasser.push(m); continue; }
    if (m.statut === STATUT_EN_ATTENTE) { c.enAttente.push(m); continue; }
    if (!estRealise(m)) { c.aTrancher.push(m); continue; }
    const illisible = montantNumerique(m.montant) === null
      || (m.sens === 'change' && montantNumerique(m.montantContrepartie) === null);
    if (illisible) { c.illisibles.push(m); continue; }
    c.realises.push(m);
  }
  return c;
}

/* Les deltas de CAISSE d'un mouvement réalisé — un par devise, jamais mêlés.
   Une entrée au compte (virement) ne touche pas la caisse de Ceyda. */
export function deltasCaisse(m: Mouvement): { devise: string; delta: number }[] {
  const montant = montantNumerique(m.montant);
  if (montant === null) return [];
  if (m.sens === 'entree') return m.lieu === 'caisse' ? [{ devise: m.devise, delta: montant }] : [];
  if (m.sens === 'sortie' || m.sens === 'remise') {
    return m.lieu === 'caisse' ? [{ devise: m.devise, delta: -montant }] : [];
  }
  if (m.sens === 'change') {
    const contre = montantNumerique(m.montantContrepartie);
    const deltas = [{ devise: m.devise, delta: -montant }];
    if (contre !== null && m.deviseContrepartie) deltas.push({ devise: m.deviseContrepartie, delta: contre });
    return deltas;
  }
  return [];
}

export interface SoldeCaisse { devise: string; solde: number; depuisArrete: string }

/* Le MIROIR de vue_caisse_solde — même règle, autre nature d'instrument. Un
   arrêté vaut FIN de journée : seuls les mouvements dont la date est
   STRICTEMENT postérieure s'ajoutent à son comptage — une ligne saisie après
   coup mais datée d'avant l'arrêté était déjà dans le tiroir compté, elle ne
   se rajoute pas. */
export function soldesCaisse(mouvements: Mouvement[] | undefined, arretes: Arrete[] | undefined): SoldeCaisse[] {
  const { realises } = classerMouvements(mouvements);
  const dernier = new Map<string, Arrete>();
  for (const a of arretes || []) {
    const d = dernier.get(a.devise);
    if (!d || a.date > d.date || (a.date === d.date && String(a.createdAt || '') > String(d.createdAt || ''))) {
      dernier.set(a.devise, a);
    }
  }
  const soldes = new Map<string, SoldeCaisse>();
  for (const [devise, a] of dernier) soldes.set(devise, { devise, solde: a.montantCompte, depuisArrete: a.date });
  for (const m of realises) {
    for (const { devise, delta } of deltasCaisse(m)) {
      const a = dernier.get(devise);
      if (a && !(m.date > a.date)) continue;
      const s = soldes.get(devise) || { devise, solde: 0, depuisArrete: '' };
      s.solde = Math.round((s.solde + delta) * 100) / 100;
      soldes.set(devise, s);
    }
  }
  return [...soldes.values()].sort((x, y) => x.devise.localeCompare(y.devise));
}

/** Le taux d'un change, calculé À L'AFFICHAGE — il n'est stocké nulle part. */
export function tauxDuChange(m: Pick<Mouvement, 'montant' | 'montantContrepartie'>): number | null {
  const sortie = montantNumerique(m.montant);
  const entree = montantNumerique(m.montantContrepartie);
  if (sortie === null || entree === null || sortie <= 0 || entree <= 0) return null;
  return Math.round((entree / sortie) * 10000) / 10000;
}

/* Saisie de mémoire : la date du mouvement n'est pas celle du jour de saisie.
   Pas une faute — une information. Le jour où un écart se cherche, savoir
   quelles lignes étaient de mémoire fait gagner une heure. */
export function estSaisieDeMemoire(m: Pick<Mouvement, 'date' | 'createdAt'>): boolean {
  const saisie = String(m.createdAt || '').slice(0, 10);
  return !!m.date && !!saisie && m.date !== saisie;
}

/* ---- rapprochement par patiente (chapitre ④ du lot) ----

   Pour chaque patiente : le total encaissé (espèces, virements, extras — le
   registre `finances`) face au total facturé (factures vivantes, calculé par
   l'appelant avec totalOf), et ce que dit l'AUTRE registre d'encaissement,
   nw_paiements — deux registres coexistent, leur écart se montre au lieu de
   se découvrir trois mois après. */
export interface RapprochementPatiente {
  patientId: string;
  encaisse: number;
  facture: number;
  /** encaisse − facture : positif = extras ou trop-perçu à porter sur la facture finale. */
  ecart: number;
  /** total du registre nw_paiements pour la même patiente — à croiser, pas à additionner. */
  regleNw: number;
}

export function rapprochementParPatiente(
  mouvements: Mouvement[] | undefined,
  factureParPatiente: Map<string, number>,
  paiements: Paiement[] | undefined,
): RapprochementPatiente[] {
  const { realises } = classerMouvements(mouvements);
  const enc = new Map<string, number>();
  for (const m of realises) {
    if (m.sens !== 'entree' || !m.patientId) continue;
    const montant = montantNumerique(m.montant);
    if (montant === null) continue;
    enc.set(m.patientId, Math.round(((enc.get(m.patientId) || 0) + montant) * 100) / 100);
  }
  const nw = new Map<string, number>();
  for (const p of paiements || []) {
    if (!p.patientId) continue;
    nw.set(p.patientId, Math.round(((nw.get(p.patientId) || 0) + Number(p.montant || 0)) * 100) / 100);
  }
  const ids = new Set<string>([...enc.keys(), ...factureParPatiente.keys()]);
  const lignes: RapprochementPatiente[] = [];
  for (const id of ids) {
    const encaisse = enc.get(id) || 0;
    const facture = Math.round((factureParPatiente.get(id) || 0) * 100) / 100;
    lignes.push({
      patientId: id,
      encaisse,
      facture,
      ecart: Math.round((encaisse - facture) * 100) / 100,
      regleNw: nw.get(id) || 0,
    });
  }
  return lignes.sort((a, b) => Math.abs(b.ecart) - Math.abs(a.ecart));
}
