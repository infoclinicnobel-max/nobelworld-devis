'use client';

import React, { useEffect, useRef, useState } from 'react';
import { EditableText } from './ui';
import { SelecteurModele } from './SelecteurModele';
import { LogoCN } from './LogoCN';
import { useAppMaybe } from './AppContext';
import { fmtDate, fmtPhone, money, normalizeDate } from '@/lib/format';
import {
  DEFAULT_IMPORTANT, DEFAULT_PAIEMENT_NOTE, PDF_TEXTS, settingsImpLines, type Settings,
} from '@/lib/defaults';
import { can, userLabel, type AppUser } from '@/lib/perms';
import { resoudreLibelle, type Correspondance } from '@/lib/catalogue';
import {
  devisTotal, estRetenue, factPayments, optionsADecider, optsSum, patientName, remiseMontant,
  totalOf, totalSiToutesOptions,
} from '@/lib/calc';
import { ordonnerMedecins } from '@/lib/medecins';
import type { Acte, DocRecord, Medecin, Modele, Paiement, Patient } from '@/lib/types';

/* =========================================================================
   DOCUMENT PREMIUM (devis & facture) + impression PDF
   Page A4 partagée : éditable (éditeur) ou statique (aperçu/PDF).
   Garantit un PDF identique à l'aperçu. Portage strict de index.html :
   toute retouche ici change le PDF reçu par les patientes.
   ------------------------------------------------------------------------- */

export interface DocHandlers {
  editable?: boolean;
  patients?: Patient[];
  paiements?: Paiement[];
  /* Chirurgiens du CRM et le geste qui en rattache un au document (texte
     imprimé + référence, lib/medecins.ts). Sans liste — table illisible —
     le champ reste une saisie libre. */
  medecins?: Medecin[];
  setMedecin?: (id: string) => void;
  set: (k: string, v: unknown) => void;
  addActe: () => void;
  setActe: (id: string, k: string, v: string) => void;
  rmActe: (id: string) => void;
  addInc: () => void;
  setInc: (i: number, v: string) => void;
  rmInc: (i: number) => void;
  moveInc: (from: number, to: number) => void;
  addExc: () => void;
  setExc: (i: number, v: string) => void;
  rmExc: (i: number) => void;
  moveExc: (from: number, to: number) => void;
  addOpt: () => void;
  /* Catalogue et écritures depuis un modèle — fournis par l'éditeur seulement.
     Le sélecteur rend le modèle choisi ; c'est l'éditeur qui décide où l'écrire. */
  modeles?: Modele[];
  /* Libellés d'usage de catalogue_correspondances : étendent la recherche du
     sélecteur (« valide » seulement) et alimentent la pastille de
     reconnaissance des actes. Lecture pure, jamais une écriture. */
  correspondances?: Correspondance[];
  acteDepuisModele?: (m: Modele) => void;
  optDepuisModele?: (m: Modele) => void;
  setOpt: (i: number, k: string, v: string | number | boolean) => void;
  rmOpt: (i: number) => void;
  addImp: () => void;
  setImp: (i: number, v: string) => void;
  rmImp: (i: number) => void;
}

/* ---- Pastille de reconnaissance d'un libellé d'acte — ÉDITEUR SEULEMENT ----

   Une lecture superposée, jamais une écriture : elle dit ce qu'un libellé VAUT
   face au catalogue, elle ne corrige rien, ne propose rien, ne survit pas à
   l'impression (le PDF passe par editable=false et ne la rend jamais).

   ⚠ « hors catalogue » est un FAIT, pas une alerte — douze libellés sur
   vingt-neuf le sont aujourd'hui, dont des combos parfaitement légitimes. Un
   badge qui décrit peut rester affiché en permanence ; un badge qui accuse
   cesse d'être lu en une semaine. NE PAS transformer ce texte en « ⚠ non
   reconnu » ou « à corriger » : la neutralité de la formulation est le
   mécanisme qui rend l'affichage permanent tenable. */
function PastilleCatalogue({
  libelle, modeles, correspondances,
}: { libelle: string; modeles?: Modele[]; correspondances?: Correspondance[] }) {
  if (!String(libelle || '').trim() || !modeles?.length) return null;
  const r = resoudreLibelle(libelle, modeles, correspondances);
  const style: React.CSSProperties = {
    fontSize: 10.5, lineHeight: 1.4, marginTop: 2, color: 'var(--muted-2)',
  };
  if (r.etat === 'exact') return <div style={style}>✓ au catalogue</div>;
  if (r.etat === 'valide') {
    return <div style={style}>✓ reconnu : {r.modele ? r.modele.nom : 'ligne inactive du catalogue'}</div>;
  }
  if (r.etat === 'a_verifier') {
    return (
      <div style={{ ...style, color: '#7a5d1f' }}>
        ⚠ correspondance à vérifier : {r.modele ? r.modele.nom : 'ligne inactive du catalogue'}
      </div>
    );
  }
  return <div style={style}>hors catalogue</div>;
}

/* `cree_par` porte un nom lisible (« Veys Turan ») et non un identifiant :
   on retrouve donc le conseiller par identifiant, par libellé ou par email. */
export function findConseiller(users: AppUser[] | undefined, createdBy: unknown): AppUser | null {
  const key = String(createdBy || '').trim().toLowerCase();
  if (!key) return null;
  const list = users || [];
  return (
    list.find((u) => u.id.toLowerCase() === key) ||
    list.find((u) => userLabel(u).toLowerCase() === key) ||
    list.find((u) => u.email.toLowerCase() === key) ||
    list.find((u) => !!u.prenom && u.prenom.trim().toLowerCase() === key.split(' ')[0]) ||
    null
  );
}

export function DevisDoc({
  record, settings, patient, type, paid, editable, on,
}: {
  record: DocRecord;
  settings: Settings;
  patient?: Partial<Patient>;
  type: 'devis' | 'facture';
  paid?: number;
  editable?: boolean;
  on?: DocHandlers;
}) {
  const s = settings;
  const cur = (record && record.devise) || s.currency || '€';
  const isF = type === 'facture';
  const E = !!editable;

  // Coordonnées bancaires photographiées dans le document à sa création ;
  // un ancien document sans photographie affiche celles des paramètres (comportement historique).
  const bq = {
    nom: record.bqNom != null ? record.bqNom : s.bankName || '',
    adresse: record.bqAdresse != null ? record.bqAdresse : s.bankAddress || '',
    iban: record.bqIban != null && record.bqIban !== '' ? record.bqIban : s.iban || '',
    bic: record.bqBic != null && record.bqBic !== '' ? record.bqBic : s.bic || '',
  };
  const set = (k: string, v: unknown) => on && on.set(k, v);
  const app = useAppMaybe();
  const _u = app && app.user;
  const canDateOp = !_u || can(_u, 'all') || can(_u, 'scheduleEdit');
  const conseiller = findConseiller(app?.data?.utilisateurs, record.createdBy) || (app && app.user) || null;
  const webv = s.website || 'www.clinicnobel.com';
  const emailv = s.email || 'info@clinicnobel.com';
  const phonev = s.phone ? fmtPhone(s.phone) : '+90 546 586 34 69';
  const dragInc = useRef<number | null>(null);
  const dragExc = useRef<number | null>(null);

  const actes: Acte[] =
    record.actes && record.actes.length
      ? record.actes
      : (record.lignes || []).map((l, i) => ({ id: 'l' + i, acte: l.desc || '', inclus: '' }));
  const inc = record.inc || [];
  const exc = record.exc || [];
  const options = record.options || [];
  const optionsRetenues = options.filter(estRetenue);

  // Priorité : 1) texte personnalisé du document, 2) Paramètres PDF, 3) défauts intégrés.
  // Un texte stocké identique aux défauts intégrés ou aux Paramètres actuels est traité
  // comme NON personnalisé (photographie automatique) → il suit les Paramètres en direct.
  const sImpLines = settingsImpLines(s);
  const recImp = record.importantList && record.importantList.length ? record.importantList : null;
  const impIsTpl =
    !!recImp &&
    (recImp.join('\n') === DEFAULT_IMPORTANT.join('\n') || recImp.join('\n') === sImpLines.join('\n'));
  const important =
    recImp && !impIsTpl
      ? recImp
      : sImpLines.length
        ? sImpLines
        : record.important
          ? [record.important]
          : s.important
            ? [s.important]
            : DEFAULT_IMPORTANT;
  const recPay = record.paiementNote != null && record.paiementNote !== '' ? record.paiementNote : null;
  const paiementNote =
    recPay && recPay !== DEFAULT_PAIEMENT_NOTE && recPay !== (s.paiementNote || '')
      ? recPay
      : s.paiementNote || DEFAULT_PAIEMENT_NOTE;
  const recCgv = record.cgv != null && record.cgv !== '' ? record.cgv : null;
  const notesTxt = recCgv && recCgv !== PDF_TEXTS.cgv && recCgv !== (s.cgv || '') ? recCgv : s.cgv || '';

  // FACTURE : modèle indépendant — aucun texte du devis (cgv, conditions, signature) n'est repris.
  const factImp = String(s.factImportant || '').split('\n').map((x) => x.trim()).filter(Boolean);
  const factNotes = record.factNotes != null && record.factNotes !== '' ? record.factNotes : s.factNotes || '';
  const importantShow = isF ? factImp : important;
  const notesShow = isF ? factNotes : notesTxt;
  const payList = isF ? factPayments(app?.data?.paiements, record.id) : [];
  const forfait = Number(record.forfait || 0);
  const sousTotal = forfait > 0 ? forfait : devisTotal(record);
  const oSum = optsSum(record);
  /* Options laissées à décider en consultation : affichées avec leur prix, mais
     hors du total, de l'acompte et du reste à payer. Une option d'avant ce lot
     n'a pas de champ `retenue` : estRetenue() la compte, et le document ne
     bouge pas d'un centime. */
  const optsADecider = optionsADecider(record);
  const totalToutesOptions = totalSiToutesOptions(record);
  const total = totalOf(record);
  const remM = remiseMontant(record);
  const paidN = Number(paid || 0);
  const reste = Math.max(0, total - paidN);
  const recLegal = record.legal != null && record.legal !== '' ? record.legal : null;
  const footLegal = isF
    ? `${s.company} — Facture ${record.numero}. ${s.factLegal || 'Document tenant lieu de facture.'}`
    : recLegal && recLegal !== PDF_TEXTS.legal && recLegal !== (s.legal || '')
      ? recLegal
      : s.legal || '';
  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&margin=0&data=${encodeURIComponent(
    (s.company || '') + ' ' + (record.numero || ''),
  )}`;

  /* ===== Nombre de pages du PDF — réglage par document (défaut : Automatique) =====
     'auto' : sonde 2 → 3 → 4 pages structurelles tant qu'une page déborde du format A4.
     '1'..'4' : répartition fixe choisie par l'utilisateur. Jamais de réduction de police,
     jamais de coupure : si un choix manuel est trop court, l'impression ajoute simplement
     une feuille (avertissement non bloquant). Anciens documents sans réglage → Automatique. */
  const modeRaw = String(record.pagesMode || 'auto');
  const [autoP, setAutoP] = useState(2);
  const P = modeRaw === 'auto' ? autoP : Math.min(4, Math.max(1, parseInt(modeRaw, 10) || 2));
  const rootRef = useRef<HTMLDivElement>(null);
  const [overNow, setOverNow] = useState(false);
  const contentSig = [
    actes.length, inc.length, exc.length, important.length, options.length,
    String(notesTxt || '').length, String(paiementNote || '').length, String(factNotes || '').length,
  ].join('-');
  useEffect(() => {
    if (modeRaw === 'auto') setAutoP(2);
    setOverNow(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record.id, modeRaw, contentSig]);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const t = setTimeout(() => {
      let ov = false;
      el.querySelectorAll('.page').forEach((pg) => {
        if ((pg as HTMLElement).scrollHeight > 1125) ov = true;
      });
      if (modeRaw === 'auto' && ov && autoP < 4) setAutoP((a) => Math.min(4, a + 1));
      else if (ov !== overNow) setOverNow(ov);
    }, 120);
    return () => clearTimeout(t);
  });

  const FootLine = ({ i }: { i: number }) => (
    <div className="pagefoot">
      <span>{isF && s.factFooter ? String(s.factFooter) : `${s.company} · ${record.numero || ''}`}</span>
      <span>Page {i}/{P}</span>
    </div>
  );

  const secPay = (
    <div className="sec">
      <div className="seclbl">{isF ? 'Règlement' : 'Conditions de paiement'}</div>
      <div className="paybox">
        <div className="l">
          <span>Prix du forfait</span>
          <span className="v tnum">{money(sousTotal, cur)}{s.vat ? ' TTC' : ''}</span>
        </div>
        {oSum > 0 && (
          <div className="l"><span>Options</span><span className="v tnum">{money(oSum, cur)}</span></div>
        )}
        {remM > 0 && (
          <div className="l">
            <span>Remise promotionnelle{record.remiseMotif ? ` — ${record.remiseMotif}` : ''}</span>
            <span className="v tnum" style={{ color: 'var(--ok)' }}>
              {record.remiseType === 'pourcent'
                ? `-${Number(record.remiseValeur)} % soit -${money(remM, cur)}`
                : `-${money(remM, cur)}`}
            </span>
          </div>
        )}
        {remM > 0 && (
          <div className="l"><span>Total après remise</span><span className="v tnum">{money(total, cur)}</span></div>
        )}
        {remM <= 0 && oSum > 0 && (
          <div className="l"><span>Total</span><span className="v tnum">{money(total, cur)}</span></div>
        )}
        <div className="l acc">
          <span>{isF ? 'Acomptes et paiements déjà versés' : String(s.libAcompte || 'Acompte à la réservation')}</span>
          <span className="v tnum">{money(paidN, cur)}</span>
        </div>
        {isF &&
          payList.map((p) => (
            <div key={p.id} className="l" style={{ fontSize: 12, padding: '1px 0' }}>
              <span style={{ paddingLeft: 14, color: 'var(--muted-2)' }}>
                · {fmtDate(p.date)} — {p.mode || 'Paiement'}
                {p.type === 'remboursement' ? ' (remboursement)' : ''}
              </span>
              <span className="v tnum" style={{ color: 'var(--muted-2)' }}>
                {money(Number(p.montant || 0), cur)}
              </span>
            </div>
          ))}
        <div className="l big">
          <span>{isF ? 'Solde restant dû' : String(s.libSolde || 'Reste à payer')}</span>
          <span className="v tnum">{money(reste, cur)}</span>
        </div>
        <div className="note">
          {!isF && (
            <>
              {E ? (
                <EditableText multiline value={paiementNote} onChange={(v) => set('paiementNote', v)} />
              ) : (
                paiementNote
              )}
              <br />
            </>
          )}
          {(bq.nom || bq.adresse) && (
            <span style={{ color: 'var(--muted)' }}>
              {bq.nom}
              {bq.nom && bq.adresse ? ' — ' : ''}
              {bq.adresse}
              <br />
            </span>
          )}
          {(bq.iban || bq.bic) && (
            <span style={{ fontWeight: 700, color: 'var(--ink)' }}>
              {bq.iban ? 'IBAN ' + bq.iban : ''}
              {bq.iban && bq.bic ? ' · ' : ''}
              {bq.bic ? 'BIC ' + bq.bic : ''}
            </span>
          )}
        </div>
      </div>
      {/* Options à décider — hors du montant engagé, sous les yeux de la patiente.
          Ne s'affiche que s'il en existe : un devis d'avant ce lot n'a rien de plus.
          Absent de l'ÉDITEUR : là, chaque option se modifie dans la section Options,
          case « retenue » comprise, et l'afficher deux fois n'aiderait personne.
          L'aperçu et le PDF, eux, montrent le document tel que la patiente le reçoit. */}
      {!E && optsADecider.length > 0 && (
        <div className="optdec">
          <div className="optdec-t">Options — à décider en consultation</div>
          {optsADecider.map((o, i) => (
            <div key={o.id || 'od' + i} className="optrow">
              <span className="lbl">
                {o.nom}
                {o.detail ? <span className="det">{o.detail}</span> : null}
              </span>
              <span className="price tnum">{money(Number(o.qty || 1) * Number(o.prix || 0), cur)}</span>
            </div>
          ))}
          <div className="optdec-s">
            <span>Total si toutes les options sont retenues</span>
            <span className="v tnum">{money(totalToutesOptions, cur)}</span>
          </div>
        </div>
      )}
    </div>
  );

  const secLists = (
    <>
      {(inc.length > 0 || E) && (
        <div className="sec">
          <div className="seclbl">Prestations incluses</div>
          <div>
            {inc.map((x, i) => (
              <div
                key={i}
                className="incrow"
                {...(E
                  ? {
                      onDragOver: (e: React.DragEvent) => e.preventDefault(),
                      onDrop: (e: React.DragEvent) => {
                        e.preventDefault();
                        const fr = dragInc.current;
                        if (fr != null && fr !== i) on!.moveInc(fr, i);
                        dragInc.current = null;
                      },
                    }
                  : {})}
              >
                <span className="bul">✓</span>
                {E ? (
                  <>
                    <span
                      className="draghand"
                      draggable
                      onDragStart={() => { dragInc.current = i; }}
                      title="Glisser pour réordonner"
                    >
                      ⠿
                    </span>
                    <EditableText
                      value={x}
                      placeholder="Prestation incluse"
                      onChange={(v) => on!.setInc(i, v)}
                      style={{ flex: 1 }}
                    />
                    <button className="delrow" onClick={() => on!.rmInc(i)}>×</button>
                  </>
                ) : (
                  <span>{x}</span>
                )}
              </div>
            ))}
          </div>
          {E && <button className="addrow" onClick={on!.addInc}>+ Ajouter une prestation</button>}
        </div>
      )}

      {(exc.length > 0 || E) && (
        <div className="sec">
          <div className="seclbl">Prestations non incluses</div>
          <div>
            {exc.map((x, i) => (
              <div
                key={i}
                className="incrow exrow"
                {...(E
                  ? {
                      onDragOver: (e: React.DragEvent) => e.preventDefault(),
                      onDrop: (e: React.DragEvent) => {
                        e.preventDefault();
                        const fr = dragExc.current;
                        if (fr != null && fr !== i) on!.moveExc(fr, i);
                        dragExc.current = null;
                      },
                    }
                  : {})}
              >
                <span className="bul ex">✕</span>
                {E ? (
                  <>
                    <span
                      className="draghand"
                      draggable
                      onDragStart={() => { dragExc.current = i; }}
                      title="Glisser pour réordonner"
                    >
                      ⠿
                    </span>
                    <EditableText
                      value={x}
                      placeholder="Prestation non incluse"
                      onChange={(v) => on!.setExc(i, v)}
                      style={{ flex: 1 }}
                    />
                    <button className="delrow" onClick={() => on!.rmExc(i)}>×</button>
                  </>
                ) : (
                  <span>{x}</span>
                )}
              </div>
            ))}
          </div>
          {E && <button className="addrow" onClick={on!.addExc}>+ Ajouter une prestation non incluse</button>}
        </div>
      )}
    </>
  );

  const secTexts = (
    <>
      {(isF ? importantShow.length > 0 : s.showImportant !== false || E) && (
        <div className="sec">
          <div className="seclbl">Conditions importantes</div>
          {E ? (
            <div>
              {important.map((x, i) => (
                <div key={i} className="incrow">
                  <span className="bul" style={{ color: 'var(--gold)' }}>•</span>
                  <EditableText
                    value={x}
                    placeholder="Condition importante"
                    onChange={(v) => on!.setImp(i, v)}
                    style={{ flex: 1 }}
                  />
                  <button className="delrow" onClick={() => on!.rmImp(i)}>×</button>
                </div>
              ))}
              <button className="addrow" onClick={on!.addImp}>+ Ajouter une condition</button>
            </div>
          ) : (
            <ul className="implist">{importantShow.map((x, i) => <li key={i}>{x}</li>)}</ul>
          )}
        </div>
      )}

      {(isF ? !!notesShow : s.showNotes !== false && (notesTxt || E)) && (
        <div className="sec">
          <div className="seclbl">{isF ? 'Mentions administratives' : 'Notes médicales et administratives'}</div>
          <div className="notesbox">
            {E ? <EditableText multiline value={notesTxt} onChange={(v) => set('cgv', v)} /> : notesShow}
          </div>
        </div>
      )}
    </>
  );

  const bottomBlock = (i: number) => (
    <div>
      {!isF && s.showSignature !== false && (
        <div className="signrow">
          <span>Fait le {fmtDate(record.date)}</span>
          <span className="signlab">
            {String(s.signature || 'Signature du patient — précédée de la mention « Lu et approuvé »')}
            <span className="signline" />
          </span>
        </div>
      )}
      <div className="endblock">
        <span>
          {footLegal ||
            (s.company || 'Clinic NobelWorld') + ' — Document non contractuel à valeur d’estimation.'}
        </span>
        {s.showQR !== false && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="qr"
            src={qr}
            alt="QR"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        )}
      </div>
      <FootLine i={i} />
    </div>
  );

  const tailGroups: React.ReactNode[][] =
    P === 1
      ? []
      : P === 2
        ? [[secPay, secLists, secTexts]]
        : P === 3
          ? [[secPay, secLists], [secTexts]]
          : [[secPay], [secLists], [secTexts]];

  return (
    <div className="doc-wrap" ref={rootRef}>
      {overNow && (
        <div className="pdfwarn">
          {modeRaw === 'auto' ? (
            <>⚠ Contenu exceptionnellement long : l&apos;impression ajoutera une feuille supplémentaire. Aucun contenu ne sera perdu.</>
          ) : (
            <>
              ⚠ Le contenu ne tient pas confortablement sur {P} page{P > 1 ? 's' : ''}. Vous pouvez conserver {P} page
              {P > 1 ? 's' : ''} (l&apos;impression ajoutera le nécessaire, rien ne sera perdu ni réduit)
              {P < 4 ? ' ou passer à ' + (P + 1) + ' pages' : ''}.
              {E && (
                <span style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <button className="btn btn-sm" onClick={() => setOverNow(false)}>
                    Conserver {P} page{P > 1 ? 's' : ''}
                  </button>
                  {P < 4 && (
                    <button className="btn btn-sm" onClick={() => set('pagesMode', String(P + 1))}>
                      Passer à {P + 1} pages
                    </button>
                  )}
                  <button className="btn btn-sm" onClick={() => set('pagesMode', 'auto')}>
                    Pagination automatique
                  </button>
                </span>
              )}
            </>
          )}
        </div>
      )}
      <div className={'doc' + (E ? ' doc-edit' : '')}>
        {/* ===================== PAGE 1 ===================== */}
        <section className="page">
          <div className="dhead center">
            <LogoCN px={62} />
            <div className="brandline">CLINIC NOBEL · Medical &amp; Aesthetic Surgery · Istanbul • Türkiye</div>
            <div className="brandcoord">{webv} · {emailv} · {phonev}</div>
          </div>
          <div className="hsep" />
          <div className="metarow">
            {conseiller && (conseiller.prenom || conseiller.nom || conseiller.email) ? (
              <div className="adv">
                <div className="advt">👤 Conseiller médical</div>
                <div className="advn">{userLabel(conseiller)}</div>
                {conseiller.fonction && <div className="advf">{conseiller.fonction}</div>}
                {conseiller.telephone && <div className="advp">📞 {fmtPhone(conseiller.telephone)}</div>}
              </div>
            ) : (
              <div />
            )}
            <div className="docmeta">
              <div className="ty">{isF ? 'Facture' : 'Devis'}</div>
              <div className="no">{record.numero || '—'}</div>
              <div className="dt">
                {'Date : '}
                {E ? (
                  <input
                    type="date"
                    className="ed"
                    value={normalizeDate(record.date)}
                    onChange={(e) => set('date', e.target.value)}
                  />
                ) : (
                  <b>{fmtDate(record.date)}</b>
                )}
                {!isF && (
                  <>
                    <br />
                    {'Validité : '}
                    {E ? (
                      <input
                        type="date"
                        className="ed"
                        value={normalizeDate(record.validite)}
                        onChange={(e) => set('validite', e.target.value)}
                      />
                    ) : (
                      <b>{fmtDate(record.validite)}</b>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="dbody">
            <div className="doctitle">
              {isF ? 'FACTURE' : 'DEVIS MÉDICAL'}
              <span className="sub">{s.company}</span>
            </div>
            {Number(record.promoJours) > 0 && !isF && (
              <div className="promoline">Offre promotionnelle — valable {record.promoJours} jours</div>
            )}

            <div className="pinfo">
              <div className="c">
                <div className="k">Patient(e)</div>
                <div className="val">
                  {E ? (
                    <select
                      className="ed"
                      value={record.patientId || ''}
                      onChange={(e) => set('patientId', e.target.value)}
                    >
                      <option value="">— Sélectionner —</option>
                      {(on?.patients || []).map((p) => (
                        <option key={p.id} value={p.id}>{patientName(p)}</option>
                      ))}
                    </select>
                  ) : (
                    patientName(patient)
                  )}
                </div>
              </div>
              <div className="c">
                <div className="k">Date du devis</div>
                <div className="val">
                  {E ? (
                    <input
                      type="date"
                      className="ed"
                      value={normalizeDate(record.date)}
                      onChange={(e) => set('date', e.target.value)}
                    />
                  ) : (
                    fmtDate(record.date)
                  )}
                </div>
              </div>
              <div className="c">
                <div className="k">Date prévue de l&apos;intervention</div>
                <div className="val">
                  {E ? (
                    <input
                      type="date"
                      className="ed"
                      disabled={!canDateOp}
                      title={canDateOp ? '' : "Permission « Modifier la date d'opération » requise"}
                      value={normalizeDate(record.dateIntervention)}
                      onChange={(e) => canDateOp && set('dateIntervention', e.target.value)}
                    />
                  ) : record.dateIntervention ? (
                    fmtDate(record.dateIntervention)
                  ) : (
                    'À définir'
                  )}
                </div>
              </div>
              <div className="c">
                <div className="k">Chirurgien</div>
                <div className="val">
                  {E && on!.medecins?.length && on!.setMedecin ? (
                    <select
                      className="ed"
                      value={record.medecinId || ''}
                      onChange={(e) => on!.setMedecin!(e.target.value)}
                    >
                      {/* Ligne vide en tête, jamais pré-remplie. Un document
                          d'avant le 23/08 dont le texte n'a pas de référence
                          montre ici ce texte — celui qui s'imprime. */}
                      <option value="">
                        {!record.medecinId && record.chirurgien ? record.chirurgien : 'À confirmer'}
                      </option>
                      {ordonnerMedecins(on!.medecins).map((m) => (
                        <option key={m.id} value={m.id}>{m.nomAffiche}</option>
                      ))}
                    </select>
                  ) : E ? (
                    <EditableText value={record.chirurgien} placeholder="Dr …" onChange={(v) => set('chirurgien', v)} />
                  ) : (
                    record.chirurgien || 'À confirmer'
                  )}
                </div>
              </div>
              <div className="c" style={{ gridColumn: '1 / -1' }}>
                <div className="k">Clinique partenaire</div>
                <div className="val">
                  {E ? (
                    <EditableText
                      multiline
                      value={record.hopital}
                      placeholder="Clinique / hôpital"
                      onChange={(v) => set('hopital', v)}
                    />
                  ) : (
                    record.hopital || s.address
                  )}
                </div>
              </div>
            </div>

            <div className="sec">
              <div className="seclbl">Interventions prévues</div>
              <table className="acttab">
                <thead>
                  <tr>
                    <th>Acte</th>
                    <th>Inclus / détail</th>
                  </tr>
                </thead>
                <tbody>
                  {actes.map((a) => (
                    <tr key={a.id}>
                      <td className="act">
                        {E ? (
                          <>
                            <EditableText
                              value={a.acte}
                              placeholder="Acte"
                              onChange={(v) => on!.setActe(a.id, 'acte', v)}
                            />
                            <PastilleCatalogue
                              libelle={a.acte}
                              modeles={on!.modeles}
                              correspondances={on!.correspondances}
                            />
                          </>
                        ) : (
                          a.acte
                        )}
                      </td>
                      <td>
                        {E ? (
                          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                            <EditableText
                              multiline
                              value={a.inclus}
                              placeholder="Détail / ce qui est inclus"
                              onChange={(v) => on!.setActe(a.id, 'inclus', v)}
                            />
                            <button className="delrow" title="Retirer" onClick={() => on!.rmActe(a.id)}>×</button>
                          </div>
                        ) : (
                          a.inclus
                        )}
                      </td>
                    </tr>
                  ))}
                  {!actes.length && !E && (
                    <tr>
                      <td colSpan={2} style={{ color: 'var(--muted-2)', textAlign: 'center', padding: 16 }}>—</td>
                    </tr>
                  )}
                </tbody>
              </table>
              {E && (
                <div className="addrow-bar">
                  <button className="addrow" onClick={on!.addActe}>+ Ajouter un acte</button>
                  {!!on!.modeles?.length && (
                    <SelecteurModele
                      modeles={on!.modeles}
                      devise={cur}
                      libelle="Appliquer un modèle à un acte"
                      correspondances={on!.correspondances}
                      onChoisir={(m) => on!.acteDepuisModele!(m)}
                    />
                  )}
                </div>
              )}
            </div>

            {/* Hors éditeur, cette section ne montre que les options RETENUES :
                celles à décider ont leur propre bloc sous le reste à payer.
                Toutes les options d'avant ce lot sont retenues — affichage inchangé. */}
            {((E ? options.length > 0 : optionsRetenues.length > 0) || E) && (
              <div className="sec">
                <div className="seclbl">
                  Option{(E ? options.length : optionsRetenues.length) > 1 ? 's' : ''}
                </div>
                <div>
                  {(E ? options : optionsRetenues).map((o, i) => (
                    <div key={o.id || 'o' + i} className="optrow">
                      {E ? (
                        <>
                          <span className="lbl" style={{ flex: 1 }}>
                            <EditableText
                              value={o.nom}
                              placeholder="Option"
                              onChange={(v) => on!.setOpt(i, 'nom', v)}
                              style={{ width: '100%' }}
                            />
                            <EditableText
                              multiline
                              value={o.detail || ''}
                              placeholder="Détail de l'option"
                              onChange={(v) => on!.setOpt(i, 'detail', v)}
                              className="det"
                            />
                          </span>
                          <label className="optret" title="Retenue : l'option compte dans le total">
                            <input
                              type="checkbox"
                              checked={estRetenue(o)}
                              onChange={(e) => on!.setOpt(i, 'retenue', e.target.checked)}
                            />
                            retenue
                          </label>
                          <input
                            className="ed tnum"
                            style={{ width: '8ch', textAlign: 'right' }}
                            type="number"
                            value={o.prix || 0}
                            onChange={(e) => on!.setOpt(i, 'prix', Number(e.target.value))}
                          />
                          <span className="muted">{cur}</span>
                          <button className="delrow" onClick={() => on!.rmOpt(i)}>×</button>
                        </>
                      ) : (
                        <>
                          <span className="lbl">
                            {o.nom}
                            {o.detail ? <span className="det">{o.detail}</span> : null}
                          </span>
                          <span className="price tnum">{money((o.qty || 1) * o.prix, cur)}</span>
                        </>
                      )}
                    </div>
                  ))}
                </div>
                {E && (
                  <div className="addrow-bar">
                    <button className="addrow" onClick={on!.addOpt}>+ Ajouter une option</button>
                    {!!on!.modeles?.length && (
                      <SelecteurModele
                        modeles={on!.modeles}
                        devise={cur}
                        libelle="Appliquer un modèle à une option"
                        correspondances={on!.correspondances}
                        onChoisir={(m) => on!.optDepuisModele!(m)}
                      />
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          {P === 1 && <div className="dbody dbody2">{secPay}{secLists}{secTexts}</div>}
          {P === 1 ? bottomBlock(1) : <FootLine i={1} />}
        </section>

        {/* ============ PAGES SUIVANTES — réparties selon le réglage ============ */}
        {tailGroups.map((g, gi) => {
          const no = gi + 2;
          const last = gi === tailGroups.length - 1;
          return (
            <section key={no} className="page page-break">
              <div className="loghead">
                <LogoCN px={44} />
                <div className="suite">
                  {isF ? 'Facture' : 'Devis'} {record.numero || ''} — suite{' '}
                  {tailGroups.length > 1 ? `(${no}/${P})` : ''}
                </div>
              </div>
              <div className="dbody dbody2">
                {g.map((el, k) => (
                  <React.Fragment key={k}>{el}</React.Fragment>
                ))}
              </div>
              {last ? bottomBlock(no) : <FootLine i={no} />}
            </section>
          );
        })}
      </div>
    </div>
  );
}
