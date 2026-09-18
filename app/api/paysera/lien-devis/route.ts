/* Route SERVEUR — le seul endroit de ce dépôt qui parle au site clinicnobel.com.

   POST /api/paysera/lien-devis

   DEUX modes, un seul chemin technique (même endpoint du site, même secret
   partagé, même table `nw_liens_paiement`, même trace) :

   · mode « devis » (16/09/2026, INCHANGÉ) —
     { devisId, type: 'acompte' | 'paiement', langue, forcer? }
     Le montant est recalculé ICI depuis le devis en base : le navigateur ne
     l'envoie pas, il ne pourrait pas le forger.

   · mode « libre » (18/09/2026) — un paiement demandé SANS devis
     { mode: 'libre', patientId?, patientNom, montant, libelle, langue }
     Il n'y a aucun devis d'où lire le montant : Veys le saisit, et c'est le
     besoin même (« même si je n'ai pas de devis, je mets le nom du patient
     et je fais un paiement par Paysera »). Le montant reste borné par le
     contrat du site (1 à 50 000 €), et le geste reste réservé au rôle admin.
     La RÉFÉRENCE est numérotée EN BASE par `nw_prochain_numero('libre')` →
     « L-2026-000001 » : jamais côté navigateur, invariant du dépôt.

   Ce qui garde les deux modes :
   1. une session Supabase valide (cookies), un profil autorisé (la MÊME règle
      que l'écran de connexion, lib/acces.ts) et la permission
      `paiementLienPaysera` — portée par le seul rôle admin ;
   2. le secret partagé lu dans l'environnement SERVEUR — jamais
      NEXT_PUBLIC_, jamais renvoyé, jamais journalisé, et sa présence est
      vérifiée AVANT tout appel ;
   3. le lien reçu est conservé dans `nw_liens_paiement` (le site n'en garde
      aucune mémoire) et l'action est tracée dans `nw_historique`.

   Aucun identifiant Paysera ici, sous aucune forme : la signature et l'API
   Paysera vivent dans clinicnobel-next. */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { AccesRefuseError, profilAutorise } from '@/lib/acces';
import { can, PERM_LIEN_PAIEMENT, userLabel } from '@/lib/perms';
import {
  histoToRow, lienPaiementToRow, rowToDevis, rowToFacture, rowToLienPaiement, rowToPaiement,
} from '@/lib/mappers';
import { fmtDateTime, money } from '@/lib/format';
import {
  arrondi2, estEuro, estLangueLien, estTypeLien, libelleType, lienVivant, lireReponseSite,
  messageErreurSite, objetLibre, objetLien, peutProposerLien, propositions, refusDemandeLibre,
  type TypeLien,
} from '@/lib/lienPaiement';
import type { LienPaiement } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CHEMIN_SITE = '/api/paysera/lien-devis';
const DELAI_SITE_MS = 25_000;

const baseSite = () => (process.env.CLINICNOBEL_SITE_URL || 'https://www.clinicnobel.com').replace(/\/+$/, '');

const refus = (status: number, message: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ ok: false, message, ...extra }, { status });

const nouvelId = () => 'lien_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export async function POST(req: Request) {
  let corps: Record<string, unknown>;
  try {
    corps = (await req.json()) as Record<string, unknown>;
  } catch {
    return refus(400, 'Demande illisible.');
  }
  /* Le mode est explicite ; son absence vaut « devis », pour que le chemin
     d'avant continue de fonctionner mot pour mot. */
  const mode = String(corps?.mode || 'devis');
  if (mode !== 'devis' && mode !== 'libre') return refus(400, 'Mode de lien inconnu.');
  const langue = String(corps?.langue || 'fr');
  if (!estLangueLien(langue)) return refus(400, 'Langue non prise en charge par la page de paiement.');

  /* ---- La session, le profil, la permission — communs aux deux modes ---- */
  const sb = await createClient();
  const { data: { user: authUser } } = await sb.auth.getUser();
  if (!authUser) return refus(401, 'Session absente ou expirée : reconnectez-vous.');

  const { data: profil, error: profilErr } = await sb
    .from('profiles').select('*').eq('auth_user_id', authUser.id).maybeSingle();
  if (profilErr) return refus(500, 'Profil illisible : ' + profilErr.message);
  let user;
  try {
    user = profilAutorise(profil);
  } catch (e) {
    if (e instanceof AccesRefuseError) return refus(403, e.message);
    throw e;
  }
  if (!can(user, PERM_LIEN_PAIEMENT)) {
    return refus(403, 'La génération d’un lien de paiement Paysera est réservée à l’administrateur.');
  }

  /* ---- Le secret — serveur seulement, et on s'arrête AVANT tout appel s'il manque ---- */
  const secret = process.env.INTERNAL_PAYMENT_LINK_SECRET;
  if (!secret) {
    return refus(500, 'Le secret INTERNAL_PAYMENT_LINK_SECRET n’est pas configuré sur ce déploiement : aucun appel n’a été fait.');
  }

  /* ═══════════════════════════════════════════════════════════════════
     Ce que chaque mode doit produire pour la suite : une référence, un
     montant, un type, un objet, et de quoi remplir la ligne conservée.
     ═══════════════════════════════════════════════════════════════════ */
  let reference: string;
  let montant: number;
  let type: TypeLien;
  let objet: string;
  let devisId: string | null = null;
  let patientId: string | null = null;
  let patientNom = '';
  let libelle = '';
  let memoireDisponible = true;
  let liens: LienPaiement[] = [];

  if (mode === 'devis') {
    /* ---------------- mode devis — INCHANGÉ depuis le 16/09 ---------------- */
    const idDevis = String(corps?.devisId || '').trim();
    const typeDemande = corps?.type;
    const forcer = corps?.forcer === true;
    if (!idDevis) return refus(400, 'Devis manquant.');
    if (!estTypeLien(typeDemande)) return refus(400, 'Type de lien inconnu : acompte ou paiement.');

    const { data: devisRow, error: devisErr } = await sb.from('nw_devis').select('*').eq('id', idDevis).maybeSingle();
    if (devisErr) return refus(500, 'Devis illisible : ' + devisErr.message);
    if (!devisRow) return refus(404, 'Devis introuvable.');
    const devis = rowToDevis(devisRow);
    const numero = String(devis.numero || '').trim();
    if (!numero) return refus(409, 'Ce devis n’a pas de numéro : impossible de le référencer pour un paiement.');
    if (!peutProposerLien(devis)) {
      return refus(409, `Ce devis est « ${devis.statut} » : un lien de paiement ne se propose que pour un devis envoyé ou accepté.`);
    }
    if (!estEuro(devis.devise)) {
      return refus(409, `Ce devis est en « ${devis.devise} » : la page de paiement ne connaît que l’euro.`);
    }

    const [facturesR, paiementsNumR, liensR] = await Promise.all([
      sb.from('nw_factures').select('*').eq('devis_id', idDevis),
      sb.from('nw_paiements').select('*').eq('ref_num', numero),
      sb.from('nw_liens_paiement').select('*').eq('devis_id', idDevis).order('created_at', { ascending: false }),
    ]);
    if (facturesR.error) return refus(500, 'Factures illisibles : ' + facturesR.error.message);
    if (paiementsNumR.error) return refus(500, 'Paiements illisibles : ' + paiementsNumR.error.message);
    const factures = (facturesR.data || []).map(rowToFacture);
    const idsFactures = factures.map((f) => String(f.id || '')).filter(Boolean);
    let paiements = (paiementsNumR.data || []).map(rowToPaiement);
    if (idsFactures.length) {
      const { data, error } = await sb.from('nw_paiements').select('*').in('facture_id', idsFactures);
      if (error) return refus(500, 'Paiements illisibles : ' + error.message);
      paiements = paiements.concat((data || []).map(rowToPaiement));
    }
    if (liensR.error) {
      memoireDisponible = false;
      console.warn('[CN][paysera] nw_liens_paiement illisible :', liensR.error.message);
    } else {
      liens = (liensR.data || []).map(rowToLienPaiement);
    }

    /* Le montant : calculé, jamais reçu. */
    const prop = propositions(devis, paiements, factures, devis.devise || '€').find((p) => p.type === typeDemande)!;
    if (prop.indisponible) return refus(409, `Impossible de générer ce lien : ${prop.indisponible}.`);

    /* Un lien vivant pour la même somme se réutilise. */
    if (!forcer) {
      const vivant = lienVivant(liens, typeDemande, prop.montant, Date.now());
      if (vivant) return NextResponse.json({ ok: true, reutilise: true, memorise: true, lien: vivant });
    }

    reference = numero;
    montant = prop.montant;
    type = typeDemande;
    objet = objetLien(typeDemande, numero);
    devisId = idDevis;
    patientId = String(devis.patientId || '') || null;
  } else {
    /* ---------------- mode libre — nouveau le 18/09 ---------------- */
    const demande = {
      patientId: corps?.patientId ? String(corps.patientId) : null,
      patientNom: String(corps?.patientNom || ''),
      montant: Number(corps?.montant),
      libelle: String(corps?.libelle || ''),
      langue,
    };
    const refusDemande = refusDemandeLibre(demande);
    if (refusDemande) return refus(400, refusDemande);

    /* Si une fiche est désignée, on relit son nom en base plutôt que de
       croire le navigateur — et on refuse une fiche inconnue. */
    if (demande.patientId) {
      const { data, error } = await sb
        .from('patients').select('id,prenom,nom').eq('id', demande.patientId).maybeSingle();
      if (error) return refus(500, 'Fiche patiente illisible : ' + error.message);
      if (!data) return refus(404, 'Fiche patiente introuvable.');
      patientId = String(data.id);
      patientNom = `${data.prenom || ''} ${data.nom || ''}`.trim() || demande.patientNom.trim();
    } else {
      patientNom = demande.patientNom.trim();
    }

    /* La numérotation est ATOMIQUE et côté serveur : invariant du dépôt. */
    const { data: ref, error: refErr } = await sb.rpc('nw_prochain_numero', { type: 'libre' });
    if (refErr || !ref) {
      return refus(500, 'Numérotation du lien impossible : ' + (refErr?.message || 'réponse vide du serveur.'));
    }
    reference = String(ref);
    montant = arrondi2(demande.montant);
    /* Un paiement sans devis n'est ni un acompte ni un solde de document :
       c'est un paiement. Le vocabulaire reste celui de `nw_paiements.type`. */
    type = 'paiement';
    libelle = demande.libelle.trim();
    objet = objetLibre(libelle, patientNom);
  }

  /* ---- L'appel au site — le SEUL appel réseau sortant, pour les deux modes ---- */
  let reponse: Response;
  try {
    reponse = await fetch(baseSite() + CHEMIN_SITE, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ devis: reference, montant, type, langue, objet }),
      signal: AbortSignal.timeout(DELAI_SITE_MS),
      cache: 'no-store',
    });
  } catch (e) {
    const cause = (e as Error)?.name === 'TimeoutError' ? 'délai dépassé' : (e as Error)?.message || 'erreur réseau';
    return refus(502, `Le site clinicnobel.com ne répond pas (${cause}). Rien n’a été créé.`);
  }
  let corpsSite: unknown = null;
  try {
    corpsSite = await reponse.json();
  } catch {
    corpsSite = null;
  }
  if (!reponse.ok) {
    return refus(502, messageErreurSite(reponse.status, corpsSite), { siteStatus: reponse.status });
  }
  const rep = lireReponseSite(corpsSite);
  if (!rep) return refus(502, 'Le site a répondu, mais sans lien de paiement lisible. Rien n’est conservé.');

  /* ---- Conserver, puis tracer ---- */
  const lien: LienPaiement = {
    id: nouvelId(),
    devisId: devisId || '',
    devisNumero: reference,
    libelle,
    patientId: patientId || '',
    patientNom,
    type: rep.type,
    montant: rep.montant,
    devise: rep.devise || 'EUR',
    reference: rep.reference,
    paymentUrl: rep.paymentUrl,
    orderId: rep.orderId,
    linkId: rep.linkId,
    isTest: rep.isTest,
    langue,
    expiresAt: rep.expiresAt,
    creePar: userLabel(user),
    createdAt: new Date().toISOString(),
  };
  let memorise = false;
  if (memoireDisponible) {
    const { error } = await sb.from('nw_liens_paiement').insert(lienPaiementToRow(lien));
    if (error) console.warn('[CN][paysera] lien non conservé :', error.message);
    else memorise = true;
  }

  const quoi = mode === 'libre'
    ? `un lien de paiement Paysera SANS devis (${money(rep.montant, '€')}) pour ${patientNom || 'un patient sans nom'}`
      + ` — libellé « ${libelle} », référence ${reference}`
    : `un lien de paiement Paysera (${libelleType(rep.type)} ${money(rep.montant, '€')}) pour le devis ${reference}`;
  const message = `a généré ${quoi}`
    + ` — référence Paysera ${rep.reference || '(sans référence)'}, valable jusqu’au ${fmtDateTime(rep.expiresAt)}`
    + (rep.isTest ? ' [mode test Paysera]' : '')
    + (memorise ? '' : ' — lien NON conservé (nw_liens_paiement indisponible)');
  const { error: histoErr } = await sb.from('nw_historique').insert(histoToRow({ user: userLabel(user), message }));
  if (histoErr) console.warn('[CN][paysera] historique non écrit :', histoErr.message);

  return NextResponse.json({ ok: true, reutilise: false, memorise, lien }, { status: 201 });
}
