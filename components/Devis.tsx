'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Confirm, Empty, Field, Input, Modal, Select, StatusBadge, Textarea, useNavOverlay,
} from './ui';
import { Ico } from './icons';
import { DevisDoc, type DocHandlers } from './DevisDoc';
import { DocumentView } from './DocumentView';
import { PatientForm } from './Patients';
import { useApp } from './AppContext';
import { addDays, arrMove, fmtDate, money, normalizeDate, todayISO, uid } from '@/lib/format';
import {
  composeIncExc, DEFAULT_IMPORTANT, DEFAULT_PAIEMENT_NOTE, PDF_TEXTS, settingsImpLines, UNSAVED_MSG,
} from '@/lib/defaults';
import { can, estDeMoi, userLabel } from '@/lib/perms';
import { devisTotal, estFige, patientName, remiseMontant, totalAvantRemise, totalOf } from '@/lib/calc';
import type { DocRecord } from '@/lib/types';

/* =========================================================================
   DEVIS
   ------------------------------------------------------------------------- */
export function DevisView() {
  const { data, user, save, remove, nextNumber, toast, go } = useApp();
  const [editor, setEditor] = useState<DocRecord | null>(null); // {} ou devis existant
  const [viewDoc, setViewDoc] = useState<DocRecord | null>(null);
  const [del, setDel] = useState<DocRecord | null>(null);
  const [filter, setFilter] = useState('tous');
  const seeAllDevis = can(user, 'all') || can(user, 'devisViewAll');
  let list = seeAllDevis ? data.devis : data.devis.filter((d) => estDeMoi(user, d.createdBy));
  if (filter !== 'tous') list = list.filter((d) => d.statut === filter);
  list = [...list].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const cur = data.parametres.currency || '€';

  const duplicate = async (d: DocRecord) => {
    const numero = await nextNumber('devis');
    const copy: DocRecord = { ...d };
    delete copy.id;
    delete copy.createdAt;
    delete copy.updatedAt;
    await save(
      'devis',
      { ...copy, numero, statut: 'brouillon', createdBy: userLabel(user) },
      `a dupliqué un devis → ${numero}`,
    );
    toast('Devis dupliqué : ' + numero);
  };

  const convert = async (d: DocRecord) => {
    const numero = await nextNumber('facture');
    const fac: DocRecord = {
      ...d, id: undefined, numeroDevis: d.numero, numero, statut: 'brouillon',
      devisId: d.id, createdBy: userLabel(user),
    };
    delete fac.createdAt;
    delete fac.updatedAt;
    // Nouvelle facture = coordonnées bancaires et devise ACTUELLES des paramètres
    // (le devis, lui, conserve celles figées à sa propre création).
    const PB = data.parametres || {};
    fac.bqNom = PB.bankName || '';
    fac.bqAdresse = PB.bankAddress || '';
    fac.bqIban = PB.iban || '';
    fac.bqBic = PB.bic || '';
    fac.devise = PB.currency || fac.devise || '€';
    await save('factures', fac, `a transformé ${d.numero} en facture ${numero}`);
    await save('devis', { ...d, statut: 'accepte' });
    toast('Facture créée : ' + numero);
    go('factures');
  };

  return (
    <>
      <div className="toolbar">
        <div className="sec-head" style={{ margin: 0 }}>
          <div>
            <h2>Devis</h2>
            <div className="desc">{list.length} devis</div>
          </div>
        </div>
        <div className="sp" />
        <div className="seg">
          {['tous', 'brouillon', 'envoye', 'accepte'].map((k) => (
            <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
              {k === 'tous'
                ? 'Tous'
                : ({ brouillon: 'Brouillons', envoye: 'Envoyés', accepte: 'Acceptés' } as Record<string, string>)[k]}
            </button>
          ))}
        </div>
        {can(user, 'devisCreate') && (
          <button className="btn btn-primary" onClick={() => setEditor({})}>
            <Ico.plus size={16} />Nouveau devis
          </button>
        )}
      </div>
      <div className="card">
        {list.length ? (
          <table>
            <thead>
              <tr>
                <th>N°</th><th>Patient</th><th>Date</th><th>Intervention</th><th>Statut</th>
                <th className="r" style={{ textAlign: 'right' }}>Total</th><th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((d) => {
                const p = data.patients.find((x) => x.id === d.patientId);
                const mine = estDeMoi(user, d.createdBy);
                const canEdit =
                  can(user, 'devisEditAll') || can(user, 'all') || (can(user, 'devisEditOwn') && mine);
                return (
                  <tr key={d.id} className="clickable" onClick={() => setViewDoc(d)}>
                    <td className="t-strong">{d.numero}</td>
                    <td>{patientName(p)}</td>
                    <td className="muted">{fmtDate(d.date)}</td>
                    <td className="muted">{d.dateIntervention ? fmtDate(d.dateIntervention) : '—'}</td>
                    <td><StatusBadge s={d.statut} /></td>
                    <td className="tnum t-strong" style={{ textAlign: 'right' }}>{money(totalOf(d), cur)}</td>
                    <td onClick={(e) => e.stopPropagation()} style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {canEdit && (
                        <button className="btn btn-ghost btn-sm" title="Modifier" onClick={() => setEditor(d)}>
                          <Ico.edit size={15} />
                        </button>
                      )}
                      {can(user, 'devisDuplicate') || can(user, 'all') ? (
                        <button className="btn btn-ghost btn-sm" title="Dupliquer" onClick={() => duplicate(d)}>
                          <Ico.copy size={15} />
                        </button>
                      ) : null}
                      {(can(user, 'factureCreate') || can(user, 'all')) && (
                        <button className="btn btn-ghost btn-sm" title="→ Facture" onClick={() => convert(d)}>
                          <Ico.invoice size={15} />
                        </button>
                      )}
                      {can(user, 'all') && (
                        <button
                          className="btn btn-ghost btn-sm btn-danger"
                          title="Supprimer"
                          onClick={() => setDel(d)}
                        >
                          <Ico.trash size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <Empty
            icon={Ico.doc}
            title="Aucun devis"
            sub="Créez un devis premium en quelques clics."
            action={
              can(user, 'devisCreate') ? (
                <button className="btn btn-primary" onClick={() => setEditor({})}>
                  <Ico.plus size={16} />Nouveau devis
                </button>
              ) : undefined
            }
          />
        )}
      </div>
      {editor && (
        <DevisEditor
          devis={editor}
          list={list}
          onClose={() => setEditor(null)}
          onPreview={(d) => setViewDoc(d)}
        />
      )}
      {viewDoc && (
        <DocumentView
          record={viewDoc}
          type="devis"
          list={list}
          onChange={setViewDoc}
          onClose={() => setViewDoc(null)}
        />
      )}
      {del && (
        <Confirm
          danger
          title="Supprimer le devis"
          message={`Supprimer ${del.numero} ?`}
          yes="Supprimer"
          onClose={() => setDel(null)}
          onYes={async () => {
            await remove('devis', del.id!, `a supprimé le devis ${del.numero}`);
            toast('Devis supprimé', 'err');
          }}
        />
      )}
    </>
  );
}

/* =========================================================================
   ÉDITEUR DE DEVIS (WYSIWYG — page A4 éditable au clic)
   ------------------------------------------------------------------------- */
export function DevisEditor({
  devis, onClose, onPreview, list,
}: {
  devis: DocRecord;
  onClose: () => void;
  onPreview?: (d: DocRecord) => void;
  list?: DocRecord[];
}) {
  const { data, user, save, nextNumber, toast } = useApp();
  const cur = data.parametres.currency || '€';
  const [quickPatient, setQuickPatient] = useState(false);
  const [dirty, setDirty] = useState(false);
  const dmounted = useRef(false);
  const [curDevis, setCurDevis] = useState<DocRecord>(devis); // devis en cours d'édition (change via ‹ ›)
  const isEdit = !!curDevis.id;

  // Construit l'état du formulaire à partir d'un devis (réutilisé lors de la navigation)
  const buildForm = (d: DocRecord): DocRecord => {
    const P = data.parametres || ({} as typeof data.parametres);
    const ie = composeIncExc(P);
    const validJ = (P.promoActive ? Number(P.validitePromoJours || 8) : Number(P.validiteJours || 30)) || 30;
    const base: DocRecord = {
      patientId: '', date: todayISO(), validite: addDays(todayISO(), validJ), dateIntervention: '',
      chirurgien: '', hopital: P.address || '', modeleId: '',
      actes: [], inc: ie.inc, exc: ie.exc, options: [], importantList: settingsImpLines(P),
      paiementNote: P.paiementNote != null && P.paiementNote !== '' ? P.paiementNote : DEFAULT_PAIEMENT_NOTE,
      cgv: P.cgv != null ? P.cgv : '',       // photographie des notes médicales & administratives
      legal: P.legal != null ? P.legal : '', // photographie des mentions finales
      promoJours: P.promoActive ? Number(P.validitePromoJours || 8) : 0,
      remiseValeur: '', remiseType: 'montant', remiseMotif: '',
      devise: P.currency || '€',
      bqNom: P.bankName || '', bqAdresse: P.bankAddress || '', bqIban: P.iban || '', bqBic: P.bic || '',
      forfait: 0, acompte: 0, statut: 'brouillon',
      ...d,
    };
    if (d.id) {
      // compat anciens devis (lignes) → actes
      if ((!base.actes || !base.actes.length) && d.lignes && d.lignes.length) {
        base.actes = d.lignes.map((l) => ({ id: uid('a'), acte: l.desc || '', inclus: '' }));
        if (!Number(base.forfait)) base.forfait = devisTotal(d);
      }
      if ((!base.importantList || !base.importantList.length) && d.important) base.importantList = [d.important];
      if (d.promoJours == null) base.promoJours = 0; // jamais de mention promo rétroactive sur un ancien devis
    }
    if (!base.actes || !base.actes.length) base.actes = [{ id: uid('a'), acte: '', inclus: '' }];
    return base;
  };

  const [f, setF] = useState<DocRecord>(() => buildForm(devis));

  // Marque le devis comme modifié dès qu'un champ change (sauf au montage / après un chargement)
  useEffect(() => {
    if (dmounted.current) setDirty(true);
    else dmounted.current = true;
  }, [f]);

  // ---- Navigation entre devis, dans l'ordre exact de la liste affichée ----
  const items = Array.isArray(list) && list.length ? list : [];
  const idx = items.findIndex((x) => x.id === curDevis.id);
  const showNav = idx >= 0;
  const canPrev = idx > 0;
  const canNext = idx >= 0 && idx < items.length - 1;
  const [pendingNav, setPendingNav] = useState<DocRecord | null>(null);
  const loadDevis = (d: DocRecord) => {
    dmounted.current = false;
    setCurDevis(d);
    setF(buildForm(d));
    setDirty(false);
  };
  const navTo = (d: DocRecord) => {
    if (!d) return;
    if (dirty) setPendingNav(d);
    else loadDevis(d);
  };
  const goPrev = () => { if (canPrev) navTo(items[idx - 1]); };
  const goNext = () => { if (canNext) navTo(items[idx + 1]); };

  // Raccourcis clavier ← / → (ignorés pendant la saisie ou si une boîte est ouverte)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = (e.target || {}) as HTMLElement;
      const tag = (t.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable) return;
      if (pendingNav || quickPatient) return;
      if (e.key === 'ArrowLeft' && canPrev) { e.preventDefault(); goPrev(); }
      else if (e.key === 'ArrowRight' && canNext) { e.preventDefault(); goNext(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, items, canPrev, canNext, dirty, pendingNav, quickPatient]);

  const closeGuard = () => {
    if (dirty && !window.confirm(UNSAVED_MSG)) return;
    onClose();
  };
  useNavOverlay(closeGuard);

  const on: DocHandlers = {
    editable: true,
    patients: data.patients,
    paiements: data.paiements,
    set: (k, v) => setF((s) => ({ ...s, [k]: v })),
    addActe: () => setF((s) => ({ ...s, actes: [...(s.actes || []), { id: uid('a'), acte: '', inclus: '' }] })),
    setActe: (id, k, v) =>
      setF((s) => ({ ...s, actes: (s.actes || []).map((a) => (a.id === id ? { ...a, [k]: v } : a)) })),
    rmActe: (id) => setF((s) => ({ ...s, actes: (s.actes || []).filter((a) => a.id !== id) })),
    addInc: () => setF((s) => ({ ...s, inc: [...(s.inc || []), ''] })),
    setInc: (i, v) => setF((s) => ({ ...s, inc: (s.inc || []).map((x, j) => (j === i ? v : x)) })),
    rmInc: (i) => setF((s) => ({ ...s, inc: (s.inc || []).filter((_, j) => j !== i) })),
    moveInc: (from, to) => setF((s) => ({ ...s, inc: arrMove(s.inc, from, to) })),
    addExc: () => setF((s) => ({ ...s, exc: [...(s.exc || []), ''] })),
    setExc: (i, v) => setF((s) => ({ ...s, exc: (s.exc || []).map((x, j) => (j === i ? v : x)) })),
    rmExc: (i) => setF((s) => ({ ...s, exc: (s.exc || []).filter((_, j) => j !== i) })),
    moveExc: (from, to) => setF((s) => ({ ...s, exc: arrMove(s.exc, from, to) })),
    addOpt: () => setF((s) => ({ ...s, options: [...(s.options || []), { nom: '', qty: 1, prix: 0 }] })),
    setOpt: (i, k, v) =>
      setF((s) => ({ ...s, options: (s.options || []).map((o, j) => (j === i ? { ...o, [k]: v } : o)) })),
    rmOpt: (i) => setF((s) => ({ ...s, options: (s.options || []).filter((_, j) => j !== i) })),
    addImp: () => setF((s) => ({ ...s, importantList: [...(s.importantList || []), ''] })),
    setImp: (i, v) =>
      setF((s) => ({ ...s, importantList: (s.importantList || []).map((x, j) => (j === i ? v : x)) })),
    rmImp: (i) => setF((s) => ({ ...s, importantList: (s.importantList || []).filter((_, j) => j !== i) })),
  };

  /* Applique un modèle du catalogue. La description est RECOPIÉE une fois dans
     l'acte, à cet instant précis ; elle n'est jamais relue du catalogue ensuite.
     C'est ce qui garantit deux choses : le texte saisi à la main par le
     chirurgien n'est jamais écrasé, et un devis déjà parti chez une patiente ne
     change pas si le catalogue évolue. Le catalogue propose, le chirurgien dispose. */
  const applyModele = (id: string) => {
    const m = data.modeles.find((x) => x.id === id);
    if (!m) return;
    const description = typeof m.description === 'string' ? m.description : '';
    setF((s) => ({
      ...s,
      modeleId: id,
      actes: [
        // Les actes déjà saisis sont conservés tels quels ; seuls les vides sont retirés.
        ...(s.actes || []).filter((a) => a.acte || a.inclus),
        { id: uid('a'), acte: m.nom, inclus: description },
      ],
      inc: m.inc && m.inc.length ? [...m.inc] : s.inc || [],
      exc: m.exc && m.exc.length ? [...m.exc] : s.exc || [],
      forfait: Number(s.forfait) || m.prixBase,
    }));
    const alertes: string[] = [];
    if (m.surDevis) alertes.push('tarif sur devis, saisissez le forfait');
    // Une prestation sans description ne casse rien : case vide, à compléter à la main.
    if (!description.trim()) alertes.push('aucune description au catalogue, à rédiger dans « Inclus / détail »');
    toast('Modèle appliqué : ' + m.nom + (alertes.length ? ' — ' + alertes.join(' ; ') : ''));
  };

  const total = totalOf(f);
  const reste = Math.max(0, total - Number(f.acompte || 0));

  const persist = async (statut?: string | null) => {
    const payload: DocRecord = { ...f, statut: statut || f.statut || 'brouillon' };
    // Dates toujours envoyées en « YYYY-MM-DD » propre ; une valeur illisible devient
    // vide au lieu de bloquer l'enregistrement.
    const cleanD = (v: unknown) => {
      if (!v) return '';
      const n = normalizeDate(v);
      return /^\d{4}-\d{2}-\d{2}$/.test(n) ? n : '';
    };
    payload.date = cleanD(payload.date) || todayISO();
    payload.validite = cleanD(payload.validite);
    payload.dateIntervention = cleanD(payload.dateIntervention); // vide = « À définir », autorisé
    // Remise : champ vide ou illisible → 0, jamais bloquant ; type inconnu → montant (€)
    payload.remiseValeur = Number(payload.remiseValeur) > 0 ? Number(payload.remiseValeur) : 0;
    payload.remiseType = payload.remiseType === 'pourcent' ? 'pourcent' : 'montant';
    payload.remiseMotif = String(payload.remiseMotif || '').trim();
    // Textes NON personnalisés (identiques aux Paramètres actuels ou aux défauts intégrés)
    // → non gravés dans le document : il suivra automatiquement les futurs Paramètres.
    {
      const P2 = data.parametres || ({} as typeof data.parametres);
      const tplImp = settingsImpLines(P2).join('\n');
      if (Array.isArray(payload.importantList)) {
        const j = payload.importantList.map((x) => String(x).trim()).filter(Boolean).join('\n');
        if (j === tplImp || j === DEFAULT_IMPORTANT.join('\n')) delete payload.importantList;
      }
      if (payload.paiementNote === DEFAULT_PAIEMENT_NOTE || payload.paiementNote === (P2.paiementNote || ''))
        delete payload.paiementNote;
      if (payload.cgv === (P2.cgv || '') || payload.cgv === PDF_TEXTS.cgv) delete payload.cgv;
      if (payload.legal === (P2.legal || '') || payload.legal === PDF_TEXTS.legal) delete payload.legal;
    }
    if (!payload.numero) payload.numero = await nextNumber('devis');
    if (!isEdit) payload.createdBy = userLabel(user);
    const saved = await save('devis', payload, `${isEdit ? 'a modifié' : 'a créé'} le devis ${payload.numero}`);
    setDirty(false);
    return (saved || payload) as DocRecord;
  };

  const [saving, setSaving] = useState(false);
  // Droits fins dans l'éditeur
  const canMoney = can(user, 'all') || can(user, 'montantsEdit');
  const canRemise = can(user, 'all') || can(user, 'remiseEdit');
  const canPages = can(user, 'all') || can(user, 'pagesEdit');
  const canBank = can(user, 'all') || can(user, 'paramEdit');

  const finish = async (statut: string | null, preview: boolean) => {
    if (saving) return; // anti double-clic
    // Un devis envoyé ou accepté est figé : on ne le réécrit jamais sans confirmation explicite.
    if (isEdit && estFige(curDevis) && dirty) {
      const st = curDevis.statut === 'accepte' ? 'accepté' : 'envoyé';
      if (
        !window.confirm(
          `Ce devis est ${st} : la patiente en a peut-être déjà reçu une copie.\n\n` +
            'Modifier ses montants ou ses textes rendra le document différent de celui qu’elle détient.\n\n' +
            'OK = Enregistrer quand même · Annuler = Conserver la version envoyée',
        )
      )
        return;
    }
    setSaving(true);
    try {
      const saved = await persist(statut);
      toast(isEdit ? 'Devis mis à jour ✓' : 'Devis créé : ' + saved.numero);
      onClose();
      if (preview && onPreview) onPreview(saved);
    } catch (e) {
      // ctx.save affiche déjà le détail de l'erreur ; l'éditeur reste ouvert, rien n'est perdu.
      console.error('[CN][devis] échec enregistrement', e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="editor-overlay">
      <div className="editor">
        <div className="editor-top">
          <button className="btn btn-ghost btn-sm" onClick={closeGuard}><Ico.x size={18} /></button>
          <h3>{isEdit ? 'Modifier ' + (curDevis.numero || 'le devis') : 'Nouveau devis'}</h3>
          {showNav && (
            <div className="editor-nav">
              <button className="btn btn-sm" disabled={!canPrev} onClick={goPrev} title="Devis précédent (←)">
                <Ico.chevron size={16} style={{ transform: 'rotate(180deg)' }} />
              </button>
              <span className="editor-nav-c">Devis {idx + 1} / {items.length}</span>
              <button className="btn btn-sm" disabled={!canNext} onClick={goNext} title="Devis suivant (→)">
                <Ico.chevron size={16} />
              </button>
            </div>
          )}
          <button className="btn" disabled={saving} onClick={() => finish(null, true)}>
            <Ico.print size={15} />Aperçu / PDF
          </button>
          <button className="btn btn-primary" disabled={saving} onClick={() => finish(f.statut || null, false)}>
            <Ico.check size={16} />{saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
        <div className="editor-main">
          <div className="editor-doc">
            <DevisDoc
              record={f}
              settings={data.parametres}
              patient={data.patients.find((p) => p.id === f.patientId)}
              type="devis"
              paid={Number(f.acompte || 0)}
              editable
              on={on}
            />
          </div>
          <div className="editor-side">
            {isEdit && estFige(curDevis) && (
              <div
                style={{
                  background: '#fff7e8', border: '1px solid #f0dcae', color: '#7a5d1f',
                  borderRadius: 10, padding: '9px 12px', fontSize: 12, lineHeight: 1.55, marginBottom: 14,
                }}
              >
                ⚠ Devis {curDevis.statut === 'accepte' ? 'accepté' : 'envoyé'} — la patiente en détient peut-être
                déjà une copie. Préférez une <b>duplication</b> plutôt qu&apos;une réécriture.
              </div>
            )}
            <h4>Patient &amp; statut</h4>
            <div className="side-actions">
              <Select value={f.patientId || ''} onChange={(e) => on.set('patientId', e.target.value)}>
                <option value="">— Choisir un patient —</option>
                {data.patients.map((p) => (
                  <option key={p.id} value={p.id}>{patientName(p)}</option>
                ))}
              </Select>
              {can(user, 'patientCreate') && (
                <button className="btn btn-sm btn-ghost" onClick={() => setQuickPatient(true)}>
                  <Ico.plus size={14} />Nouveau patient
                </button>
              )}
              <Select value={f.statut || 'brouillon'} onChange={(e) => on.set('statut', e.target.value)}>
                <option value="brouillon">Brouillon</option>
                <option value="envoye">Envoyé</option>
                <option value="accepte">Accepté</option>
              </Select>
            </div>
            <h4>Modèle de devis</h4>
            <Select value={f.modeleId || ''} onChange={(e) => applyModele(e.target.value)}>
              <option value="">— Appliquer un modèle —</option>
              {data.modeles.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nom} · {m.surDevis ? 'sur devis' : money(m.prixBase, cur)}
                </option>
              ))}
            </Select>
            <p className="muted" style={{ fontSize: 11.5, lineHeight: 1.5, margin: '6px 0 0' }}>
              Catalogue en lecture seule (CRM Clinic Nobel). Une prestation absente doit y être ajoutée par le CRM.
            </p>
            <h4>Mise en page PDF</h4>
            <Field label="Nombre de pages du PDF" hint="enregistré avec ce document">
              <Select
                disabled={!canPages}
                title={canPages ? '' : 'Permission « Choisir le nombre de pages » requise'}
                value={f.pagesMode || 'auto'}
                onChange={(e) => canPages && on.set('pagesMode', e.target.value)}
              >
                <option value="auto">Automatique</option>
                <option value="1">1 page</option>
                <option value="2">2 pages</option>
                <option value="3">3 pages</option>
                <option value="4">4 pages</option>
              </Select>
            </Field>
            <h4>Tarification</h4>
            <Field label="Prix du forfait" hint={cur}>
              <Input
                type="number"
                disabled={!canMoney}
                title={canMoney ? '' : 'Permission « Modifier les montants » requise'}
                value={f.forfait ?? 0}
                onChange={(e) => canMoney && on.set('forfait', Number(e.target.value))}
              />
            </Field>
            <Field label="Remise promotionnelle" hint={f.remiseType === 'pourcent' ? '%' : cur}>
              <div style={{ display: 'flex', gap: 8 }}>
                <Input
                  type="number"
                  min="0"
                  style={{ flex: 1 }}
                  value={f.remiseValeur ?? ''}
                  placeholder="0"
                  disabled={!canRemise}
                  title={canRemise ? '' : 'Permission « Ajouter / modifier une remise » requise'}
                  onChange={(e) =>
                    canRemise && on.set('remiseValeur', e.target.value === '' ? '' : Number(e.target.value))
                  }
                />
                <Select
                  style={{ flex: '0 0 76px', width: 76 }}
                  disabled={!canRemise}
                  value={f.remiseType || 'montant'}
                  onChange={(e) => canRemise && on.set('remiseType', e.target.value)}
                >
                  <option value="montant">{cur}</option>
                  <option value="pourcent">%</option>
                </Select>
              </div>
            </Field>
            <Field label="Motif de la remise" hint="optionnel — affiché sur le PDF">
              <Input
                value={f.remiseMotif || ''}
                disabled={!canRemise}
                placeholder="Offre promotionnelle valable 8 jours"
                onChange={(e) => canRemise && on.set('remiseMotif', e.target.value)}
              />
            </Field>
            <Field label="Acompte à la réservation" hint={cur}>
              <Input
                type="number"
                disabled={!canMoney}
                title={canMoney ? '' : 'Permission « Modifier les montants » requise'}
                value={f.acompte ?? 0}
                onChange={(e) => canMoney && on.set('acompte', Number(e.target.value))}
              />
            </Field>
            <div className="reste-box">
              {remiseMontant(f) > 0 && (
                <div className="l">
                  <span>Avant remise</span>
                  <span className="v tnum">{money(totalAvantRemise(f), cur)}</span>
                </div>
              )}
              {remiseMontant(f) > 0 && (
                <div className="l">
                  <span>Remise</span>
                  <span className="v tnum">-{money(remiseMontant(f), cur)}</span>
                </div>
              )}
              <div className="l">
                <span>{remiseMontant(f) > 0 ? 'Total après remise' : 'Total'}</span>
                <span className="v tnum">{money(total, cur)}</span>
              </div>
              <div className="l">
                <span>Acompte</span>
                <span className="v tnum">{money(Number(f.acompte || 0), cur)}</span>
              </div>
              <div className="l big">
                <span>Reste à payer</span>
                <span className="v tnum">{money(reste, cur)}</span>
              </div>
            </div>
            <h4>Ajouts rapides</h4>
            <div className="side-actions">
              <button className="btn btn-sm" onClick={on.addActe}><Ico.plus size={14} />Acte / intervention</button>
              <button className="btn btn-sm" onClick={on.addInc}><Ico.plus size={14} />Prestation incluse</button>
              <button className="btn btn-sm" onClick={on.addOpt}><Ico.plus size={14} />Option</button>
            </div>
            <details className="pdfopts">
              <summary>Options PDF du document</summary>
              <p className="muted" style={{ fontSize: 11.5, lineHeight: 1.5, margin: '0 0 10px' }}>
                Modifications valables <b>uniquement pour ce document</b> (les modèles se règlent dans
                Paramètres → Textes PDF).
              </p>
              <button
                className="btn btn-sm"
                style={{ marginBottom: 12 }}
                onClick={() => {
                  if (
                    !window.confirm(
                      'Remplacer les textes de ce document (conditions, notes, paiement, mentions, prestations incluses/exclues) par les paramètres PDF actuels ?',
                    )
                  )
                    return;
                  const P = data.parametres || ({} as typeof data.parametres);
                  const ie = composeIncExc(P);
                  setF((x) => ({
                    ...x,
                    importantList: settingsImpLines(P),
                    cgv: P.cgv || '',
                    legal: P.legal || '',
                    paiementNote: P.paiementNote || DEFAULT_PAIEMENT_NOTE,
                    inc: ie.inc,
                    exc: ie.exc,
                  }));
                  toast('Paramètres PDF appliqués à ce document');
                }}
              >
                <Ico.check size={14} />Appliquer les paramètres PDF actuels
              </button>
              <Field label="Notes médicales et administratives">
                <Textarea
                  style={{ minHeight: 120 }}
                  value={f.cgv != null ? f.cgv : ''}
                  onChange={(e) => on.set('cgv', e.target.value)}
                />
              </Field>
              <Field label="Modalités de paiement">
                <Textarea
                  style={{ minHeight: 70 }}
                  value={f.paiementNote || ''}
                  onChange={(e) => on.set('paiementNote', e.target.value)}
                />
              </Field>
              <Field label="Mentions finales">
                <Textarea
                  style={{ minHeight: 56 }}
                  value={f.legal != null ? f.legal : ''}
                  onChange={(e) => on.set('legal', e.target.value)}
                />
              </Field>
              {canBank && (
                <>
                  <Field label="Banque — nom (ce document)">
                    <Input value={f.bqNom != null ? f.bqNom : ''} onChange={(e) => on.set('bqNom', e.target.value)} />
                  </Field>
                  <Field label="Banque — adresse (ce document)">
                    <Input
                      value={f.bqAdresse != null ? f.bqAdresse : ''}
                      onChange={(e) => on.set('bqAdresse', e.target.value)}
                    />
                  </Field>
                  <div className="row2">
                    <Field label="IBAN (ce document)">
                      <Input value={f.bqIban != null ? f.bqIban : ''} onChange={(e) => on.set('bqIban', e.target.value)} />
                    </Field>
                    <Field label="BIC (ce document)">
                      <Input value={f.bqBic != null ? f.bqBic : ''} onChange={(e) => on.set('bqBic', e.target.value)} />
                    </Field>
                  </div>
                  <button
                    className="btn btn-sm"
                    style={{ marginBottom: 10 }}
                    onClick={() => {
                      if (
                        !window.confirm(
                          'Souhaitez-vous remplacer les coordonnées bancaires de ce document par les coordonnées actuellement enregistrées dans les paramètres ?\n\nOK = Actualiser · Annuler = Conserver',
                        )
                      )
                        return;
                      const PB = data.parametres || ({} as typeof data.parametres);
                      setF((x) => ({
                        ...x,
                        bqNom: PB.bankName || '', bqAdresse: PB.bankAddress || '',
                        bqIban: PB.iban || '', bqBic: PB.bic || '',
                      }));
                      toast('Coordonnées bancaires actualisées pour ce document');
                    }}
                  >
                    <Ico.check size={14} />Actualiser avec les coordonnées bancaires actuelles
                  </button>
                </>
              )}
              <p className="muted" style={{ fontSize: 11.5, lineHeight: 1.5, margin: '4px 0 0' }}>
                Conditions importantes, prestations incluses / non incluses et options se modifient directement{' '}
                <b>sur le document</b> (cliquez sur le texte).
              </p>
            </details>
          </div>
        </div>
      </div>
      {quickPatient && (
        <div style={{ position: 'relative', zIndex: 100 }}>
          <PatientForm
            patient={{}}
            onClose={() => setQuickPatient(false)}
            onSave={async (v) => {
              const rec = await save('patients', v, `a créé le patient ${patientName(v)}`);
              on.set('patientId', rec.id);
              setQuickPatient(false);
              toast('Patient ajouté');
            }}
          />
        </div>
      )}
      {pendingNav && (
        <Modal
          small
          title="Modifications non sauvegardées"
          onClose={() => setPendingNav(null)}
          footer={
            <>
              <button className="btn" onClick={() => setPendingNav(null)}>Annuler</button>
              <button
                className="btn"
                onClick={() => {
                  const d = pendingNav;
                  setPendingNav(null);
                  loadDevis(d);
                }}
              >
                Continuer sans enregistrer
              </button>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  const d = pendingNav;
                  await persist(f.statut);
                  setPendingNav(null);
                  loadDevis(d);
                  toast('Devis enregistré');
                }}
              >
                <Ico.check size={15} />Enregistrer et continuer
              </button>
            </>
          }
        >
          <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>
            Des modifications ne sont pas sauvegardées. Voulez-vous enregistrer avant de changer de devis&nbsp;?
          </p>
        </Modal>
      )}
    </div>
  );
}
