'use client';

import React, { useState } from 'react';
import { Confirm, Empty, Field, Input, Modal, Select } from './ui';
import { Ico } from './icons';
import { useApp } from './AppContext';
import { fmtDate, todayISO } from '@/lib/format';
import { can, signatureJournal, userLabel } from '@/lib/perms';
import { patientName, totalOf } from '@/lib/calc';
import { factureEstVivante } from '@/lib/fiche';
import {
  classerMouvements, DEVISE_CAISSE, DEVISE_CHANGE, devisePourPaiementChirurgien, estSaisieDeMemoire,
  montantNumerique, rapprochementParPatiente, soldesCaisse, STATUT_ANNULE, tauxDuChange,
} from '@/lib/caisse';
import type { Arrete, Mouvement } from '@/lib/types';

/* =========================================================================
   LA CAISSE DE LA COORDINATRICE — lot 73, 30/08/2026.

   Ceyda saisit sur son téléphone, au moment où l'argent bouge ou le soir :
   · l'accueil, ce sont DEUX nombres, gros, et rien d'autre ;
   · un bouton +, quatre gestes formulés comme elle parle ;
   · trois champs par saisie, clavier numérique en premier ;
   · la date du mouvement N'EST PAS le moment de la saisie : « maintenant »
     par défaut, changée en deux gestes — et une ligne saisie après coup se
     SIGNALE (pas une faute : elle est de mémoire) ;
   · après un enregistrement, l'écran propose le geste suivant (rafale) ;
   · le solde ne se saisit jamais — seul le comptage physique se saisit
     (arrêté), et l'écart compté−calculé est le seul chiffre d'alerte.
   ------------------------------------------------------------------------- */

const LIBELLE_SENS: Record<string, string> = {
  entree: 'Encaissé', sortie: 'Payé', change: 'Change', remise: 'Rendu à la société',
};

/* Jamais deux devises dans un même nombre : le montant porte TOUJOURS la sienne. */
const fmtM = (n: number, devise: string) => {
  const s = n.toLocaleString('fr-FR', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  return `${s} ${devise === 'EUR' ? '€' : devise === 'TRY' ? 'TL' : devise}`;
};

const champDate = { type: 'date' as const };

export function CaisseView() {
  const { data, user, save, toast } = useApp();
  const peutSaisir = can(user, 'caisseEdit') || can(user, 'all');

  const classement = classerMouvements(data.finances);
  /* Le solde qui FAIT FOI est la vue en base (vue_caisse_solde). Le calcul
     local (lib/caisse.ts, même règle — le miroir que la recette rejoue) ne
     sert que de repli quand la vue est indisponible, et l'écran le dit. */
  const locaux = soldesCaisse(data.finances, data.arretes);
  const surVue = data.soldesCaisse.length > 0;
  const soldes = surVue
    ? data.soldesCaisse.map((s) => ({ devise: s.devise, solde: s.solde, depuisArrete: s.depuisArrete }))
    : locaux;
  const illisiblesEnBase = surVue ? data.soldesCaisse[0].lignesIllisibles : classement.illisibles.length;

  const arretesTries = [...data.arretes]
    .sort((a, b) => (b.date + String(b.createdAt || '')).localeCompare(a.date + String(a.createdAt || '')));
  const dernierArrete = arretesTries[0];

  const [geste, setGeste] = useState<null | 'menu' | 'encaisse' | 'paye' | 'change' | 'rendu' | 'arrete'>(null);
  const [aAnnuler, setAAnnuler] = useState<Mouvement | null>(null);

  const patientsTries = [...data.patients].sort((a, b) => patientName(a).localeCompare(patientName(b), 'fr'));
  const nomPatiente = (id: string) => {
    const p = data.patients.find((x) => x.id === id);
    return p ? patientName(p) : '';
  };

  /* Rafale : on enregistre, on DIT, et l'écran repropose un geste — cinq
     mouvements doivent s'entrer en une minute, sinon le cinquième ne sera
     pas saisi. */
  const enregistrerMouvement = async (m: Partial<Mouvement>, message: string) => {
    try {
      await save('finances', { ...m, creePar: signatureJournal(user) }, message);
      toast('Enregistré ✓ — au suivant.');
      setGeste('menu');
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Enregistrement impossible.', 'err');
      return false;
    }
  };

  const annuler = async (m: Mouvement) => {
    /* Un mouvement ne se supprime pas : il s'annule, avec sa trace — même
       règle que les factures. supprimer('finances') REFUSE, par construction. */
    const trace = `annulé le ${todayISO()} par ${signatureJournal(user)}`;
    try {
      await save(
        'finances',
        { ...m, statut: STATUT_ANNULE, notes: m.notes ? `${m.notes} | ${trace}` : trace },
        `a annulé un mouvement de caisse (${LIBELLE_SENS[m.sens] || m.sens || '?'} ${m.montant} ${m.devise} du ${m.date})`,
      );
      toast('Mouvement annulé — il reste visible, avec sa trace.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Annulation impossible.', 'err');
    }
    setAAnnuler(null);
  };

  /* ---- rapprochement par patiente : l'écart se voit AVANT qu'elle reparte ---- */
  const factureParPatiente = new Map<string, number>();
  for (const f of data.factures) {
    if (!factureEstVivante(f.statut) || !f.patientId) continue;
    factureParPatiente.set(f.patientId, (factureParPatiente.get(f.patientId) || 0) + totalOf(f));
  }
  const rapprochement = rapprochementParPatiente(data.finances, factureParPatiente, data.paiements)
    .filter((l) => Math.abs(l.ecart) >= 0.01 || Math.abs(l.encaisse - l.regleNw) >= 0.01)
    .slice(0, 15);

  const mouvementsTries = [...data.finances]
    .sort((a, b) => (b.date + String(b.createdAt || '')).localeCompare(a.date + String(a.createdAt || '')));

  return (
    <>
      <div className="toolbar">
        <div className="sec-head" style={{ margin: 0 }}>
          <div>
            <h2>Caisse</h2>
            <div className="desc">
              {dernierArrete
                ? <>Dernier arrêté : {fmtDate(dernierArrete.date)} ({dernierArrete.devise}) — écart {fmtM(dernierArrete.ecart, dernierArrete.devise)}</>
                : <>Aucun arrêté — le premier sera le solde d&apos;ouverture, après un comptage physique.</>}
            </div>
          </div>
        </div>
        <div className="sp" />
        {peutSaisir && (
          <button className="btn btn-primary" onClick={() => setGeste('menu')} style={{ fontSize: 16 }}>
            <Ico.plus size={18} />Saisir
          </button>
        )}
      </div>

      {/* ---- l'accueil : deux nombres, gros, et rien d'autre ---- */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', marginBottom: 16 }}>
        {(soldes.length ? soldes : [{ devise: DEVISE_CAISSE, solde: 0, depuisArrete: '' }]).map((s) => (
          <div key={s.devise} className="card card-pad" style={{ textAlign: 'center' }}>
            <div className="muted" style={{ fontSize: 12 }}>{s.devise === 'EUR' ? 'Euros en caisse' : s.devise === 'TRY' ? 'Livres en caisse' : s.devise}</div>
            <div className="t-strong" style={{ fontSize: 34, lineHeight: 1.2 }}>{fmtM(s.solde, s.devise)}</div>
            <div className="muted" style={{ fontSize: 11 }}>
              {s.depuisArrete
                ? `depuis l'arrêté du ${fmtDate(s.depuisArrete)}`
                : 'avant tout arrêté : chiffre de contrôle — le change n’a jamais été enregistré avant ce module, la caisse réelle attend le comptage d’ouverture'}
            </div>
          </div>
        ))}
      </div>
      {!surVue && (
        <p className="muted" style={{ fontSize: 11.5, marginTop: -8 }}>
          ⚠ vue_caisse_solde indisponible : solde calculé localement, même règle (lib/caisse.ts).
        </p>
      )}

      {/* ---- ce qui demande une main ou un arbitrage : signalé, jamais deviné ---- */}
      {!!classement.aTrancher.length && (
        <div className="card card-pad" style={{ marginBottom: 12, background: '#fff7e8', border: '1px solid #f0dcae', color: '#7a5d1f', fontSize: 12.5, lineHeight: 1.6 }}>
          ⚠ <b>{classement.aTrancher.length} mouvement(s) sans statut — ni payés ni dus, à trancher par Veys</b> (ils
          n&apos;entrent dans aucun solde) :
          {classement.aTrancher.map((m) => (
            <div key={m.id}>
              · {fmtDate(m.date)} — {m.type} {fmtM(montantNumerique(m.montant) ?? 0, m.devise)}
              {m.patientId ? ` — ${nomPatiente(m.patientId) || m.patientId}` : ' — (sans patiente)'}
              {m.notes ? ` — ${m.notes.split(' | ')[0]}` : ''}
            </div>
          ))}
        </div>
      )}
      {(illisiblesEnBase > 0 || !!classement.aClasser.length || !!classement.enAttente.length) && (
        <div className="card card-pad" style={{ marginBottom: 12, background: '#fff7e8', border: '1px solid #f0dcae', color: '#7a5d1f', fontSize: 12.5, lineHeight: 1.6 }}>
          {illisiblesEnBase > 0 && (
            <div>⚠ <b>{illisiblesEnBase} montant(s) illisible(s)</b> — signalés, exclus de tout total : à corriger, pas à ignorer.</div>
          )}
          {!!classement.aClasser.length && (
            <div>⚠ {classement.aClasser.length} mouvement(s) sans sens (écrits hors de ce module) — à classer, non comptés.</div>
          )}
          {!!classement.enAttente.length && (
            <div>{classement.enAttente.length} mouvement(s) « En attente » — hors caisse tant qu&apos;ils ne sont pas réalisés.</div>
          )}
        </div>
      )}

      {/* ---- rapprochement : encaissé vs facturé, par patiente ---- */}
      {!!rapprochement.length && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-pad" style={{ paddingBottom: 0 }}>
            <b style={{ fontSize: 13.5 }}>Rapprochement — écarts encaissé / facturé</b>
            <p className="muted" style={{ fontSize: 11.5, margin: '4px 0 8px' }}>
              Encaissé = registre de la caisse (espèces, virements, extras). Un extra payé sur place doit finir sur la
              facture finale. « Registre paiements » = nw_paiements, l&apos;autre registre : un écart entre les deux se
              corrige, il ne s&apos;additionne pas.
            </p>
          </div>
          <table>
            <thead>
              <tr><th>Patiente</th><th className="r">Encaissé</th><th className="r">Facturé</th><th className="r">Écart</th><th className="r">Registre paiements</th></tr>
            </thead>
            <tbody>
              {rapprochement.map((l) => (
                <tr key={l.patientId}>
                  <td className="t-strong">{nomPatiente(l.patientId) || l.patientId}</td>
                  <td className="r tnum">{fmtM(l.encaisse, 'EUR')}</td>
                  <td className="r tnum">{fmtM(l.facture, 'EUR')}</td>
                  <td className="r tnum" style={{ color: Math.abs(l.ecart) >= 0.01 ? 'var(--warn)' : undefined }}>
                    {fmtM(l.ecart, 'EUR')}{l.ecart > 0 ? ' (extra ?)' : ''}
                  </td>
                  <td className="r tnum muted">{fmtM(l.regleNw, 'EUR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- les mouvements ---- */}
      <div className="card">
        <table>
          <thead>
            <tr><th>Date</th><th>Geste</th><th className="r">Montant</th><th>Qui</th><th></th><th></th></tr>
          </thead>
          <tbody>
            {mouvementsTries.slice(0, 30).map((m) => {
              const montant = montantNumerique(m.montant);
              const annule = m.statut === STATUT_ANNULE;
              const taux = m.sens === 'change' ? tauxDuChange(m) : null;
              return (
                <tr key={m.id} style={annule ? { opacity: 0.55, textDecoration: 'line-through' } : undefined}>
                  <td className="tnum">{fmtDate(m.date)}</td>
                  <td>{LIBELLE_SENS[m.sens] || m.type || '—'}{m.lieu === 'compte' ? ' (compte)' : ''}</td>
                  <td className="r tnum">
                    {montant === null ? <span style={{ color: 'var(--warn)' }}>⚠ « {m.montant} »</span> : fmtM(montant, m.devise)}
                    {m.sens === 'change' && (
                      <span className="muted"> → {fmtM(montantNumerique(m.montantContrepartie) ?? 0, m.deviseContrepartie)}{taux ? ` (taux ${taux})` : ''}</span>
                    )}
                  </td>
                  <td>{m.patientId ? nomPatiente(m.patientId) : (m.notes || '').split(' | ')[0].slice(0, 28)}</td>
                  <td>
                    {estSaisieDeMemoire(m) && <span className="badge b-part" title="Saisie après coup — la date du mouvement n'est pas celle de la saisie">de mémoire</span>}
                    {m.statut === 'En attente' && <span className="badge b-part">en attente</span>}
                  </td>
                  <td className="r">
                    {peutSaisir && !annule && m.sens && (
                      <button className="btn btn-ghost btn-sm" title="Annuler (avec trace) — un mouvement ne se supprime pas" onClick={() => setAAnnuler(m)}>
                        <Ico.x size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!data.finances.length && <Empty icon={Ico.euro} title="Aucun mouvement" sub="Le registre finances est vide." />}
      </div>

      {/* ---- saisie ---- */}
      {geste && (
        <Modal title={geste === 'menu' ? 'Que s’est-il passé ?' : geste === 'arrete' ? 'Compter la caisse' : ''}
          onClose={() => setGeste(null)} small>
          {geste === 'menu' && (
            <div style={{ display: 'grid', gap: 10 }}>
              {([['encaisse', 'J’ai encaissé', Ico.euro], ['paye', 'J’ai payé', Ico.send],
                ['change', 'J’ai changé', Ico.copy], ['rendu', 'J’ai rendu', Ico.check]] as const).map(([k, l, I]) => (
                <button key={k} className="btn" style={{ fontSize: 17, padding: '14px 12px', justifyContent: 'flex-start' }} onClick={() => setGeste(k)}>
                  <I size={18} />{l}
                </button>
              ))}
              <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={() => setGeste('arrete')}>
                <Ico.lock size={15} />Compter la caisse (arrêté)
              </button>
            </div>
          )}
          {geste === 'encaisse' && <FormEncaisse patients={patientsTries} onSave={enregistrerMouvement} />}
          {geste === 'paye' && <FormPaye medecins={data.medecins} onSave={enregistrerMouvement} />}
          {geste === 'change' && <FormChange onSave={enregistrerMouvement} />}
          {geste === 'rendu' && <FormRendu onSave={enregistrerMouvement} />}
          {geste === 'arrete' && (
            <FormArrete
              soldes={soldes}
              dejaUnArrete={!!data.arretes.length}
              onDone={() => setGeste(null)}
              onSave={async (a: Partial<Arrete>) => {
                try {
                  await save('arretes', { ...a, par: userLabel(user) }, `a arrêté la caisse ${a.devise} : compté ${a.montantCompte}, calculé ${a.montantCalcule}`);
                  toast('Arrêté enregistré — il devient la base du solde.');
                  return true;
                } catch (e) {
                  toast(e instanceof Error ? e.message : 'Arrêté impossible.', 'err');
                  return false;
                }
              }}
            />
          )}
        </Modal>
      )}

      {aAnnuler && (
        <Confirm
          title="Annuler ce mouvement ?"
          danger
          message={<>Le mouvement restera visible, marqué « Annulé », avec la trace de qui l&apos;annule et quand.
            Il sort des soldes. <b>Rien ne se supprime.</b></>}
          yes="Annuler le mouvement"
          onYes={() => annuler(aAnnuler)}
          onClose={() => setAAnnuler(null)}
        />
      )}
    </>
  );
}

/* ---- les quatre gestes : trois champs, clavier numérique d'abord, date
   « maintenant » par défaut et changée en deux gestes ---- */

type OnSave = (m: Partial<Mouvement>, message: string) => Promise<boolean>;

const base: Partial<Mouvement> = {
  procedure: '', notes: '', methode: 'Espèces', statut: 'Complété',
  montantContrepartie: '', deviseContrepartie: '', patientId: '',
};

function FormEncaisse({ patients, onSave }: { patients: { id?: string }[]; onSave: OnSave }) {
  const [montant, setMontant] = useState('');
  const [patientId, setPatientId] = useState('');
  const [date, setDate] = useState(todayISO());
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <Field label="Montant reçu (€, espèces)">
        <Input autoFocus inputMode="decimal" placeholder="0" value={montant} onChange={(e) => setMontant(e.target.value)} />
      </Field>
      <Field label="De quelle patiente ?">
        <Select value={patientId} onChange={(e) => setPatientId(e.target.value)}>
          <option value="">— (sans patiente)</option>
          {patients.map((p: any) => <option key={p.id} value={p.id}>{patientName(p)}</option>)}
        </Select>
      </Field>
      <Field label="Quand ? (le mouvement, pas la saisie)">
        <Input {...champDate} value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <button className="btn btn-primary" onClick={() => onSave(
        { ...base, sens: 'entree', lieu: 'caisse', type: 'Encaissement', devise: DEVISE_CAISSE, montant, date, patientId },
        `a encaissé ${montant} € en caisse`,
      )}>Enregistrer</button>
    </div>
  );
}

function FormPaye({ medecins, onSave }: { medecins: { id: string; nomAffiche: string }[]; onSave: OnSave }) {
  const [montant, setMontant] = useState('');
  const [aQui, setAQui] = useState('');
  const [autre, setAutre] = useState('');
  /* ⚠ Zeynalov est payé en euros, les autres en livres — proposé depuis la
     référence, jamais depuis un nom ; et toujours modifiable. */
  const [devise, setDevise] = useState(DEVISE_CHANGE);
  const [date, setDate] = useState(todayISO());
  const choisir = (id: string) => {
    setAQui(id);
    if (id && id !== 'autre') setDevise(devisePourPaiementChirurgien(id));
  };
  const medecin = medecins.find((m) => m.id === aQui);
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <Field label="Montant payé">
        <div style={{ display: 'flex', gap: 8 }}>
          <Input autoFocus inputMode="decimal" placeholder="0" style={{ flex: 1 }} value={montant} onChange={(e) => setMontant(e.target.value)} />
          <Select value={devise} onChange={(e) => setDevise(e.target.value)} style={{ width: 84 }}>
            <option value="TRY">TL</option>
            <option value="EUR">€</option>
          </Select>
        </div>
      </Field>
      <Field label="À qui ?">
        <Select value={aQui} onChange={(e) => choisir(e.target.value)}>
          <option value="">—</option>
          {medecins.map((m) => <option key={m.id} value={m.id}>{m.nomAffiche}</option>)}
          <option value="autre">Autre…</option>
        </Select>
      </Field>
      {aQui === 'autre' && (
        <Field label="Préciser">
          <Input value={autre} onChange={(e) => setAutre(e.target.value)} placeholder="Commission, fournisseur…" />
        </Field>
      )}
      <Field label="Quand ?">
        <Input {...champDate} value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <button className="btn btn-primary" onClick={() => onSave(
        {
          ...base,
          sens: 'sortie', lieu: 'caisse', devise, montant, date, statut: 'Payé',
          type: medecin ? 'Paiement chirurgien' : 'Sortie caisse',
          notes: medecin ? medecin.nomAffiche : autre,
        },
        `a payé ${montant} ${devise === 'EUR' ? '€' : 'TL'} — ${medecin ? medecin.nomAffiche : autre || 'sortie de caisse'}`,
      )}>Enregistrer</button>
    </div>
  );
}

function FormChange({ onSave }: { onSave: OnSave }) {
  const [sortie, setSortie] = useState('');
  const [obtenu, setObtenu] = useState('');
  const [date, setDate] = useState(todayISO());
  const taux = tauxDuChange({ montant: sortie, montantContrepartie: obtenu });
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <Field label="Euros donnés au bureau de change">
        <Input autoFocus inputMode="decimal" placeholder="0" value={sortie} onChange={(e) => setSortie(e.target.value)} />
      </Field>
      <Field label="Livres reçues (TL)">
        <Input inputMode="decimal" placeholder="0" value={obtenu} onChange={(e) => setObtenu(e.target.value)} />
      </Field>
      <Field label="Quand ?">
        <Input {...champDate} value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <p className="muted" style={{ fontSize: 11.5, margin: 0 }}>
        {taux ? <>Taux du bureau : <b>{taux}</b> TL/€ — calculé, jamais stocké.</> : 'Le taux s’affichera — il se calcule, il ne se saisit pas.'}
      </p>
      <button className="btn btn-primary" onClick={() => onSave(
        {
          ...base,
          sens: 'change', lieu: 'caisse', type: 'Change', devise: DEVISE_CAISSE, montant: sortie, date,
          montantContrepartie: obtenu, deviseContrepartie: DEVISE_CHANGE,
        },
        `a changé ${sortie} € en ${obtenu} TL`,
      )}>Enregistrer</button>
    </div>
  );
}

function FormRendu({ onSave }: { onSave: OnSave }) {
  const [montant, setMontant] = useState('');
  const [date, setDate] = useState(todayISO());
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <Field label="Euros rendus à la société">
        <Input autoFocus inputMode="decimal" placeholder="0" value={montant} onChange={(e) => setMontant(e.target.value)} />
      </Field>
      <Field label="Quand ?">
        <Input {...champDate} value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <button className="btn btn-primary" onClick={() => onSave(
        { ...base, sens: 'remise', lieu: 'caisse', type: 'Remise société', devise: DEVISE_CAISSE, montant, date },
        `a rendu ${montant} € à la société`,
      )}>Enregistrer</button>
    </div>
  );
}

/* L'arrêté : le COMPTAGE PHYSIQUE. Le solde calculé s'affiche, l'écart aussi —
   et c'est l'écart, pas le solde, qui mérite l'attention. Le premier arrêté
   est le solde d'ouverture : il vient d'un comptage réel de Ceyda, à une date
   écrite — jamais d'une reprise, jamais d'une estimation. */
function FormArrete({ soldes, dejaUnArrete, onSave, onDone }: {
  soldes: { devise: string; solde: number }[];
  dejaUnArrete: boolean;
  onSave: (a: Partial<Arrete>) => Promise<boolean>;
  onDone: () => void;
}) {
  const [devise, setDevise] = useState(DEVISE_CAISSE);
  const [compte, setCompte] = useState('');
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState('');
  const calcule = soldes.find((s) => s.devise === devise)?.solde ?? 0;
  const compteNum = montantNumerique(compte);
  const ecart = compteNum === null ? null : Math.round((compteNum - calcule) * 100) / 100;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {!dejaUnArrete && (
        <p style={{ fontSize: 12.5, lineHeight: 1.6, margin: 0, color: 'var(--warn)' }}>
          ⚠ Premier arrêté = <b>solde d&apos;ouverture</b>. Un solde d&apos;ouverture faux rend faux tout ce qui suit,
          définitivement. Comptez physiquement, à la date du comptage. Un arrêté vaut <b>fin de journée</b>.
        </p>
      )}
      <Field label="Devise comptée">
        <Select value={devise} onChange={(e) => setDevise(e.target.value)}>
          <option value="EUR">Euros</option>
          <option value="TRY">Livres (TL)</option>
        </Select>
      </Field>
      <Field label="Montant compté (physique)">
        <Input autoFocus inputMode="decimal" placeholder="0" value={compte} onChange={(e) => setCompte(e.target.value)} />
      </Field>
      <Field label="Date du comptage">
        <Input {...champDate} value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field label="Notes">
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="(facultatif)" />
      </Field>
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        Calculé : <b>{fmtM(calcule, devise)}</b>
        {ecart !== null && <> · Écart : <b style={{ color: Math.abs(ecart) >= 0.01 ? 'var(--warn)' : 'var(--ok)' }}>{fmtM(ecart, devise)}</b></>}
      </p>
      <button className="btn btn-primary" disabled={compteNum === null} onClick={async () => {
        if (compteNum === null) return;
        const ok = await onSave({ date, devise, montantCompte: compteNum, montantCalcule: calcule, ecart: ecart ?? 0, notes });
        if (ok) onDone();
      }}>Enregistrer l&apos;arrêté</button>
    </div>
  );
}
