/**
 * app.js — Lógica principal CNR Seguimiento PWA
 * IndexedDB · Exportación JSON/CSV · Google Drive OAuth2
 * v2.0 — Fechas ISO, rutas relativas fotos, exportar todos, indicador modificación
 */

'use strict';

/* ══════════════════════════════════════════════════════════
   CONFIGURACIÓN
   ══════════════════════════════════════════════════════════ */
const CONFIG = {
  GOOGLE_CLIENT_ID:  '353831203919-9uf4jmk8he5df4dvvpdoq0dle1jmeiju.apps.googleusercontent.com',
  DRIVE_FOLDER_NAME: 'CNR_Seguimiento',
  DB_NAME:           'cnr_seguimiento',
  DB_VERSION:        1,
  STORE_NAME:        'registros',
  TIPO_FICHA:        'Seguimiento CNR',
};

/* ══════════════════════════════════════════════════════════
   ESTADO GLOBAL
   ══════════════════════════════════════════════════════════ */
const State = {
  db:            null,
  currentRecord: null,
  records:       [],
  isOnline:      navigator.onLine,
  isSyncing:     false,
  driveToken:    null,
  installPrompt: null,
};

/* ══════════════════════════════════════════════════════════
   MODELO DE DATOS
   ══════════════════════════════════════════════════════════ */
function createEmptyRecord() {
  const today = dateToISO(new Date());
  return {
    _id:                     crypto.randomUUID(),
    _created:                new Date().toISOString(),
    _modified:               new Date().toISOString(),
    _modified_count:         0,
    _synced:                 false,
    _syncedAt:               null,
    tipo_ficha:              CONFIG.TIPO_FICHA,

    codigo_proyecto:         '',
    nro_concurso:            '',
    fecha_recepcion:         '',
    beneficiario:            '',
    predio:                  '',
    roles_avaluo:            '',
    comuna:                  '',
    provincia:               '',
    region:                  'Ñuble',
    utm_este:                '',
    utm_norte:               '',
    utm_datum:               'WGS 84',
    utm_huso:                '19',
    fecha_pago:              '',
    nro_bono:                '',
    fecha_visita:            today,

    cultivo_inicial:         '',
    cultivo_actual:          '',

    antecedentes:            [''],
    observaciones_tecnicas:  '',
    tiempo_funcionamiento:   '',
    observaciones_generales: [''],
    cumple_objetivo:         '',

    fotos:                   [],
  };
}

/* ══════════════════════════════════════════════════════════
   UTILIDADES DE FECHA
   Internamente: AAAA-MM-DD · Formulario: DD/MM/AAAA
   ══════════════════════════════════════════════════════════ */
function dateToISO(d) {
  if (!d || isNaN(d)) return '';
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function displayToISO(str) {
  if (!str) return '';
  const p = str.split('/');
  if (p.length !== 3 || p[2].length !== 4) return str;
  return `${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`;
}

function isoToDisplay(str) {
  if (!str) return '';
  const p = str.split('-');
  if (p.length !== 3) return str;
  return `${p[2]}/${p[1]}/${p[0]}`;
}

/* ══════════════════════════════════════════════════════════
   INDEXEDDB
   ══════════════════════════════════════════════════════════ */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(CONFIG.STORE_NAME)) {
        const store = db.createObjectStore(CONFIG.STORE_NAME, { keyPath: '_id' });
        store.createIndex('codigo_proyecto', 'codigo_proyecto', { unique: false });
        store.createIndex('beneficiario',    'beneficiario',    { unique: false });
        store.createIndex('_synced',         '_synced',         { unique: false });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

function dbGetAll() {
  return new Promise((resolve, reject) => {
    const tx  = State.db.transaction(CONFIG.STORE_NAME, 'readonly');
    const req = tx.objectStore(CONFIG.STORE_NAME).getAll();
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

function dbPut(record) {
  return new Promise((resolve, reject) => {
    const tx  = State.db.transaction(CONFIG.STORE_NAME, 'readwrite');
    const req = tx.objectStore(CONFIG.STORE_NAME).put(record);
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });
}

/* ══════════════════════════════════════════════════════════
   GUARDAR / CARGAR REGISTROS
   ══════════════════════════════════════════════════════════ */
async function saveCurrentRecord() {
  if (!State.currentRecord) return;
  const isFirstSave = State.currentRecord._modified_count === 0;
  collectFormValues();
  State.currentRecord._modified       = new Date().toISOString();
  State.currentRecord._modified_count = (State.currentRecord._modified_count || 0) + 1;
  State.currentRecord._synced         = false;
  await dbPut(State.currentRecord);
  State.records = await dbGetAll();
  renderRecordsList();
  if (State.isOnline) triggerSync();

  // Mostrar modal post-guardado solo en primera vez
  if (isFirstSave) {
    showPostSaveModal();
  } else {
    showToast('Ficha actualizada ✓', 'success');
  }
}

function showPostSaveModal() {
  const modal = document.getElementById('modal-post-save');
  if (modal) modal.classList.add('open');
}

function hidePostSaveModal() {
  const modal = document.getElementById('modal-post-save');
  if (modal) modal.classList.remove('open');
}

function collectFormValues() {
  const r = State.currentRecord;
  const simpleFields = [
    'codigo_proyecto','nro_concurso','beneficiario',
    'predio','roles_avaluo','region',
    'utm_este','utm_norte','utm_datum','utm_huso',
    'nro_bono','cultivo_inicial','cultivo_actual',
    'observaciones_tecnicas','tiempo_funcionamiento',
  ];
  simpleFields.forEach(field => {
    const el = document.getElementById(`f_${field}`);
    if (el) r[field] = el.value.trim();
  });

  const provEl = document.getElementById('f_provincia');
  const comEl  = document.getElementById('f_comuna');
  if (provEl) r.provincia = provEl.value;
  if (comEl)  r.comuna    = comEl.value;

  ['fecha_recepcion','fecha_visita','fecha_pago'].forEach(field => {
    const el = document.getElementById(`f_${field}`);
    if (el) r[field] = displayToISO(el.value.trim());
  });

  const cumpleChecked = document.querySelector('input[name="cumple_objetivo"]:checked');
  r.cumple_objetivo = cumpleChecked ? cumpleChecked.value : '';

  r.antecedentes            = collectDynamicList('antecedentes-list');
  r.observaciones_generales = collectDynamicList('obs-generales-list');
}

function collectDynamicList(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return [''];
  const vals = Array.from(container.querySelectorAll('textarea'))
    .map(ta => ta.value.trim()).filter(v => v.length > 0);
  return vals.length ? vals : [''];
}

function loadRecordToForm(record) {
  State.currentRecord = JSON.parse(JSON.stringify(record));

  const simpleFields = [
    'codigo_proyecto','nro_concurso','beneficiario',
    'predio','roles_avaluo','region',
    'utm_este','utm_norte','utm_datum','utm_huso',
    'nro_bono','cultivo_inicial','cultivo_actual',
    'observaciones_tecnicas','tiempo_funcionamiento',
  ];
  simpleFields.forEach(field => {
    const el = document.getElementById(`f_${field}`);
    if (el) el.value = record[field] || '';
  });

  ['fecha_recepcion','fecha_visita','fecha_pago'].forEach(field => {
    const el = document.getElementById(`f_${field}`);
    if (el) el.value = isoToDisplay(record[field] || '');
  });

  const provEl = document.getElementById('f_provincia');
  if (provEl && record.provincia) {
    provEl.value = record.provincia;
    if (window.updateComunas) window.updateComunas(record.provincia);
  }
  setTimeout(() => {
    const comEl = document.getElementById('f_comuna');
    if (comEl && record.comuna) comEl.value = record.comuna;
  }, 60);

  const cumpleInput = document.querySelector(`input[name="cumple_objetivo"][value="${record.cumple_objetivo}"]`);
  if (cumpleInput) { cumpleInput.checked = true; updateCumpleVisual(record.cumple_objetivo); }
  else document.querySelectorAll('.cumple-option').forEach(o => o.classList.remove('selected'));

  renderDynamicList('antecedentes-list',   record.antecedentes || ['']);
  renderDynamicList('obs-generales-list',  record.observaciones_generales || ['']);
  renderPhotos();

  const idDisplay = document.getElementById('record-id-display');
  if (idDisplay) {
    const modCount = record._modified_count || 0;
    const modLabel = modCount > 1
      ? `<span class="mod-indicator">✱ Modificado ${modCount - 1}x · ${formatDateShort(record._modified)}</span>`
      : '';
    const syncLabel = record._synced ? '✓ Sync' : '⏳ Pendiente';
    idDisplay.innerHTML = `<span style="opacity:.6">ID: ${record._id.split('-')[0]}</span> ${modLabel} <span>${syncLabel}</span>`;
  }

  document.getElementById('no-record-msg').style.display = 'none';
   // Actualizar etiqueta del botón descartar/cerrar
  const discardLabel = document.getElementById('discard-btn-label');
  if (discardLabel) {
    discardLabel.textContent = (record._modified_count === 0) ? 'Descartar' : 'Cerrar';
  }
  document.getElementById('form-wrapper').style.display  = 'flex';
}

/* ══════════════════════════════════════════════════════════
   LISTAS DINÁMICAS
   ══════════════════════════════════════════════════════════ */
function renderDynamicList(containerId, items) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  (items.length ? items : ['']).forEach((text, i) => addDynamicItem(container, text, i + 1));
}

function addDynamicItem(container, text = '', number = null) {
  const itemNum = number || container.querySelectorAll('.dynamic-item').length + 1;
  const div     = document.createElement('div');
  div.className = 'dynamic-item';
  div.innerHTML = `
    <div class="item-number">${itemNum}</div>
    <textarea placeholder="Escriba aquí...">${escapeHtml(text)}</textarea>
    <button class="item-remove" title="Eliminar ítem">✕</button>
  `;
  div.querySelector('.item-remove').addEventListener('click', () => {
    div.remove();
    container.querySelectorAll('.item-number').forEach((el, i) => { el.textContent = i + 1; });
  });
  container.appendChild(div);
}

/* ══════════════════════════════════════════════════════════
   FOTOS
   ══════════════════════════════════════════════════════════ */
function renderPhotos() {
  const container = document.getElementById('photos-grid');
  const photos    = State.currentRecord?.fotos || [];
  const counter   = document.getElementById('photo-counter');
  if (counter) counter.textContent = `${photos.length} / ${CameraModule.MAX_PHOTOS} fotos`;
  CameraModule.renderPhotoGrid(photos, container,
    (id) => { State.currentRecord.fotos = State.currentRecord.fotos.filter(f => f.id !== id); renderPhotos(); },
    (id, caption) => { const f = State.currentRecord.fotos.find(f => f.id === id); if (f) f.caption = caption; }
  );
}

function addPhoto(photoObj) {
  if (!State.currentRecord) return;
  State.currentRecord.fotos = State.currentRecord.fotos || [];
  State.currentRecord.fotos.push(photoObj);
  renderPhotos();
  showToast(`Foto agregada (${Math.round(photoObj.sizeKB)} KB)`, 'success');
}

/* ══════════════════════════════════════════════════════════
   GEOLOCALIZACIÓN Y UTM
   ══════════════════════════════════════════════════════════ */
function getGeoLocation() {
  if (!navigator.geolocation) { showToast('GPS no disponible', 'error'); return; }
  showToast('Obteniendo ubicación GPS…', 'info');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { easting, northing } = latLonToUTM(pos.coords.latitude, pos.coords.longitude);
      document.getElementById('f_utm_este').value  = easting.toFixed(0);
      document.getElementById('f_utm_norte').value = northing.toFixed(0);
      if (State.currentRecord) {
        State.currentRecord.utm_este  = easting.toFixed(0);
        State.currentRecord.utm_norte = northing.toFixed(0);
      }
      showToast('Coordenadas GPS obtenidas ✓', 'success');
    },
    (err) => { showToast('No se pudo obtener la ubicación', 'error'); console.error(err); },
    { enableHighAccuracy: true, timeout: 15000 }
  );
}

function latLonToUTM(lat, lon) {
  const a=6378137.0, f=1/298.257223563, b=a*(1-f), e2=1-(b*b)/(a*a), k0=0.9996;
  const latR=(lat*Math.PI)/180, lonR=(lon*Math.PI)/180, lon0R=(-69*Math.PI)/180;
  const N=a/Math.sqrt(1-e2*Math.sin(latR)**2), T=Math.tan(latR)**2;
  const C=(e2/(1-e2))*Math.cos(latR)**2, A=Math.cos(latR)*(lonR-lon0R);
  const e4=e2*e2, e6=e4*e2;
  const M=a*((1-e2/4-3*e4/64-5*e6/256)*latR-(3*e2/8+3*e4/32+45*e6/1024)*Math.sin(2*latR)+(15*e4/256+45*e6/1024)*Math.sin(4*latR)-(35*e6/3072)*Math.sin(6*latR));
  const easting=k0*N*(A+(1-T+C)*A**3/6+(5-18*T+T**2+72*C-58*(e2/(1-e2)))*A**5/120)+500000;
  let northing=k0*(M+N*Math.tan(latR)*(A**2/2+(5-T+9*C+4*C**2)*A**4/24+(61-58*T+T**2+600*C-330*(e2/(1-e2)))*A**6/720));
  if (lat<0) northing+=10000000;
  return { easting, northing };
}

/* ══════════════════════════════════════════════════════════
   CONSTRUCCIÓN CSV
   ══════════════════════════════════════════════════════════ */
function csvHeaders() {
  return [
    'Tipo Ficha',
    'Código Proyecto','N° Concurso','Fecha Recepción Técnica',
    'Beneficiario','Predio','Rol(es) de Avalúo',
    'Comuna','Provincia','Región',
    'UTM Este','UTM Norte','UTM Datum','UTM Huso',
    'Fecha de Pago','N° Bono','Fecha de Visita',
    'Cultivo Inicial','Cultivo Actual',
    'Antecedentes','Observaciones Técnicas',
    'Tiempo Funcionamiento Obra (años)',
    'Observaciones Generales','Cumple con el Objetivo',
    'Ruta Foto 1','Pie de Foto 1',
    'Ruta Foto 2','Pie de Foto 2',
    'Ruta Foto 3','Pie de Foto 3',
    'Ruta Foto 4','Pie de Foto 4',
    'Ruta Foto 5','Pie de Foto 5',
    'ID Registro','Fecha Creación','Fecha Modificación',
    'Veces Modificado','Sincronizado',
  ];
}

function recordToRow(r) {
  const codigo = r.codigo_proyecto || r._id.split('-')[0];
  const fCols  = [];
  for (let i = 0; i < 5; i++) {
    const f = (r.fotos || [])[i];
    fCols.push(f ? `Fotos\\${codigo}\\${CameraModule.getFilenameForDrive(i)}` : '');
    fCols.push(f ? (f.caption || '') : '');
  }
  return [
    r.tipo_ficha || CONFIG.TIPO_FICHA,
    r.codigo_proyecto, r.nro_concurso, r.fecha_recepcion,
    r.beneficiario, r.predio, r.roles_avaluo,
    r.comuna, r.provincia, r.region,
    r.utm_este, r.utm_norte, r.utm_datum, r.utm_huso,
    r.fecha_pago, r.nro_bono, r.fecha_visita,
    r.cultivo_inicial, r.cultivo_actual,
    (r.antecedentes||[]).map((a,i)=>`${i+1}) ${a}`).join(' | '),
    r.observaciones_tecnicas,
    r.tiempo_funcionamiento,
    (r.observaciones_generales||[]).map((o,i)=>`${i+1}) ${o}`).join(' | '),
    r.cumple_objetivo,
    ...fCols,
    r._id, r._created, r._modified,
    r._modified_count || 0,
    r._synced ? 'SÍ' : 'NO',
  ];
}

function buildCSV(records) {
  const rows = [csvHeaders(), ...records.map(recordToRow)].map(r => r.map(csvEscape).join(','));
  return '\uFEFF' + rows.join('\r\n');
}

function csvEscape(val) {
  const s = val == null ? '' : String(val);
  return (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r'))
    ? `"${s.replace(/"/g,'""')}"` : s;
}

/* ══════════════════════════════════════════════════════════
   EXPORTACIÓN
   ══════════════════════════════════════════════════════════ */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: filename }).click();
  URL.revokeObjectURL(url);
}

function exportCSV(record) {
  collectFormValues();
  downloadBlob(
    new Blob([buildCSV([record])], { type: 'text/csv;charset=utf-8;' }),
    `CNR_${record.codigo_proyecto || record._id.split('-')[0]}_seguimiento.csv`
  );
  showToast('CSV exportado ✓', 'success');
}

function exportAllCSV() {
  if (!State.records.length) { showToast('No hay registros para exportar', 'error'); return; }
  downloadBlob(
    new Blob([buildCSV(State.records)], { type: 'text/csv;charset=utf-8;' }),
    `CNR_Seguimiento_Todos_${dateToISO(new Date())}.csv`
  );
  showToast(`${State.records.length} registros exportados ✓`, 'success');
}

function exportJSON(record) {
  collectFormValues();
  const data  = JSON.parse(JSON.stringify(record));
  const codigo = record.codigo_proyecto || record._id.split('-')[0];
  data.fotos  = (record.fotos||[]).map((f,i) => ({
    numero: i+1,
    filename: CameraModule.getFilenameForDrive(i),
    ruta_access: `Fotos\\${codigo}\\${CameraModule.getFilenameForDrive(i)}`,
    caption: f.caption||'', timestamp: f.timestamp, sizeKB: f.sizeKB,
  }));
  downloadBlob(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    `CNR_${codigo}_seguimiento.json`
  );
  showToast('JSON exportado ✓', 'success');
}

/* ══════════════════════════════════════════════════════════
   GOOGLE DRIVE
   ══════════════════════════════════════════════════════════ */
function initGoogleAuth() {
  if (document.getElementById('gsi-script')) return;
  const s = document.createElement('script');
  s.id='gsi-script'; s.src='https://accounts.google.com/gsi/client';
  s.async=true; s.defer=true;
  document.head.appendChild(s);
}

function requestDriveToken() {
  return new Promise((resolve, reject) => {
    if (!window.google) { reject(new Error('Google Identity Services no cargado')); return; }
    google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      scope: 'https://www.googleapis.com/auth/drive.file',
      callback: (r) => r.error ? reject(new Error(r.error)) : (State.driveToken = r.access_token, resolve(r.access_token)),
    }).requestAccessToken({ prompt: '' });
  });
}

async function driveGetOrCreateFolder(token, name, parentId = null) {
  const q   = `name='${name}' and mimeType='application/vnd.google-apps.folder'${parentId?` and '${parentId}' in parents`:''} and trashed=false`;
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`,
    { headers: { Authorization: `Bearer ${token}` } });
  const d   = await res.json();
  if (d.files?.length) return d.files[0].id;
  const body = { name, mimeType: 'application/vnd.google-apps.folder', ...(parentId && { parents:[parentId] }) };
  const cr   = await fetch('https://www.googleapis.com/drive/v3/files',
    { method:'POST', headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json' }, body:JSON.stringify(body) });
  return (await cr.json()).id;
}

async function driveUploadFile(token, folderId, filename, blob, mimeType) {
  const q   = `name='${filename}' and '${folderId}' in parents and trashed=false`;
  const sr  = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`,
    { headers:{ Authorization:`Bearer ${token}` } });
  const sd  = await sr.json();
  const eid = sd.files?.[0]?.id;
  const meta = JSON.stringify({ name:filename, ...(!eid && { parents:[folderId] }) });
  const form = new FormData();
  form.append('metadata', new Blob([meta], { type:'application/json' }));
  form.append('file', blob);
  const url = eid
    ? `https://www.googleapis.com/upload/drive/v3/files/${eid}?uploadType=multipart`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
  return fetch(url, { method: eid?'PATCH':'POST', headers:{ Authorization:`Bearer ${token}` }, body:form });
}

async function syncRecord(record, token) {
  const rootId    = await driveGetOrCreateFolder(token, CONFIG.DRIVE_FOLDER_NAME);
  const projectId = await driveGetOrCreateFolder(token, record.codigo_proyecto||'sin_codigo', rootId);
  const codigo    = record.codigo_proyecto || record._id.split('-')[0];

  await driveUploadFile(token, projectId, `${codigo}_seguimiento.csv`,
    new Blob([buildCSV([record])], { type:'text/csv;charset=utf-8;' }), 'text/csv');

  const jdata = JSON.parse(JSON.stringify(record));
  jdata.fotos = (record.fotos||[]).map((f,i)=>({
    numero:i+1, filename:CameraModule.getFilenameForDrive(i),
    ruta_access:`Fotos\\${codigo}\\${CameraModule.getFilenameForDrive(i)}`,
    caption:f.caption||'', timestamp:f.timestamp, sizeKB:f.sizeKB,
  }));
  await driveUploadFile(token, projectId, `${codigo}_seguimiento.json`,
    new Blob([JSON.stringify(jdata,null,2)], { type:'application/json' }), 'application/json');

  for (let i=0; i<(record.fotos||[]).length; i++) {
    await driveUploadFile(token, projectId, CameraModule.getFilenameForDrive(i),
      CameraModule.dataUrlToBlob(record.fotos[i].dataUrl), 'image/jpeg');
  }
}

async function triggerSync() {
  if (State.isSyncing || !State.isOnline) return;
  const unsynced = State.records.filter(r => !r._synced);
  if (!unsynced.length) return;
  State.isSyncing = true;
  updateSyncUI('syncing');
  try {
    const token = State.driveToken || await requestDriveToken();
    for (const record of unsynced) {
      await syncRecord(record, token);
      record._synced = true; record._syncedAt = new Date().toISOString();
      await dbPut(record);
    }
    State.records = await dbGetAll();
    renderRecordsList();
    showToast(`${unsynced.length} registro(s) sincronizado(s) ✓`, 'success');
    updateSyncUI('online');
  } catch (err) {
    console.error('Sync error:', err);
    showToast('Error al sincronizar. Intente manualmente.', 'error');
    updateSyncUI('online');
    if (err.message?.includes('401')) State.driveToken = null;
  } finally {
    State.isSyncing = false;
  }
}

/* ══════════════════════════════════════════════════════════
   UI
   ══════════════════════════════════════════════════════════ */
function renderRecordsList() {
  const container = document.getElementById('records-list');
  const searchVal = (document.getElementById('search-input')?.value||'').toLowerCase();
  let filtered    = State.records.filter(r =>
    !searchVal ||
    (r.beneficiario||'').toLowerCase().includes(searchVal) ||
    (r.codigo_proyecto||'').toLowerCase().includes(searchVal) ||
    (r.nro_bono||'').toLowerCase().includes(searchVal)
  ).sort((a,b) => new Date(b._modified)-new Date(a._modified));

  if (!filtered.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div>
      <h3>${searchVal?'Sin resultados':'Sin registros'}</h3>
      <p>${searchVal?'Pruebe otro término':'Cree un registro con "Nueva Ficha"'}</p></div>`;
    return;
  }
  // Actualizar contador en botón Mis Fichas
  const fichasLabel = document.getElementById('mis-fichas-label');
  if (fichasLabel) {
    const total = State.records.length;
    fichasLabel.innerHTML = `Mis Fichas ${total > 0 ? `<span class="count-badge">${total}</span>` : ''}`;
  }

  container.innerHTML = '';
  filtered.forEach(record => {
    const isModified = (record._modified_count||0) > 1;
    const card = document.createElement('div');
    card.className = 'record-card' + (State.currentRecord?._id===record._id?' active':'');

    card.innerHTML = `
      <div class="record-card-delete-bg">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
        </svg>
        Eliminar
      </div>
      <div class="record-card-inner">
        <div class="record-card-code">
          ${escapeHtml(record.codigo_proyecto||'Sin código')}
          ${isModified?`<span class="mod-star" title="Modificado ${record._modified_count-1} vez/veces">✱</span>`:''}
        </div>
        <div class="record-card-name">${escapeHtml(record.beneficiario||'Sin beneficiario')}</div>
        <div class="record-card-meta">
          <span>${isoToDisplay(record.fecha_visita||'')}</span>
          <span class="badge ${record._synced?'badge-synced':'badge-pending'}">${record._synced?'✓ Sync':'⏳ Local'}</span>
          ${record.cumple_objetivo?`<span class="badge badge-${record.cumple_objetivo.toLowerCase()}">${record.cumple_objetivo}</span>`:''}
        </div>
        ${isModified?`<div class="record-card-moddate">Últ. modificación: ${formatDateShort(record._modified)}</div>`:''}
      </div>
    `;

    // Toque normal → abrir registro
    card.querySelector('.record-card-inner').addEventListener('click', () => {
      if (card.classList.contains('swiping-left')) {
        card.classList.remove('swiping-left');
        return;
      }
      loadRecordToForm(record);
      renderRecordsList();
    });

    // Desliz izquierda → mostrar botón eliminar
    bindSwipeDelete(card, record);

    container.appendChild(card);
  });
}

function updateSyncUI(state) {
  const cfg = { online:{dot:'online',text:'En línea',btn:'Sincronizar'},
                offline:{dot:'offline',text:'Sin conexión',btn:'Sin conexión'},
                syncing:{dot:'syncing',text:'Sincronizando…',btn:'Sincronizando…'} }[state];
  if (!cfg) return;
  const dot=document.getElementById('status-dot'), text=document.getElementById('status-text'), btn=document.getElementById('sync-btn');
  if (dot)  dot.className    = `status-dot ${cfg.dot}`;
  if (text) text.textContent = cfg.text;
  if (btn) {
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      style="${state==='syncing'?'animation:spin 1s linear infinite':''}">
      <path d="M23 4v6h-6M1 20v-6h6"/>
      <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
    </svg>${cfg.btn}`;
    btn.disabled = state==='syncing'||state==='offline';
  }
}

function updateCumpleVisual(value) {
  document.querySelectorAll('.cumple-option').forEach(o=>o.classList.remove('selected'));
  if (value) document.querySelector(`.cumple-option.${value.toLowerCase()}-opt`)?.classList.add('selected');
}

function showToast(msg, type='info') {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = `${{success:'✓',error:'✕',info:'ℹ'}[type]||''} ${msg}`;
  c.appendChild(t);
  setTimeout(()=>t.remove(), 3500);
}

function escapeHtml(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatDateShort(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString('es-CL',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}); }
  catch { return iso; }
}

/* ══════════════════════════════════════════════════════════
   INICIALIZACIÓN
   ══════════════════════════════════════════════════════════ */
async function init() {
  State.db      = await openDB();
  State.records = await dbGetAll();
  CameraModule.init(addPhoto);
  initGoogleAuth();
  window.addEventListener('cnr:toast', (e) => showToast(e.detail.msg, e.detail.type));
  window.addEventListener('online',  () => { State.isOnline=true;  updateSyncUI('online');  triggerSync(); });
  window.addEventListener('offline', () => { State.isOnline=false; updateSyncUI('offline'); });
  updateSyncUI(State.isOnline ? 'online' : 'offline');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); State.installPrompt=e;
    document.getElementById('install-banner')?.classList.add('visible');
  });
  renderRecordsList();
  bindFormEvents();
}

/* ══════════════════════════════════════════════════════════
   DESLIZ Y PRESS LARGO PARA BORRAR
   ══════════════════════════════════════════════════════════ */
function bindSwipeDelete(card, record) {
  let startX = 0, startY = 0, isDragging = false, longPressTimer = null;
  const SWIPE_THRESHOLD    = 60;
  const LONG_PRESS_DELAY   = 600;

  card.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    isDragging = false;

    // Press largo
    longPressTimer = setTimeout(() => {
      card.classList.add('press-long');
      showDeleteConfirm(record);
    }, LONG_PRESS_DELAY);
  }, { passive: true });

  card.addEventListener('touchmove', (e) => {
    clearTimeout(longPressTimer);
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
      isDragging = true;
      if (dx < -20) card.classList.add('swiping-left');
      else if (dx > 20) card.classList.remove('swiping-left');
    }
  }, { passive: true });

  card.addEventListener('touchend', (e) => {
    clearTimeout(longPressTimer);
    card.classList.remove('press-long');
    if (!isDragging) return;
    const dx = e.changedTouches[0].clientX - startX;
    if (dx < -SWIPE_THRESHOLD) {
      card.classList.add('swiping-left');
      // Toque en zona roja → confirmar borrado
      card.querySelector('.record-card-delete-bg').addEventListener('click', () => {
        showDeleteConfirm(record);
      }, { once: true });
    } else {
      card.classList.remove('swiping-left');
    }
  }, { passive: true });
}

let _pendingDeleteRecord = null;

function showDeleteConfirm(record) {
  _pendingDeleteRecord = record;
  const modal    = document.getElementById('modal-confirm-delete');
  const nameEl   = document.getElementById('modal-delete-name');
  if (nameEl) nameEl.textContent =
    `${record.codigo_proyecto || 'Sin código'} — ${record.beneficiario || 'Sin beneficiario'}`;
  if (modal) modal.classList.add('open');
}

function bindFormEvents() {
  // Modal post-guardado
  document.getElementById('modal-nueva-ficha')?.addEventListener('click', () => {
    hidePostSaveModal();
    State.currentRecord = createEmptyRecord();
    State.records.push(State.currentRecord);
    loadRecordToForm(State.currentRecord);
    renderRecordsList();
  });
  document.getElementById('modal-ver-registros')?.addEventListener('click', () => {
    hidePostSaveModal();
    // Abrir sidebar en tablet
    const sidebar = document.getElementById('records-sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (window.innerWidth <= 900) {
      sidebar?.classList.add('mobile-visible');
      overlay?.classList.add('visible');
      document.body.style.overflow = 'hidden';
    }
  });
  document.getElementById('modal-continuar')?.addEventListener('click', hidePostSaveModal);

  // Modal confirmar borrado
  document.getElementById('modal-delete-cancel')?.addEventListener('click', () => {
    document.getElementById('modal-confirm-delete')?.classList.remove('open');
    _pendingDeleteRecord = null;
    // Cerrar desliz abierto
    document.querySelectorAll('.record-card.swiping-left').forEach(c => c.classList.remove('swiping-left'));
  });
  document.getElementById('modal-delete-confirm')?.addEventListener('click', async () => {
    document.getElementById('modal-confirm-delete')?.classList.remove('open');
    if (_pendingDeleteRecord) {
      await deleteRecord(_pendingDeleteRecord);
      _pendingDeleteRecord = null;
    }
  });
   // Botón Descartar / Cerrar
  document.getElementById('discard-btn')?.addEventListener('click', () => {
    if (!State.currentRecord) return;
    const isNew = State.currentRecord._modified_count === 0;
    if (isNew) {
      // Ficha nunca guardada → mostrar modal de confirmación
      document.getElementById('modal-confirm-discard')?.classList.add('open');
    } else {
      // Ficha ya guardada → cerrar sin borrar
      State.currentRecord = null;
      document.getElementById('no-record-msg').style.display  = 'flex';
      document.getElementById('form-wrapper').style.display   = 'none';
      document.getElementById('action-bar').style.display     = 'none';
      document.querySelectorAll('.record-card').forEach(c => c.classList.remove('active'));
    }
  });

  // Modal descartar — Volver
  document.getElementById('modal-discard-cancel')?.addEventListener('click', () => {
    document.getElementById('modal-confirm-discard')?.classList.remove('open');
  });

  // Modal descartar — Confirmar
  document.getElementById('modal-discard-confirm')?.addEventListener('click', async () => {
    document.getElementById('modal-confirm-discard')?.classList.remove('open');
    if (!State.currentRecord) return;
    // Eliminar de IndexedDB y memoria
    await dbDelete(State.currentRecord._id);
    State.records = State.records.filter(r => r._id !== State.currentRecord._id);
    State.currentRecord = null;
    document.getElementById('no-record-msg').style.display  = 'flex';
    document.getElementById('form-wrapper').style.display   = 'none';
    document.getElementById('action-bar').style.display     = 'none';
    renderRecordsList();
    showToast('Ficha descartada', 'info');
  });
  // Botón eliminar en action bar
  document.getElementById('delete-btn')?.addEventListener('click', () => {
    if (!State.currentRecord) return;
    showDeleteConfirm(State.currentRecord);
  });

  document.getElementById('new-record-btn')?.addEventListener('click', () => {
    State.currentRecord = createEmptyRecord();
    State.records.push(State.currentRecord);
    loadRecordToForm(State.currentRecord);
    renderRecordsList();
  });
  document.getElementById('save-btn')?.addEventListener('click', saveCurrentRecord);
  document.getElementById('export-csv-btn')?.addEventListener('click', () => { if (State.currentRecord) exportCSV(State.currentRecord); });
  document.getElementById('export-all-csv-btn')?.addEventListener('click', exportAllCSV);
  document.getElementById('export-json-btn')?.addEventListener('click', () => { if (State.currentRecord) exportJSON(State.currentRecord); });
  document.getElementById('sync-btn')?.addEventListener('click', triggerSync);
  document.getElementById('search-input')?.addEventListener('input', renderRecordsList);
  document.getElementById('gps-btn')?.addEventListener('click', getGeoLocation);
  document.getElementById('camera-btn')?.addEventListener('click', () => {
    if (!State.currentRecord) { showToast('Primero cree o guarde un registro','error'); return; }
    CameraModule.captureFromCamera((State.currentRecord.fotos||[]).length);
  });
  document.getElementById('gallery-btn')?.addEventListener('click', () => {
    if (!State.currentRecord) { showToast('Primero cree o guarde un registro','error'); return; }
    CameraModule.selectFromGallery((State.currentRecord.fotos||[]).length);
  });
  document.querySelectorAll('.cumple-option').forEach(opt => {
    opt.addEventListener('click', () => {
      const input = opt.querySelector('input[type="radio"]');
      if (input) { input.checked=true; updateCumpleVisual(input.value); }
    });
  });
  document.getElementById('add-antecedente')?.addEventListener('click', () =>
    addDynamicItem(document.getElementById('antecedentes-list')));
  document.getElementById('add-obs-general')?.addEventListener('click', () =>
    addDynamicItem(document.getElementById('obs-generales-list')));
  document.getElementById('install-btn')?.addEventListener('click', async () => {
    if (State.installPrompt) {
      State.installPrompt.prompt();
      const r = await State.installPrompt.userChoice;
      if (r.outcome==='accepted') document.getElementById('install-banner')?.classList.remove('visible');
    }
  });
}

/* ══════════════════════════════════════════════════════════
   ELIMINAR REGISTRO
   ══════════════════════════════════════════════════════════ */
function dbDelete(id) {
  return new Promise((resolve, reject) => {
    const tx  = State.db.transaction(CONFIG.STORE_NAME, 'readwrite');
    const req = tx.objectStore(CONFIG.STORE_NAME).delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });
}

async function deleteRecord(record) {
  await dbDelete(record._id);
  State.records = State.records.filter(r => r._id !== record._id);

  if (record._synced && State.isOnline) {
    try {
      const token = State.driveToken || await requestDriveToken();
      await markDeletedInDrive(token, record);
    } catch (err) {
      console.warn('No se pudo marcar en Drive:', err);
    }
  }

  if (State.currentRecord && State.currentRecord._id === record._id) {
    State.currentRecord = null;
    document.getElementById('no-record-msg').style.display = 'flex';
    document.getElementById('form-wrapper').style.display  = 'none';
    document.getElementById('action-bar').style.display    = 'none';
  }

  renderRecordsList();
  showToast('Ficha eliminada', 'success');
}

async function markDeletedInDrive(token, record) {
  const codigo    = record.codigo_proyecto || record._id.split('-')[0];
  const rootId    = await driveGetOrCreateFolder(token, CONFIG.DRIVE_FOLDER_NAME);
  const projectId = await driveGetOrCreateFolder(token, codigo, rootId);
  const csv       = buildCSV([Object.assign({}, record, { _deleted: true, _deletedAt: new Date().toISOString() })]);
  await driveUploadFile(token, projectId,
    'ELIMINADO_' + codigo + '_seguimiento.csv',
    new Blob([csv], { type: 'text/csv;charset=utf-8;' }), 'text/csv');
}


document.addEventListener('DOMContentLoaded', init);
