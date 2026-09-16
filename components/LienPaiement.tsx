'use client';

/* Panneau « Paiement en ligne (Paysera) » de l'écran d'un devis.

   Ce composant ne connaît ni Paysera ni le secret : il appelle la route
   serveur de ce dépôt (app/api/paysera/lien-devis) avec l'identifiant du
   devis, le type (acompte / solde) et la langue de la page de paiement — et
   affiche ce qu'elle renvoie. Le montant n'est jamais saisi ici : il est
   calculé depuis le devis, à l'écran pour l'annoncer, sur le serveur pour
   l'envoyer.

   Deux lectures directes, toutes deux tolérantes :
   · `nw_liens_paiement` — le dernier lien par type, vivant ou expiré ;
   · `nw_paiements` filtré sur ref_num = numéro du devis — « payé le … ».
   Le bouton « Actualiser » relit les deux : le webhook Paysera arrive après
   coup, sans que l'application le sache. */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Field, Select } from './ui';
import { Ico } from './icons';
import { useApp } from './AppContext';
import { supabase } from '@/lib/supabase/client';
import { rowToLienPaiement, rowToPaiement } from '@/lib/mappers';
import { fmtDate, fmtDateTime, money } from '@/lib/format';
import { can, PERM_LIEN_PAIEMENT } from '@/lib/perms';
import {
  derniersLiens, LANGUE_DEFAUT, LANGUES_LIEN, libelleType, lienExpire, lienVivant, paiementsPaysera,
  peutProposerLien, propositions, STATUTS_LIEN_POSSIBLE, type TypeLien,
} from '@/lib/lienPaiement';
import type { DocRecord, LienPaiement, Paiement } from '@/lib/types';

const ENCADRE: React.CSSProperties = {
  background: '#f6f9fc', border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px',
  marginBottom: 14, fontSize: 13, lineHeight: 1.55,
};
const AVERT: React.CSSProperties = {
  background: '#fff7e8', border: '1px solid #f0dcae', color: '#7a5d1f', borderRadius: 10,
  padding: '9px 12px', fontSize: 12.5, lineHeight: 1.55, marginTop: 10,
};
const ERREUR: React.CSSProperties = { ...AVERT, background: '#fdecea', border: '1px solid #f3b9b1', color: '#8a2a20' };

export function PanneauLienPaiement({ devis }: { devis: DocRecord }) {
  const { data, user, toast } = useApp();
  const cur = data.parametres.currency || '€';
  const autorise = can(user, PERM_LIEN_PAIEMENT);
  const voitPaiements = autorise || can(user, 'all') || can(user, 'paymentView') || can(user, 'paymentEdit');
  const proposable = peutProposerLien(devis);

  /* Lectures fraîches, avec repli sur ce que l'application a déjà en mémoire. */
  const [liens, setLiens] = useState<LienPaiement[]>([]);
  const [paiements, setPaiements] = useState<Paiement[]>(() => paiementsPaysera(data.paiements, devis.numero));
  const [memoireIndispo, setMemoireIndispo] = useState(false);
  const [chargement, setChargement] = useState(false);

  const recharger = useCallback(async () => {
    if (!devis.id) return;
    setChargement(true);
    try {
      const sb = supabase();
      const [l, p] = await Promise.all([
        sb.from('nw_liens_paiement').select('*').eq('devis_id', devis.id).order('created_at', { ascending: false }),
        sb.from('nw_paiements').select('*').eq('ref_num', String(devis.numero || '')),
      ]);
      if (l.error) {
        setMemoireIndispo(true);
        setLiens([]);
      } else {
        setMemoireIndispo(false);
        setLiens((l.data || []).map(rowToLienPaiement));
      }
      if (!p.error) setPaiements(paiementsPaysera((p.data || []).map(rowToPaiement), devis.numero));
    } catch (e) {
      console.warn('[CN][paysera] lecture impossible', e);
    } finally {
      setChargement(false);
    }
  }, [devis.id, devis.numero]);

  useEffect(() => {
    if (voitPaiements) void recharger();
  }, [voitPaiements, recharger]);

  /* ---- le choix : acompte ou solde, calculés — jamais tapés ---- */
  const props = propositions(devis, [...data.paiements, ...paiements], data.factures, cur);
  const premierDispo = props.find((p) => !p.indisponible)?.type;
  const [type, setType] = useState<TypeLien>(premierDispo || 'acompte');
  const [langue, setLangue] = useState(LANGUE_DEFAUT);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState('');
  /* Une lecture fraîche peut éteindre la proposition choisie (acompte encaissé
     entre-temps) : on bascule sur la première disponible plutôt que de laisser
     un bouton gris sans explication. */
  useEffect(() => {
    const courante = props.find((p) => p.type === type);
    if (courante?.indisponible && premierDispo && premierDispo !== type) setType(premierDispo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [premierDispo, props.map((p) => p.indisponible || '').join('|')]);
  const choisie = props.find((p) => p.type === type) || props[0];
  const vivant = choisie && !choisie.indisponible ? lienVivant(liens, choisie.type, choisie.montant, Date.now()) : null;

  const generer = async (forcer: boolean) => {
    if (enCours || !devis.id) return;
    setEnCours(true);
    setErreur('');
    try {
      const res = await fetch('/api/paysera/lien-devis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ devisId: devis.id, type, langue, forcer }),
      });
      let corps: { ok?: boolean; message?: string; reutilise?: boolean; memorise?: boolean; lien?: LienPaiement } = {};
      try {
        corps = await res.json();
      } catch {
        corps = {};
      }
      if (!res.ok || !corps.ok || !corps.lien) {
        setErreur(corps.message || `Échec (${res.status}). Rien n’a été créé.`);
        return;
      }
      const lien = corps.lien;
      setLiens((l) => (l.some((x) => x.id === lien.id) ? l : [lien, ...l]));
      if (corps.reutilise) toast(`Un lien encore valable existait pour ${money(lien.montant, cur)} : il est réutilisé.`);
      else toast(`Lien de paiement créé — ${libelleType(lien.type)} ${money(lien.montant, cur)}${corps.memorise ? '' : ' (non conservé : mémoire des liens indisponible)'}`);
      if (corps.memorise === false) setMemoireIndispo(true);
    } catch (e) {
      setErreur('Impossible de joindre l’application : ' + ((e as Error).message || 'erreur réseau'));
    } finally {
      setEnCours(false);
    }
  };

  if (!voitPaiements) return null;

  const derniers = derniersLiens(liens);
  const maintenant = Date.now();

  return (
    <div style={ENCADRE}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <Ico.wallet size={16} />
        <b>Paiement en ligne (Paysera)</b>
        <span className="sp" style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-sm" onClick={() => void recharger()} disabled={chargement} title="Relire les paiements et les liens">
          <Ico.hist size={14} />{chargement ? 'Lecture…' : 'Actualiser'}
        </button>
      </div>

      {/* ---- l'état du paiement : nw_paiements, ref_num = numéro du devis ---- */}
      {paiements.length ? (
        <ul style={{ margin: '0 0 8px 18px', padding: 0 }}>
          {paiements.map((p) => (
            <li key={p.id}>
              <b>Payé le {fmtDate(p.date)}</b> — {money(p.montant, cur)} ({libelleType(p.type)})
              {p.note ? <span className="muted"> · réf. {p.note}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted" style={{ margin: '0 0 8px' }}>Aucun paiement Paysera reçu pour ce devis.</p>
      )}

      {/* ---- les liens déjà générés : le dernier de chaque type ---- */}
      {derniers.map((l) => (
        <LigneLien key={l.id} lien={l} cur={cur} expire={lienExpire(l, maintenant)} onCopie={() => toast('Lien copié')} />
      ))}
      {memoireIndispo && (
        <div style={AVERT}>
          La mémoire des liens (<code>nw_liens_paiement</code>) est indisponible : la migration
          <code> db/migration-20260916-lien-paiement-paysera.sql</code> n&apos;est pas appliquée. Un lien peut être
          généré, mais il ne sera pas retrouvé à la prochaine ouverture.
        </div>
      )}

      {/* ---- générer : réservé (permission), et seulement sur envoyé / accepté ---- */}
      {autorise && !proposable && (
        <p className="muted" style={{ margin: '8px 0 0', fontSize: 12.5 }}>
          Un lien de paiement se propose pour un devis <b>envoyé</b> ou <b>accepté</b> — celui-ci est
          « {devis.statut || 'brouillon'} ».
        </p>
      )}
      {autorise && proposable && (
        <div style={{ marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
          <div className="side-actions" style={{ gap: 6, marginBottom: 8 }}>
            {props.map((p) => (
              <label key={p.type} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', opacity: p.indisponible ? 0.6 : 1, cursor: p.indisponible ? 'not-allowed' : 'pointer' }}>
                <input
                  type="radio"
                  name="type-lien"
                  checked={type === p.type}
                  disabled={!!p.indisponible}
                  onChange={() => setType(p.type)}
                  style={{ marginTop: 3 }}
                />
                <span>
                  {p.libelle}
                  {p.indisponible && <span className="muted"> — {p.indisponible}</span>}
                </span>
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <Field label="Langue de la page de paiement" hint="celle de la patiente">
              <Select value={langue} onChange={(e) => setLangue(e.target.value)} style={{ width: 160 }}>
                {LANGUES_LIEN.map(([code, nom]) => <option key={code} value={code}>{nom}</option>)}
              </Select>
            </Field>
            <button
              className="btn btn-primary"
              disabled={enCours || !choisie || !!choisie.indisponible}
              title={choisie?.indisponible ? choisie.indisponible : ''}
              onClick={() => void generer(false)}
            >
              <Ico.send size={15} />
              {enCours ? 'Demande en cours…' : vivant ? 'Retrouver le lien de paiement Paysera' : 'Générer un lien de paiement Paysera'}
            </button>
            {vivant && (
              <button
                className="btn"
                disabled={enCours}
                title="Demander un lien neuf au site, même si le précédent est encore valable (lien perdu, envoyé par erreur…)"
                onClick={() => {
                  if (window.confirm('Un lien encore valable existe pour cette somme. En demander un NOUVEAU quand même ?\n\nL’ancien reste utilisable jusqu’à son expiration : ne le laissez pas circuler.')) void generer(true);
                }}
              >
                Nouveau lien
              </button>
            )}
          </div>
          <p className="muted" style={{ margin: '8px 0 0', fontSize: 12 }}>
            Le lien est valable 7 jours. Vous l&apos;envoyez vous-même à la patiente (WhatsApp, e-mail) : rien ne part
            automatiquement. Le montant vient du devis, il ne se saisit pas ici.
          </p>
          {erreur && <div style={ERREUR}>⚠ {erreur}</div>}
        </div>
      )}
      <p className="muted" style={{ margin: '6px 0 0', fontSize: 11.5 }}>
        Statuts concernés : {STATUTS_LIEN_POSSIBLE.map((s) => (s === 'envoye' ? 'envoyé' : 'accepté')).join(', ')} ·
        le paiement se lit dans les paiements du devis {devis.numero}, jamais sur Paysera directement.
      </p>
    </div>
  );
}

/* Un lien : montant, dates, l'URL et le bouton pour la copier. Un lien expiré
   reste affiché, barré de sa mention — c'est ce qui explique qu'il faille en
   demander un nouveau. */
function LigneLien({ lien, cur, expire, onCopie }: { lien: LienPaiement; cur: string; expire: boolean; onCopie: () => void }) {
  const champ = useRef<HTMLInputElement>(null);
  const copier = async () => {
    try {
      await navigator.clipboard.writeText(lien.paymentUrl);
      onCopie();
    } catch {
      /* navigateurs sans presse-papiers asynchrone (http, anciens mobiles) */
      champ.current?.select();
      try {
        document.execCommand('copy');
        onCopie();
      } catch {
        window.prompt('Copiez le lien :', lien.paymentUrl);
      }
    }
  };
  return (
    <div style={{ marginBottom: 8 }}>
      <div>
        <b>Lien {libelleType(lien.type)} — {money(lien.montant, cur)}</b>
        {lien.isTest && <span className="badge b-wait" style={{ marginLeft: 8 }}><span className="dot" />mode test</span>}
        <span className="muted"> · généré le {fmtDateTime(lien.createdAt)}{lien.creePar ? ` par ${lien.creePar}` : ''}</span>
        {expire ? (
          <span style={{ color: '#8a2a20', fontWeight: 600 }}> · expiré le {fmtDateTime(lien.expiresAt)}</span>
        ) : (
          <span className="muted"> · valable jusqu&apos;au {fmtDateTime(lien.expiresAt)}</span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center' }}>
        <input
          ref={champ}
          className="input"
          readOnly
          value={lien.paymentUrl}
          onFocus={(e) => e.currentTarget.select()}
          style={{ flex: 1, fontSize: 12, textDecoration: expire ? 'line-through' : undefined, opacity: expire ? 0.6 : 1 }}
        />
        <button className="btn btn-sm" onClick={() => void copier()} disabled={expire} title={expire ? 'Lien expiré : demandez-en un nouveau' : 'Copier le lien'}>
          <Ico.copy size={14} />Copier
        </button>
        <a className="btn btn-sm" href={expire ? undefined : lien.paymentUrl} target="_blank" rel="noreferrer" aria-disabled={expire} style={expire ? { pointerEvents: 'none', opacity: 0.5 } : undefined}>
          Ouvrir
        </a>
      </div>
      {lien.reference && <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>réf. {lien.reference}</div>}
    </div>
  );
}
