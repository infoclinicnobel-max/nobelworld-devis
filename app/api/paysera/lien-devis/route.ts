/* Route SERVEUR — le seul endroit de ce dépôt qui parle au site clinicnobel.com.

   POST /api/paysera/lien-devis  { devisId, type: 'acompte' | 'paiement', langue, forcer? }

   Ce qu'elle garantit, dans l'ordre :
   1. une session Supabase valide (cookies), un profil autorisé (la MÊME règle
      que l'écran de connexion, lib/acces.ts) et la permission
      `paiementLienPaysera` — portée par le seul rôle admin ;
   2. le MONTANT est recalculé ICI depuis le devis en base (acompte saisi, ou
      solde = total − déjà encaissé) : le navigateur ne l'envoie pas, il ne
      pourrait pas le forger ;
   3. un lien encore valable pour le même montant est RÉUTILISÉ, sauf
      `forcer` (lien perdu ou expiré, demande explicite) ;
   4. l'appel au site porte le secret partagé lu dans l'environnement
      serveur — jamais NEXT_PUBLIC_, jamais renvoyé, jamais journalisé ;
   5. le lien reçu est conservé dans `nw_liens_paiement` (le site n'en garde
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
  estEuro, estLangueLien, estTypeLien, libelleType, lienVivant, lireReponseSite, messageErreurSite,
  objetLien, peutProposerLien, propositions,
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
  /* ---- 1. le corps : trois champs, aucun montant ---- */
  let corps: Record<string, unknown>;
  try {
    corps = (await req.json()) as Record<string, unknown>;
  } catch {
    return refus(400, 'Demande illisible.');
  }
  const devisId = String(corps?.devisId || '').trim();
  const type = corps?.type;
  const langue = String(corps?.langue || 'fr');
  const forcer = corps?.forcer === true;
  if (!devisId) return refus(400, 'Devis manquant.');
  if (!estTypeLien(type)) return refus(400, 'Type de lien inconnu : acompte ou paiement.');
  if (!estLangueLien(langue)) return refus(400, 'Langue non prise en charge par la page de paiement.');

  /* ---- 2. la session, le profil, la permission ---- */
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

  /* ---- 3. le secret — serveur seulement, et on s'arrête AVANT tout appel s'il manque ---- */
  const secret = process.env.INTERNAL_PAYMENT_LINK_SECRET;
  if (!secret) {
    return refus(500, 'Le secret INTERNAL_PAYMENT_LINK_SECRET n’est pas configuré sur ce déploiement : aucun appel n’a été fait.');
  }

  /* ---- 4. le devis, relu en base (la RLS de l'utilisateur s'applique) ---- */
  const { data: devisRow, error: devisErr } = await sb.from('nw_devis').select('*').eq('id', devisId).maybeSingle();
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
    sb.from('nw_factures').select('*').eq('devis_id', devisId),
    sb.from('nw_paiements').select('*').eq('ref_num', numero),
    sb.from('nw_liens_paiement').select('*').eq('devis_id', devisId).order('created_at', { ascending: false }),
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
  /* La mémoire des liens est TOLÉRANTE : table absente = on génère quand
     même, et on dit à l'écran que le lien n'a pas pu être conservé. */
  let memoireDisponible = true;
  let liens: LienPaiement[] = [];
  if (liensR.error) {
    memoireDisponible = false;
    console.warn('[CN][paysera] nw_liens_paiement illisible :', liensR.error.message);
  } else {
    liens = (liensR.data || []).map(rowToLienPaiement);
  }

  /* ---- 5. le montant : calculé, jamais reçu ---- */
  const prop = propositions(devis, paiements, factures, devis.devise || '€').find((p) => p.type === type)!;
  if (prop.indisponible) return refus(409, `Impossible de générer ce lien : ${prop.indisponible}.`);
  const montant = prop.montant;

  /* ---- 6. un lien vivant pour la même somme se réutilise ---- */
  if (!forcer) {
    const vivant = lienVivant(liens, type, montant, Date.now());
    if (vivant) return NextResponse.json({ ok: true, reutilise: true, memorise: true, lien: vivant });
  }

  /* ---- 7. l'appel au site — le SEUL appel réseau sortant de ce lot ---- */
  let reponse: Response;
  try {
    reponse = await fetch(baseSite() + CHEMIN_SITE, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ devis: numero, montant, type, langue, objet: objetLien(type, numero) }),
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

  /* ---- 8. conserver, puis tracer ---- */
  const lien: LienPaiement = {
    id: nouvelId(),
    devisId,
    devisNumero: numero,
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

  const message =
    `a généré un lien de paiement Paysera (${libelleType(rep.type)} ${money(rep.montant, '€')}) pour le devis ${numero}`
    + ` — référence ${rep.reference || '(sans référence)'}, valable jusqu’au ${fmtDateTime(rep.expiresAt)}`
    + (rep.isTest ? ' [mode test Paysera]' : '')
    + (memorise ? '' : ' — lien NON conservé (nw_liens_paiement indisponible)');
  const { error: histoErr } = await sb.from('nw_historique').insert(histoToRow({ user: userLabel(user), message }));
  if (histoErr) console.warn('[CN][paysera] historique non écrit :', histoErr.message);

  return NextResponse.json({ ok: true, reutilise: false, memorise, lien }, { status: 201 });
}
