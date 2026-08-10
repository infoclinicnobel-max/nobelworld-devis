'use client';

import React, { useEffect, useState } from 'react';
import { Field, Input, Select, Textarea } from './ui';
import { Ico } from './icons';
import { useApp } from './AppContext';
import { supabase } from '@/lib/supabase/client';
import { DEFAULT_SETTINGS, PDF_TEXTS, type Settings } from '@/lib/defaults';
import { can, PERMS, READ_KEYS, roleDefaultPerms, ROLES, userLabel } from '@/lib/perms';

/* =========================================================================
   PARAMÈTRES
   ------------------------------------------------------------------------- */
export function ParametresView() {
  const { data, user, saveSettings, toast } = useApp();
  const [s, setS] = useState<Settings>({ ...DEFAULT_SETTINGS, ...data.parametres });
  const [tab, setTab] = useState('societe');
  const [pwd, setPwd] = useState({ np: '', np2: '' });
  const set = (k: string, v: unknown) => setS((x) => ({ ...x, [k]: v }));
  const importLogo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = () => set('logo', r.result);
    r.readAsDataURL(file);
  };
  const Chk = ({ k, label }: { k: string; label: string }) => (
    <label
      style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, margin: '6px 0 12px', cursor: 'pointer', lineHeight: 1.45 }}
    >
      <input
        type="checkbox"
        style={{ marginTop: 2 }}
        checked={(s as Record<string, unknown>)[k] !== false}
        onChange={(e) => set(k, e.target.checked)}
      />
      {label}
    </label>
  );
  const [pdfSub, setPdfSub] = useState('devis');
  // Accès à l'onglet Connexion : administrateur (all) ou permission explicite
  const canConn = can(user, 'all') || can(user, 'connexionView');
  // Consultation des permissions : administrateur ou droit usersManage
  const canPerm = can(user, 'all') || can(user, 'usersManage');
  const canEditParams = can(user, 'all') || can(user, 'paramEdit');

  return (
    <div style={{ maxWidth: 760 }}>
      <div className="seg" style={{ marginBottom: 18 }}>
        {(
          [
            ['societe', 'Société'], ['banque', 'Paiement & légal'], ['pdf', 'Modèles PDF'],
            ['connexion', 'Connexion'], ['permissions', 'Permissions utilisateurs'],
          ] as [string, string][]
        )
          .filter(([k]) => (k !== 'connexion' || canConn) && (k !== 'permissions' || canPerm))
          .map(([k, l]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
          ))}
      </div>

      {tab === 'societe' && (
        <div className="card card-pad">
          <Field label="Logo" hint="apparaît sur tous les documents">
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div
                style={{
                  width: 120, height: 64, border: '1px dashed var(--line)', borderRadius: 10,
                  display: 'grid', placeItems: 'center', background: 'var(--surface)', overflow: 'hidden',
                }}
              >
                {s.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={String(s.logo)} alt="logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                ) : (
                  <span className="muted" style={{ fontSize: 11 }}>Aucun logo</span>
                )}
              </div>
              <label className="btn">
                <Ico.plus size={15} />Importer
                <input type="file" accept="image/*" hidden onChange={importLogo} />
              </label>
              {s.logo && (
                <button className="btn btn-ghost btn-sm btn-danger" onClick={() => set('logo', '')}>Retirer</button>
              )}
            </div>
          </Field>
          <div className="row2">
            <Field label="Nom de la société">
              <Input value={s.company} onChange={(e) => set('company', e.target.value)} />
            </Field>
            <Field label="Slogan"><Input value={s.tagline} onChange={(e) => set('tagline', e.target.value)} /></Field>
          </div>
          <Field label="Titre du document" hint="affiché en haut du devis">
            <Input
              value={s.docTitle || ''}
              placeholder="DEVIS MÉDICAL PREMIUM"
              onChange={(e) => set('docTitle', e.target.value)}
            />
          </Field>
          <Field label="Adresse"><Input value={s.address} onChange={(e) => set('address', e.target.value)} /></Field>
          <div className="row2">
            <Field label="Téléphone"><Input value={s.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
            <Field label="WhatsApp"><Input value={s.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} /></Field>
          </div>
          <div className="row2">
            <Field label="Email"><Input value={s.email} onChange={(e) => set('email', e.target.value)} /></Field>
            <Field label="Site internet"><Input value={s.website} onChange={(e) => set('website', e.target.value)} /></Field>
          </div>
        </div>
      )}

      {tab === 'societe' && (
        <div className="card card-pad" style={{ marginTop: 14 }}>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>Mon mot de passe</h2>
          <p className="muted" style={{ fontSize: 13 }}>
            Vous modifiez votre propre mot de passe ({user.email}). Les mots de passe sont gérés par Supabase Auth :
            la réinitialisation d&apos;un autre compte se fait depuis le CRM Clinic Nobel.
          </p>
          <div className="row2">
            <Field label="Nouveau mot de passe">
              <Input type="password" value={pwd.np} onChange={(e) => setPwd({ ...pwd, np: e.target.value })} />
            </Field>
            <Field label="Confirmer">
              <Input type="password" value={pwd.np2} onChange={(e) => setPwd({ ...pwd, np2: e.target.value })} />
            </Field>
          </div>
          <button
            className="btn btn-primary"
            disabled={!pwd.np || pwd.np !== pwd.np2 || pwd.np.length < 6}
            onClick={async () => {
              const { error } = await supabase().auth.updateUser({ password: pwd.np });
              if (error) toast(error.message, 'err');
              else {
                toast('Mot de passe mis à jour');
                setPwd({ np: '', np2: '' });
              }
            }}
          >
            <Ico.check size={16} />Mettre à jour
          </button>
        </div>
      )}

      {tab === 'banque' && (
        <div className="card card-pad">
          <div className="row2">
            <Field label="Nom de la banque">
              <Input
                value={String(s.bankName || '')}
                onChange={(e) => set('bankName', e.target.value)}
                placeholder="Ex. QNB Finansbank"
              />
            </Field>
            <Field label="Adresse de la banque">
              <Input
                value={String(s.bankAddress || '')}
                onChange={(e) => set('bankAddress', e.target.value)}
                placeholder="Ville, pays (optionnel)"
              />
            </Field>
          </div>
          <div className="row2">
            <Field label="IBAN"><Input value={s.iban} onChange={(e) => set('iban', e.target.value)} /></Field>
            <Field label="BIC"><Input value={s.bic} onChange={(e) => set('bic', e.target.value)} /></Field>
          </div>
          <div className="row2">
            <Field label="N° TVA" hint="(optionnel)">
              <Input value={s.vat} onChange={(e) => set('vat', e.target.value)} />
            </Field>
            <Field label="Devise">
              <Select value={s.currency} onChange={(e) => set('currency', e.target.value)}>
                {['€', '$', '£', '₺'].map((c) => <option key={c}>{c}</option>)}
              </Select>
            </Field>
          </div>
          <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, margin: '4px 0 0' }}>
            Les textes des documents (conditions, notes médicales, mentions…) se modifient dans l&apos;onglet{' '}
            <b>Modèles PDF</b>.
          </p>
        </div>
      )}

      {tab === 'pdf' && (
        <div className="card card-pad">
          <div className="seg" style={{ marginBottom: 14 }}>
            {(
              [['devis', 'Modèle PDF Devis'], ['facture', 'Modèle PDF Facture']] as [string, string][]
            ).map(([k, l]) => (
              <button key={k} className={pdfSub === k ? 'on' : ''} onClick={() => setPdfSub(k)}>{l}</button>
            ))}
          </div>

          {pdfSub === 'devis' && (
            <>
              <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, margin: '0 0 14px' }}>
                Textes du <b>PDF des devis</b>. Un devis dont un texte a été personnalisé garde sa version ; sinon il
                suit ces paramètres. Sur un devis précis, tout reste modifiable via son éditeur.
              </p>

              <div className="row2">
                <Field label="Validité du devis (jours)">
                  <Input
                    type="number"
                    value={s.validiteJours ?? 30}
                    onChange={(e) => set('validiteJours', Number(e.target.value))}
                  />
                </Field>
                <Field label="Validité promotionnelle (jours)">
                  <Input
                    type="number"
                    value={s.validitePromoJours ?? 8}
                    onChange={(e) => set('validitePromoJours', Number(e.target.value))}
                  />
                </Field>
              </div>
              <Chk
                k="promoActive"
                label="Nouveaux devis en mode promotion : mention « Offre promotionnelle » sous le titre + validité promotionnelle"
              />

              <Field
                label="Conditions importantes"
                hint="1 condition par ligne — bloc « Conditions importantes » du PDF (page 2)"
              >
                <Textarea
                  style={{ minHeight: 110 }}
                  value={s.importantDefault || ''}
                  onChange={(e) => set('importantDefault', e.target.value)}
                />
              </Field>
              <Chk k="showImportant" label="Afficher le bloc « Conditions importantes » sur le PDF" />

              <Field
                label="Notes médicales et administratives"
                hint="grand bloc de la page 2 — un paragraphe par bloc de texte"
              >
                <Textarea style={{ minHeight: 170 }} value={s.cgv || ''} onChange={(e) => set('cgv', e.target.value)} />
              </Field>
              <Chk k="showNotes" label="Afficher le bloc « Notes médicales et administratives » sur le PDF" />

              <Field
                label="Modalités de paiement"
                hint="affiché dans le bloc « Conditions de paiement », suivi de l'IBAN/BIC"
              >
                <Textarea
                  style={{ minHeight: 70 }}
                  value={s.paiementNote || ''}
                  onChange={(e) => set('paiementNote', e.target.value)}
                />
              </Field>
              <div className="row2">
                <Field label="Texte acompte" hint="libellé de la ligne acompte">
                  <Input value={s.libAcompte || ''} onChange={(e) => set('libAcompte', e.target.value)} />
                </Field>
                <Field label="Texte solde" hint="libellé de la ligne « reste à payer »">
                  <Input value={s.libSolde || ''} onChange={(e) => set('libSolde', e.target.value)} />
                </Field>
              </div>

              <Field
                label="Prestations incluses par défaut"
                hint="1 prestation par ligne — pré-remplies sur chaque nouveau devis"
              >
                <Textarea
                  style={{ minHeight: 130 }}
                  value={s.incDefault || ''}
                  onChange={(e) => set('incDefault', e.target.value)}
                />
              </Field>
              <Field label="Prestations non incluses par défaut" hint="1 prestation par ligne">
                <Textarea
                  style={{ minHeight: 70 }}
                  value={s.excDefault || ''}
                  onChange={(e) => set('excDefault', e.target.value)}
                />
              </Field>
              <Chk k="optVolsExclus" label="Indiquer les billets d'avion comme non inclus" />
              <Chk k="optHotelInclus" label="Hôtel inclus dans le forfait (sinon déplacé vers « non inclus »)" />
              <Chk k="optTransfertsInclus" label="Transferts inclus dans le forfait (sinon déplacés vers « non inclus »)" />

              <Field label="Mentions finales / mentions légales" hint="pied du document, page 2">
                <Textarea style={{ minHeight: 60 }} value={s.legal || ''} onChange={(e) => set('legal', e.target.value)} />
              </Field>
              <Field label="Phrase de signature">
                <Input value={s.signature || ''} onChange={(e) => set('signature', e.target.value)} />
              </Field>
              <Chk k="showSignature" label="Afficher la zone de signature sur le PDF" />
              <Chk k="showQR" label="Afficher le QR code sur le PDF" />
            </>
          )}

          {pdfSub === 'facture' && (
            <>
              <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, margin: '0 0 14px' }}>
                Textes du <b>PDF des factures</b> — document comptable, totalement indépendant du devis : aucune
                mention de validité, de promotion ou de signature n&apos;y figure. Numéro, date, patient, chirurgien,
                clinique, prestations, total, acomptes versés, paiements enregistrés, solde, IBAN/BIC et coordonnées
                sont repris automatiquement des données de la facture.
              </p>
              <Field label="Conditions importantes (facture)" hint="1 condition par ligne — laisser vide pour masquer le bloc">
                <Textarea
                  style={{ minHeight: 90 }}
                  value={s.factImportant || ''}
                  onChange={(e) => set('factImportant', e.target.value)}
                />
              </Field>
              <Field label="Notes administratives (facture)" hint="bloc encadré de la page 2 — laisser vide pour masquer">
                <Textarea
                  style={{ minHeight: 130 }}
                  value={s.factNotes || ''}
                  onChange={(e) => set('factNotes', e.target.value)}
                />
              </Field>
              <Field
                label="Mentions légales (facture)"
                hint="pied du document, précédé automatiquement de « Société — Facture N° »"
              >
                <Textarea
                  style={{ minHeight: 56 }}
                  value={s.factLegal || ''}
                  onChange={(e) => set('factLegal', e.target.value)}
                />
              </Field>
              <Field label="Texte de bas de page (facture)" hint="ligne tout en bas de chaque page — vide = « Société · N° »">
                <Input value={String(s.factFooter || '')} onChange={(e) => set('factFooter', e.target.value)} />
              </Field>
            </>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
            <button
              className="btn"
              onClick={() => {
                if (
                  window.confirm(
                    'Réinitialiser tous les textes des modèles Devis ET Facture aux valeurs par défaut ?\n(Pensez ensuite à cliquer sur « Enregistrer les paramètres ».)',
                  )
                ) {
                  setS((x) => ({ ...x, ...PDF_TEXTS }));
                  toast('Textes réinitialisés — cliquez sur Enregistrer pour appliquer');
                }
              }}
            >
              Réinitialiser les textes par défaut
            </button>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            N&apos;oubliez pas de cliquer sur <b>« Enregistrer les paramètres »</b> en bas de page pour appliquer vos
            modifications.
          </p>
        </div>
      )}

      {tab === 'connexion' && !canConn && (
        <div className="card card-pad" style={{ textAlign: 'center', color: 'var(--muted)', padding: 32 }}>
          <b>Accès réservé à l&apos;administrateur.</b>
          <br />
          Les paramètres de connexion sont sensibles ; demandez à l&apos;administrateur de vous accorder la permission
          « Accéder aux paramètres de connexion » si nécessaire.
        </div>
      )}
      {tab === 'connexion' && canConn && (
        <div className="card card-pad">
          <h2 style={{ fontSize: 15, marginTop: 0 }}>Connexion &amp; base de données</h2>
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
            Nobel World est connecté au projet Supabase <b>clinic-nobel-crm-prod</b>, partagé avec le CRM Clinic Nobel.
            L&apos;ancienne synchronisation Google Sheets (script Apps Script, sondage toutes les 15 s, fusion locale)
            n&apos;existe plus : Postgres est la seule source de vérité et les écritures sont immédiates.
          </p>
          <div className="card card-pad" style={{ background: 'var(--surface)', fontSize: 13, lineHeight: 1.7 }}>
            <b>État actuel :</b>
            <span className="badge b-paid" style={{ marginLeft: 6 }}>
              <span className="dot"></span>Connecté à Supabase
            </span>
            <div style={{ marginTop: 8, fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all', color: 'var(--muted)' }}>
              {process.env.NEXT_PUBLIC_SUPABASE_URL || '(variable NEXT_PUBLIC_SUPABASE_URL absente)'}
            </div>
          </div>
          <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, marginTop: 14 }}>
            Les comptes, mots de passe et rôles sont gérés par Supabase Auth et par le CRM. Nobel World lit la table{' '}
            <code>profiles</code> mais n&apos;y écrit jamais. Les rôles <b>chirurgien</b> et <b>anonyme</b> sont
            refusés par les règles d&apos;accès de la base.
          </p>
          <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
            La durée de session (« Rester connecté ») est celle de Supabase Auth : la session est rafraîchie
            automatiquement tant que l&apos;utilisateur ne se déconnecte pas.
          </p>
        </div>
      )}

      {tab === 'permissions' && !canPerm && (
        <div className="card card-pad" style={{ textAlign: 'center', color: 'var(--muted)', padding: 32 }}>
          <b>Accès réservé à l&apos;administrateur.</b>
        </div>
      )}
      {tab === 'permissions' && canPerm && <PermissionsManager />}

      {tab !== 'connexion' && tab !== 'permissions' && (
        <div style={{ marginTop: 16 }}>
          <button
            className="btn btn-primary"
            disabled={!canEditParams}
            title={
              canEditParams
                ? ''
                : 'Modification des paramètres réservée — permission « Modifier et enregistrer ces paramètres » requise'
            }
            onClick={async () => {
              if (!canEditParams) return;
              await saveSettings(s);
              toast('Paramètres enregistrés');
            }}
          >
            <Ico.check size={16} />Enregistrer les paramètres
          </button>
          {!canEditParams && (
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              Lecture seule : vous pouvez consulter ces paramètres mais pas les modifier.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* =========================================================================
   PERMISSIONS UTILISATEURS — les 26 permissions de l'ancienne version,
   affichées telles qu'elles sont réellement appliquées à partir de
   `profiles.perms`. Consultation seule : la gestion des comptes reste au CRM.
   ------------------------------------------------------------------------- */
export function PermissionsManager() {
  const { data } = useApp();
  const users = data.utilisateurs || [];
  const [selId, setSelId] = useState<string | undefined>(users[0] && users[0].id);
  const sel = users.find((u) => u.id === selId) || users[0] || null;
  const [effectif, setEffectif] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (sel) setEffectif({ ...roleDefaultPerms(sel.role), ...(sel.perms || {}) });
  }, [selId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!sel) return <div className="card card-pad">Aucun utilisateur.</div>;
  const isPdg = sel.role === 'pdg';
  const sansAcces = ['chirurgien', 'anonyme'].includes(sel.roleBase.toLowerCase());
  const nbLecture = READ_KEYS.filter((k) => effectif[k]).length;

  return (
    <div className="card card-pad">
      <h2 style={{ fontSize: 15, marginTop: 0 }}>Permissions utilisateurs</h2>
      <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, margin: '0 0 12px' }}>
        Les 26 permissions de Nobel World sont dérivées de la colonne <code>perms</code> de <code>profiles</code>,
        gérée par le CRM Clinic Nobel. Nobel World ne peut pas les modifier : demandez le changement dans le CRM,
        il sera pris en compte à la prochaine connexion (ou au prochain rafraîchissement).
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {users.map((u) => (
          <button
            key={u.id}
            className={'btn btn-sm' + (u.id === sel.id ? ' btn-primary' : '')}
            onClick={() => setSelId(u.id)}
          >
            {userLabel(u)}
            <span style={{ opacity: 0.7, marginLeft: 6, fontSize: 11 }}>
              {ROLES[u.role]?.label || u.roleBase}
            </span>
          </button>
        ))}
      </div>

      {sansAcces && (
        <div
          className="card card-pad"
          style={{ background: '#fbeeeb', border: '1px solid #f0d2ca', color: '#a23a23', fontSize: 13, lineHeight: 1.6, marginBottom: 12 }}
        >
          <b>Ce compte n&apos;a pas accès à Nobel World.</b>
          <br />
          Les règles d&apos;accès de la base refusent le rôle « {sel.roleBase} ». Ce verrou est côté serveur :
          il n&apos;est pas contournable depuis l&apos;application.
        </div>
      )}

      {isPdg ? (
        <div className="card card-pad" style={{ background: 'var(--surface)', fontSize: 13, lineHeight: 1.6 }}>
          <b>Le compte administrateur (PDG) conserve toujours tous les accès.</b>
          <br />
          Ses permissions ne peuvent pas être réduites — c&apos;est une protection volontaire pour ne jamais
          verrouiller l&apos;administration.
        </div>
      ) : (
        <>
          <div className="muted" style={{ fontSize: 12, marginBottom: 14 }}>
            Rôle appliqué : <b>{ROLES[sel.role]?.label || sel.role}</b> · {nbLecture}/{READ_KEYS.length} permissions de
            lecture accordées
          </div>
          {PERMS.map((grp) => (
            <div key={grp.g} style={{ marginBottom: 12 }}>
              <div
                style={{ fontSize: 11, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700, marginBottom: 6 }}
              >
                {grp.g}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: '4px 16px' }}>
                {grp.items.map(([k, l]) => (
                  <label
                    key={k}
                    style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, lineHeight: 1.4, opacity: 0.9 }}
                  >
                    <input type="checkbox" style={{ marginTop: 2 }} checked={!!effectif[k]} readOnly disabled />
                    {l}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
