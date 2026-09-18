'use client';

/* « Nouveau lien de paiement » — un lien Paysera SANS devis (18/09/2026).

   Le besoin, dans les mots de Veys : « Quand je dois faire un paiement, même
   si je n'ai pas de devis, je mets le nom du patient et je fais un paiement
   par Paysera. Ça arrive que les gens arrivent pour autre chose, ou qu'ils
   avaient déjà un devis et payé la facture. »

   Trois champs, et pas un de plus : la personne (une fiche, ou un nom libre
   si elle n'est pas encore au fichier), le montant, un libellé court — ce
   que la personne lira sur la page de paiement.

   Le chemin technique est celui du lien depuis un devis : la même route
   serveur, le même secret côté serveur, le même endpoint du site, la même
   table `nw_liens_paiement`. Rien n'est dupliqué, et le lien depuis un devis
   n'est pas touché.

   ⚠ Aucun tarif n'est écrit ici. Si cet écran doit un jour en proposer un,
   il viendra du catalogue du CRM, jamais d'une valeur en dur.

   L'argent : un paiement sans devis n'a pas de facture. Il s'enregistre donc
   NON RATTACHÉ — `nw_paiements.facture_id` est nullable et deux paiements en
   base le sont déjà — et la rubrique « Paiements non rattachés » de cet écran
   le montre, avec de quoi lui choisir une facture plus tard. */

import React, { useState } from 'react';
import { Field, Input, Modal, Select } from './ui';
import { Ico } from './icons';
import { useApp } from './AppContext';
import { money } from '@/lib/format';
import { patientName } from '@/lib/calc';
import { LANGUE_DEFAUT, LANGUES_LIEN, LONGUEUR_LIBELLE_MAX, refusDemandeLibre } from '@/lib/lienPaiement';
import type { LienPaiement } from '@/lib/types';

const NOM_LIBRE = '__libre__';

export function ModaleLienLibre({ onClose }: { onClose: () => void }) {
  const { data, toast } = useApp();
  const cur = data.parametres.currency || '€';
  const patients = [...data.patients].sort((a, b) => patientName(a).localeCompare(patientName(b), 'fr'));

  const [choix, setChoix] = useState('');
  const [nomLibre, setNomLibre] = useState('');
  const [montant, setMontant] = useState('');
  const [libelle, setLibelle] = useState('');
  const [langue, setLangue] = useState(LANGUE_DEFAUT);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState('');
  const [lien, setLien] = useState<LienPaiement | null>(null);
  const [memorise, setMemorise] = useState(true);

  const fiche = choix && choix !== NOM_LIBRE ? patients.find((p) => p.id === choix) : undefined;
  const nom = fiche ? patientName(fiche) : nomLibre;
  const demande = {
    patientId: fiche ? fiche.id : null,
    patientNom: nom,
    montant: Number(String(montant).replace(',', '.')),
    libelle,
    langue,
  };
  /* La même fonction que la route serveur : ce que l'écran refuse est ce que
     le serveur refuserait, mot pour mot. */
  const refusLocal = refusDemandeLibre(demande, cur);

  const creer = async () => {
    if (enCours || refusLocal) return;
    setEnCours(true);
    setErreur('');
    try {
      const res = await fetch('/api/paysera/lien-devis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ mode: 'libre', ...demande }),
      });
      let corps: { ok?: boolean; message?: string; memorise?: boolean; lien?: LienPaiement } = {};
      try {
        corps = await res.json();
      } catch {
        corps = {};
      }
      if (!res.ok || !corps.ok || !corps.lien) {
        setErreur(corps.message || `Échec (${res.status}). Rien n’a été créé.`);
        return;
      }
      setLien(corps.lien);
      setMemorise(corps.memorise !== false);
      toast(`Lien de paiement créé — ${money(corps.lien.montant, cur)} pour ${corps.lien.patientNom || 'ce patient'}`);
    } catch (e) {
      setErreur('Impossible de joindre l’application : ' + ((e as Error).message || 'erreur réseau'));
    } finally {
      setEnCours(false);
    }
  };

  const copier = async () => {
    if (!lien) return;
    try {
      await navigator.clipboard.writeText(lien.paymentUrl);
      toast('Lien copié — envoyez-le par WhatsApp');
    } catch {
      window.prompt('Copiez le lien :', lien.paymentUrl);
    }
  };

  return (
    <Modal
      title={lien ? 'Lien de paiement créé' : 'Nouveau lien de paiement'}
      onClose={onClose}
      footer={lien ? (
        <>
          <button className="btn" onClick={onClose}>Fermer</button>
          <button className="btn btn-primary" onClick={() => void copier()}>
            <Ico.copy size={16} />Copier le lien
          </button>
        </>
      ) : (
        <>
          <button className="btn" onClick={onClose}>Annuler</button>
          <button
            className="btn btn-primary"
            disabled={enCours || !!refusLocal}
            title={refusLocal || ''}
            onClick={() => void creer()}
          >
            <Ico.send size={16} />{enCours ? 'Demande en cours…' : 'Créer le lien'}
          </button>
        </>
      )}
    >
      {lien ? (
        <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>
          <p style={{ marginTop: 0 }}>
            <b>{money(lien.montant, cur)}</b> — {lien.patientNom || 'patient sans nom'}
            <br />
            <span className="muted">{lien.libelle}</span>
          </p>
          <input
            className="input"
            readOnly
            value={lien.paymentUrl}
            onFocus={(e) => e.currentTarget.select()}
            style={{ fontSize: 12.5 }}
          />
          <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
            Référence <b>{lien.devisNumero}</b>
            {lien.reference ? <> · réf. Paysera {lien.reference}</> : null}
            {lien.isTest ? ' · mode test Paysera' : ''}
            <br />
            Le lien est valable 7 jours. Vous l&apos;envoyez vous-même à la personne : rien ne part
            automatiquement.
          </p>
          <div
            style={{
              background: '#f6f9fc', border: '1px solid var(--line)', borderRadius: 10,
              padding: '9px 12px', fontSize: 12.5, lineHeight: 1.55, marginTop: 10,
            }}
          >
            Quand la personne aura payé, le paiement apparaîtra dans cette liste{' '}
            <b>non rattaché</b> — sans devis, il n&apos;a pas de facture. Vous pourrez lui en choisir une
            plus tard depuis la rubrique « Paiements non rattachés » ; le montant, lui, est compté dès
            l&apos;encaissement.
          </div>
          {!memorise && (
            <div
              style={{
                background: '#fff7e8', border: '1px solid #f0dcae', color: '#7a5d1f', borderRadius: 10,
                padding: '9px 12px', fontSize: 12.5, lineHeight: 1.55, marginTop: 10,
              }}
            >
              ⚠ Le lien n&apos;a pas pu être conservé (mémoire des liens indisponible) :{' '}
              <b>copiez-le maintenant</b>, il ne sera pas retrouvé à la prochaine ouverture.
            </div>
          )}
        </div>
      ) : (
        <>
          <Field label="La personne" hint="une fiche, ou un nom si elle n'est pas encore au fichier">
            <Select value={choix} onChange={(e) => setChoix(e.target.value)}>
              <option value="">— Choisir une fiche patiente —</option>
              <option value={NOM_LIBRE}>— Un nom qui n&apos;est pas au fichier —</option>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>{patientName(p)}</option>
              ))}
            </Select>
          </Field>
          {choix === NOM_LIBRE && (
            <Field label="Nom de la personne" hint="aucune fiche n'est créée">
              <Input
                value={nomLibre}
                onChange={(e) => setNomLibre(e.target.value)}
                placeholder="Prénom Nom"
                autoComplete="off"
              />
            </Field>
          )}
          <Field label="Montant" hint={cur}>
            <Input
              type="number"
              inputMode="decimal"
              min="1"
              max="50000"
              step="0.01"
              value={montant}
              onChange={(e) => setMontant(e.target.value)}
              placeholder="0"
            />
          </Field>
          <Field
            label="Libellé court"
            hint={`ce que la personne verra — ${LONGUEUR_LIBELLE_MAX} caractères au plus`}
          >
            <Input
              value={libelle}
              onChange={(e) => setLibelle(e.target.value)}
              maxLength={LONGUEUR_LIBELLE_MAX}
              placeholder="Ex. Consultation et analyses"
            />
          </Field>
          <Field label="Langue de la page de paiement" hint="celle de la personne">
            <Select value={langue} onChange={(e) => setLangue(e.target.value)}>
              {LANGUES_LIEN.map(([code, nomLangue]) => (
                <option key={code} value={code}>{nomLangue}</option>
              ))}
            </Select>
          </Field>
          {refusLocal && (choix || montant || libelle) && (
            <p className="muted" style={{ fontSize: 12.5, margin: '2px 0 10px' }}>{refusLocal}</p>
          )}
          <p className="muted" style={{ fontSize: 11.5, lineHeight: 1.55, margin: 0 }}>
            Sans devis, ce paiement n&apos;aura pas de facture : il s&apos;enregistrera{' '}
            <b>non rattaché</b>, et pourra être rattaché plus tard. Le montant se saisit ici parce
            qu&apos;il n&apos;y a aucun devis d&apos;où le lire ; le lien qui part d&apos;un devis, lui,
            continue de prendre le sien dans le devis.
          </p>
          {erreur && (
            <div
              style={{
                background: '#fdecea', border: '1px solid #f3b9b1', color: '#8a2a20', borderRadius: 10,
                padding: '9px 12px', fontSize: 12.5, lineHeight: 1.55, marginTop: 10,
              }}
            >
              ⚠ {erreur}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
