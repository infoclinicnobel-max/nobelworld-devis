/*** =====================================================================
 *  Clinic NobelWorld — Backend Devis & Factures (Google Apps Script)
 *  À coller dans l'éditeur Apps Script d'un Google Sheet dédié.
 *  Déploiement : Déployer > Nouveau déploiement > Application Web
 *    - Exécuter en tant que : Moi
 *    - Accès : Tout le monde
 *  Puis copier l'URL /exec dans devis.html (CONFIG.APPS_SCRIPT_URL).
 *  ===================================================================== */

var SECRET = 'Veysjayjaydidim34??'; // clé secrète de TON déploiement — ne pas changer

// Schéma : champs "plats" lisibles dans le Sheet. Le reste va dans extra_json.
var SCHEMA = {
  patients:     ['id','prenom','nom','telephone','whatsapp','email','pays','ville','naissance','commentaires','createdBy','createdAt','updatedAt'],
  devis:        ['id','numero','patientId','date','validite','dateIntervention','chirurgien','hopital','statut','acompte','createdBy','createdAt','updatedAt'],
  factures:     ['id','numero','numeroDevis','devisId','patientId','date','validite','statut','createdBy','createdAt','updatedAt'],
  paiements:    ['id','refId','refNum','montant','date','mode','createdAt','updatedAt'],
  modeles:      ['id','nom','categorie','prixBase','description','createdAt','updatedAt'],
  options:      ['id','nom','prix','createdAt','updatedAt'],
  historique:   ['id','date','user','message'],
  utilisateurs: ['id','prenom','nom','email','telephone','fonction','role','statut','pwd','salt','createdAt','lastLogin'],
};
var DELETE_ROLES = { devis:['pdg'], factures:['pdg'], patients:['pdg'] }; // qui peut supprimer

/* ---------- Entrée HTTP ---------- */
function doPost(e){
  try{
    var body = JSON.parse(e.postData.contents);
    var action = body.action;
    var out;
    if(action==='login')            out = apiLogin(body);
    else if(action==='authState')   out = apiAuthState();
    else if(action==='bootstrapAdmin') out = apiBootstrapAdmin(body);
    else if(action==='bootstrap')   out = (checkToken(body.token), apiBootstrap());
    else if(action==='save')        out = (checkToken(body.token), apiSave(body));
    else if(action==='remove')      out = apiRemove(body);
    else if(action==='nextNumber')  out = (checkToken(body.token), apiNextNumber(body));
    else if(action==='saveSettings')out = (checkToken(body.token), apiSaveSettings(body));
    else if(action==='setPassword') out = apiSetPassword(body);
    else if(action==='userSave')    out = (checkToken(body.token), apiUserSave(body));
    else if(action==='userDelete')  out = (checkToken(body.token), apiUserDelete(body));
    else throw new Error('Action inconnue : '+action);
    return json(Object.assign({ok:true}, out));
  }catch(err){
    return json({ok:false, error:String(err.message||err)});
  }
}
function doGet(){ return json({ok:true, message:'Clinic NobelWorld API en ligne.'}); }
function json(o){ return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/* ---------- Sécurité ---------- */
function sha256(s){
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  return raw.map(function(b){ b=(b<0?b+256:b).toString(16); return b.length==1?'0'+b:b; }).join('');
}
function signToken(payload){
  var data = Utilities.base64EncodeWebSafe(JSON.stringify(payload));
  var sig  = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(data, SECRET));
  return data+'.'+sig;
}
function checkToken(token){
  if(!token) throw new Error('Session requise');
  var parts = String(token).split('.');
  if(parts.length!==2) throw new Error('Session invalide');
  var expected = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(parts[0], SECRET));
  if(expected!==parts[1]) throw new Error('Session invalide');
  var p = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString());
  if(p.exp && Date.now()>p.exp) throw new Error('Session expirée, reconnectez-vous');
  return p; // {id,email,role,exp}
}
function makeSalt(){ return Utilities.getUuid().replace(/-/g,'').substring(0,16); }
function hashPwd(pwd,salt){ return sha256((salt||'')+':'+pwd); }
function checkPwd(u,pwd){ if(u.salt) return hashPwd(pwd,u.salt)===String(u.pwd); return sha256(pwd)===String(u.pwd); }
function sanitizeUser(u){ return {id:u.id, prenom:u.prenom||'', nom:u.nom||'', email:u.email, telephone:u.telephone||'',
  fonction:u.fonction||'', role:u.role, statut:u.statut||'actif', photo:u.photo||'', perms:u.perms||{},
  createdAt:u.createdAt||'', lastLogin:u.lastLogin||''}; }
function findUserById(id){ var us=readAll('utilisateurs'); for(var i=0;i<us.length;i++){ if(String(us[i].id)===String(id)) return us[i]; } return null; }
function isActorAdmin(p){ if(p.role==='pdg') return true; var a=findUserById(p.id); return !!(a && (a.role==='pdg' || (a.perms&&a.perms.usersManage))); }

/* ---------- Feuilles ---------- */
function ss(){ return SpreadsheetApp.getActiveSpreadsheet(); }
function sheet(name){
  var s = ss().getSheetByName(name);
  if(!s){ s = ss().insertSheet(name); s.appendRow(SCHEMA[name].concat(['extra_json'])); }
  return s;
}
function readAll(name){
  var s = sheet(name); var v = s.getDataRange().getValues();
  if(v.length<2) return [];
  var head = v[0]; var rows = [];
  for(var i=1;i<v.length;i++){
    var o = {}; var extra = {};
    for(var c=0;c<head.length;c++){
      var key = head[c];
      if(key==='extra_json'){ try{ extra = JSON.parse(v[i][c]||'{}'); }catch(e){} }
      else o[key] = v[i][c];
    }
    o = Object.assign(o, extra);
    if(o.id!=='' && o.id!=null) rows.push(o);
  }
  return rows;
}
function upsert(name, record){
  var s = sheet(name); var fields = SCHEMA[name]; var head = fields.concat(['extra_json']);
  var data = s.getDataRange().getValues();
  // extra = tout ce qui n'est pas un champ plat
  var extra = {}; for(var k in record){ if(fields.indexOf(k)<0 && k!=='extra_json') extra[k]=record[k]; }
  var row = fields.map(function(f){ return record[f]!=null ? record[f] : ''; });
  row.push(JSON.stringify(extra));
  // recherche par id
  for(var i=1;i<data.length;i++){
    if(String(data[i][0])===String(record.id)){ s.getRange(i+1,1,1,head.length).setValues([row]); return; }
  }
  s.appendRow(row);
}
function deleteById(name, id){
  var s = sheet(name); var data = s.getDataRange().getValues();
  for(var i=data.length-1;i>=1;i--){ if(String(data[i][0])===String(id)) s.deleteRow(i+1); }
}

/* ---------- Actions ---------- */
function apiLogin(body){
  ensureSetup();
  var users = readAll('utilisateurs');
  var email = String(body.email||'').toLowerCase().trim();
  var u = null;
  for(var i=0;i<users.length;i++){ if(String(users[i].email).toLowerCase()===email){ u=users[i]; break; } }
  if(!u) throw new Error('Identifiant inconnu');
  if(u.statut==='desactive') throw new Error('Compte désactivé. Contactez l\'administrateur.');
  if(!checkPwd(u, body.password)) throw new Error('Mot de passe incorrect');
  u.lastLogin = new Date().toISOString(); upsert('utilisateurs', u);
  var token = signToken({id:u.id, email:u.email, role:u.role, exp:Date.now()+1000*60*60*12}); // 12 h
  return {token:token, user:sanitizeUser(u)};
}
function apiAuthState(){ ensureSetup(); return {hasUsers: readAll('utilisateurs').length>0}; }
function apiBootstrapAdmin(body){
  ensureSetup();
  if(readAll('utilisateurs').length>0) throw new Error('Configuration déjà effectuée');
  if(!body.email||!body.password) throw new Error('Email et mot de passe requis');
  var salt=makeSalt();
  var u={id:'u_'+Date.now().toString(36), prenom:body.prenom||'', nom:body.nom||'',
    email:String(body.email).toLowerCase().trim(), telephone:body.telephone||'', fonction:body.fonction||'Administrateur',
    role:'pdg', statut:'actif', photo:body.photo||'', perms:{}, salt:salt, pwd:hashPwd(body.password,salt),
    createdAt:new Date().toISOString(), lastLogin:new Date().toISOString()};
  upsert('utilisateurs', u);
  var token=signToken({id:u.id, email:u.email, role:u.role, exp:Date.now()+1000*60*60*12});
  return {token:token, user:sanitizeUser(u)};
}
function apiUserSave(body){
  var p=checkToken(body.token);
  if(!isActorAdmin(p)) throw new Error('Réservé à l\'administrateur');
  var email=String(body.email||'').toLowerCase().trim();
  if(!email) throw new Error('Email requis');
  var users=readAll('utilisateurs');
  for(var i=0;i<users.length;i++){ if(String(users[i].id)!==String(body.id) && String(users[i].email).toLowerCase()===email) throw new Error('Cet email est déjà utilisé'); }
  var u=findUserById(body.id);
  if(!u){ u={id:'u_'+Date.now().toString(36)+Math.random().toString(36).slice(2,5), createdAt:new Date().toISOString(), lastLogin:''}; }
  u.prenom=body.prenom||''; u.nom=body.nom||''; u.email=email; u.telephone=body.telephone||'';
  u.fonction=body.fonction||''; u.role=body.role||'commerciale'; u.statut=body.statut||'actif';
  u.photo=body.photo||''; u.perms=body.perms||{};
  if(body.password){ u.salt=makeSalt(); u.pwd=hashPwd(body.password,u.salt); }
  if(!u.pwd) throw new Error('Mot de passe requis pour un nouvel utilisateur');
  upsert('utilisateurs', u);
  return {user:sanitizeUser(u)};
}
function apiUserDelete(body){
  var p=checkToken(body.token);
  if(!isActorAdmin(p)) throw new Error('Réservé à l\'administrateur');
  if(String(body.id)===String(p.id)) throw new Error('Vous ne pouvez pas supprimer votre propre compte');
  var users=readAll('utilisateurs'); var target=null;
  users.forEach(function(u){ if(String(u.id)===String(body.id)) target=u; });
  if(target && target.role==='pdg'){
    var admins=users.filter(function(u){ return u.role==='pdg' && u.statut!=='desactive'; });
    if(admins.length<=1) throw new Error('Impossible de supprimer le dernier administrateur');
  }
  deleteById('utilisateurs', body.id);
  return {};
}
function apiBootstrap(){
  ensureSetup();
  var out = {};
  ['patients','devis','factures','paiements','modeles','options','historique'].forEach(function(c){ out[c]=readAll(c); });
  out.utilisateurs = readAll('utilisateurs').map(sanitizeUser);
  out.parametres = getSettings();
  return out;
}
function apiSave(body){
  if(body.collection==='utilisateurs') throw new Error('Utilisez la gestion des utilisateurs');
  var rec = body.record || {};
  if(!rec.id){ rec.id = body.collection.slice(0,3)+'_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6); rec.createdAt = new Date().toISOString(); }
  rec.updatedAt = new Date().toISOString();
  upsert(body.collection, rec);
  return {record:rec};
}
function apiRemove(body){
  var p = checkToken(body.token);
  var allowed = DELETE_ROLES[body.collection];
  if(allowed && allowed.indexOf(p.role)<0) throw new Error('Action non autorisée pour votre rôle');
  deleteById(body.collection, body.id);
  return {};
}
function apiNextNumber(body){
  var prop = PropertiesService.getScriptProperties();
  var year = new Date().getFullYear();
  var key = 'seq_'+body.type+'_'+year;
  var n = parseInt(prop.getProperty(key)||'0',10)+1;
  prop.setProperty(key, String(n));
  var prefix = body.type==='devis'?'D':'F';
  return {numero: prefix+'-'+year+'-'+('000000'+n).slice(-6)};
}
function getSettings(){
  var raw = PropertiesService.getScriptProperties().getProperty('parametres');
  return raw ? JSON.parse(raw) : DEFAULT_SETTINGS();
}
function apiSaveSettings(body){
  PropertiesService.getScriptProperties().setProperty('parametres', JSON.stringify(body.parametres));
  return {};
}
function apiSetPassword(body){
  var p=null;
  if(body.token){ p=checkToken(body.token); if(!isActorAdmin(p) && p.email!==String(body.email).toLowerCase().trim()) throw new Error('Non autorisé'); }
  var users=readAll('utilisateurs'); var u=null; var em=String(body.email||'').toLowerCase().trim();
  for(var i=0;i<users.length;i++){ if(String(users[i].email).toLowerCase()===em){ u=users[i]; break; } }
  if(!u) throw new Error('Utilisateur introuvable');
  u.salt=makeSalt(); u.pwd=hashPwd(body.newPwd,u.salt);
  upsert('utilisateurs', u);
  return {};
}

/* ---------- Initialisation ---------- */
function DEFAULT_SETTINGS(){
  return {company:'Clinic NobelWorld', tagline:'Tourisme médical · Istanbul',
    address:'Avrasya Hastanesi — Istanbul, Türkiye', phone:'+90 ___ ___ __ __',
    whatsapp:'+90 ___ ___ __ __', email:'contact@clinicnobel.world', website:'www.clinicnobel.world',
    iban:'TR00 0000 0000 0000 0000 0000 00', bic:'XXXXXXXX', vat:'', logo:'', currency:'€', docTitle:'DEVIS MÉDICAL PREMIUM',
    cgv:"Le présent devis est valable 30 jours. Un acompte confirme la réservation de la date opératoire. Le solde est réglé avant l'intervention. Les tarifs incluent uniquement les prestations listées.",
    important:"Le patient s'engage à fournir un bilan médical complet et à signaler tout traitement en cours. Les dates d'intervention sont confirmées après réception de l'acompte. En cas d'annulation à moins de 7 jours, l'acompte reste acquis. Les résultats peuvent varier d'un patient à l'autre ; aucun résultat n'est garanti. Un suivi post-opératoire est requis.",
    legal:"Clinic NobelWorld — Tourisme médical. Document non contractuel à valeur d'estimation."};
}
function ensureSetup(){
  if(PropertiesService.getScriptProperties().getProperty('setup_done')==='1') return;
  Object.keys(SCHEMA).forEach(function(n){ sheet(n); });
  // Aucun utilisateur de démonstration : le compte administrateur est créé au 1er démarrage de l'app.
  // modèles + options de départ
  var modeles = [
    {id:'m_bbl',nom:'SAFE BBL',categorie:'Chirurgie esthétique',prixBase:4500,description:'Brazilian Butt Lift avec liposuccion 360°.',inc:['Bilan préopératoire','2 nuits hospitalisation','Corset + BBL Pillow','Suivi post-opératoire'],exc:['Vols internationaux','Nuits hôtel supplémentaires']},
    {id:'m_mommy',nom:'Mommy Makeover',categorie:'Chirurgie esthétique',prixBase:6900,description:'Abdominoplastie + chirurgie mammaire.',inc:['Bilan complet','3 nuits hospitalisation','Bas de contention'],exc:['Vols internationaux']},
    {id:'m_vaser',nom:'Liposuccion VASER HD',categorie:'Chirurgie esthétique',prixBase:3800,description:'Liposuccion haute définition.',inc:['1 nuit hospitalisation','Corset médical','2 massages lymphatiques'],exc:['Zones supplémentaires']},
    {id:'m_hollywood',nom:'Hollywood Smile',categorie:'Chirurgie dentaire',prixBase:3500,description:'Facettes céramique E-max.',inc:['Empreintes','Pose facettes','Photos avant/après'],exc:['Soins parodontaux']},
    {id:'m_allon4',nom:'All-on-4',categorie:'Chirurgie dentaire',prixBase:4800,description:'Réhabilitation complète sur 4 implants.',inc:['Scanner 3D','4 implants','Prothèse définitive'],exc:['Greffe osseuse']},
    {id:'m_greffe',nom:'Greffe capillaire',categorie:'Greffe capillaire',prixBase:1900,description:'Greffe FUE/DHI jusqu\'à 4000 greffons.',inc:['Analyse capillaire','Kit post-greffe','PRP'],exc:['Greffe barbe']}
  ];
  modeles.forEach(function(m){ upsert('modeles', m); });
  var options = [['Hôtel 4★ (par nuit)',90],['Transferts VIP',120],['Accompagnant',250],['Corset médical',60],
    ['Bas de contention',45],['BBL Pillow',35],['Massage lymphatique (séance)',40],['Lipofilling',700]];
  options.forEach(function(o,i){ upsert('options', {id:'o'+(i+1), nom:o[0], prix:o[1]}); });
  PropertiesService.getScriptProperties().setProperty('parametres', JSON.stringify(DEFAULT_SETTINGS()));
  PropertiesService.getScriptProperties().setProperty('setup_done','1');
}
/* Lancez cette fonction une fois manuellement pour (ré)initialiser : */
function initialiser(){ PropertiesService.getScriptProperties().deleteProperty('setup_done'); ensureSetup(); }

/* MIGRATION — à lancer UNE fois après mise à jour :
   supprime la feuille "utilisateurs" (ancienne structure + comptes de démo)
   et la recrée vide avec le nouvel en-tête. L'app vous proposera alors de
   créer votre compte administrateur au prochain chargement (après déconnexion). */
function reinitialiserUtilisateurs(){
  var s = ss().getSheetByName('utilisateurs');
  if(s) ss().deleteSheet(s);
  sheet('utilisateurs');
  return 'Feuille utilisateurs réinitialisée. Déconnectez-vous puis créez votre compte administrateur.';
}
