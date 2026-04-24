/**
 * app.js — Lógica principal CNR Seguimiento PWA
 * IndexedDB · Exportación JSON/CSV · Google Drive OAuth2
 */

'use strict';

/* ══════════════════════════════════════════════════════════
   CONFIGURACIÓN — editar antes de desplegar
   ══════════════════════════════════════════════════════════ */
const CONFIG = {
  GOOGLE_CLIENT_ID:  '353831203919-9uf4jmk8he5df4dvvpdoq0dle1jmeiju.apps.googleusercontent.com',
  DRIVE_FOLDER_NAME: 'CNR_Seguimiento',
  DB_NAME:           'cnr_seguimiento',
  DB_VERSION:        1,
  STORE_NAME:        'registros',
};

/* ══════════════════════════════════════════════════════════
   ESTADO GLOBAL
   ══════════════════════════════════════════════════════════ */
const State = {
  db:              null,
  currentRecord:   null,   // registro activo en el formulario
  records:         [],     // lista en memoria
  isOnline:        navigator.onLine,
  isSyncing:       false,
  driveToken:      null,
  driveFolderId:   null,
  installPrompt:   null,
};

/* ══════════════════════════════════════════════════════════
   MODELO DE DATOS — campos del formulario CNR
   ══════════════════════════════════════════════════════════ */
function createEmptyRecord() {
  return {
    // Identificadores
    _id:                   crypto.randomUUID(),
    _created:              new Date().toISOString(),
    _modified:             new Date().toISOString(),
    _synced:               false,
    _syncedAt:             null,

    // Datos del proyecto
    codigo_proyecto:       '',
    nro_concurso:          '',
    fecha_recepcion:       '',
    beneficiario:          '',
    predio:                '',
    roles_avaluo:          '',
    comuna:                '',
    provincia:             '',
    region:                '',
    utm_este:              '',
    utm_norte:             '',
    utm_datum:             'WGS 84',
    utm_huso:              '19',
    uso:                   '',
    fecha_pago:            '',
    nro_bono:              '',
    fecha_visita:          new Date().toISOString().split('T')[0],

    // Cultivos
    cultivo_inicial:       '',
    cultivo_actual:        '',

    // Campos de texto
    antecedentes:          [''],   // array de strings
    observaciones_tecnicas:'',
    tiempo_funcionamiento: '',
    observaciones_generales: [''], // array de strings
    cumple_objetivo:       '',     // 'SI' | 'NO'

    // Fotos
    fotos: [],                     // array de objetos foto
  };
}

/* ══════════════════════════════════════════════════════════
   INDEXEDDB
   ══════════════════════════════════════════════════════════ */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db    = e.target.result;
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

async function dbGetAll() {
  return new Promise((resolve, reject) => {
    const tx  = State.db.transaction(CONFIG.STORE_NAME, 'readonly');
    const req = tx.objectStore(CONFIG.STORE_NAME).getAll();
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

async function dbPut(record) {
  return new Promise((resolve, reject) => {
    const tx  = State.db.transaction(CONFIG.STORE_NAME, 'readwrite');
    const req = tx.objectStore(CONFIG.STORE_NAME).put(record);
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });
}

async function dbDelete(id) {
  return new Promise((resolve, reject) => {
    const tx  = State.db.transaction(CONFIG.STORE_NAME, 'readwrite');
    const req = tx.objectStore(CONFIG.STORE_NAME).delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });
}

/* ══════════════════════════════════════════════════════════
   GUARDAR / CARGAR REGISTROS
   ══════════════════════════════════════════════════════════ */
async function saveCurrentRecord() {
  if (!State.currentRecord) return;

  // Leer valores del formulario
  collectFormValues();

  State.currentRecord._modified = new Date().toISOString();
  State.currentRecord._synced   = false;

  await dbPut(State.currentRecord);
  State.records = await dbGetAll();
  renderRecordsList();
  showToast('Registro guardado', 'success');

  // Intentar sync si hay conexión
  if (State.isOnline) triggerSync();
}

function collectFormValues() {
  const r = State.currentRecord;

  // Campos simples
  const simpleFields = [
    'codigo_proyecto','nro_concurso','fecha_recepcion','beneficiario',
    'predio','roles_avaluo','comuna','provincia','region',
    'utm_este','utm_norte','utm_datum','utm_huso','uso',
    'fecha_pago','nro_bono','fecha_visita',
    'cultivo_inicial','cultivo_actual','observaciones_tecnicas',
    'tiempo_funcionamiento',
  ];

  simpleFields.forEach(field => {
    const el = document.getElementById(`f_${field}`);
    if (el) r[field] = el.value.trim();
  });

  // Cumple objetivo
  const cumpleChecked = document.querySelector('input[name="cumple_objetivo"]:checked');
  r.cumple_objetivo = cumpleChecked ? cumpleChecked.value : '';

  // Antecedentes (lista dinámica)
  r.antecedentes = collectDynamicList('antecedentes-list');

  // Observaciones generales (lista dinámica)
  r.observaciones_generales = collectDynamicList('obs-generales-list');
}

function collectDynamicList(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return [''];
  return Array.from(container.querySelectorAll('textarea'))
    .map(ta => ta.value.trim())
    .filter(v => v.length > 0);
}

function loadRecordToForm(record) {
  State.currentRecord = JSON.parse(JSON.stringify(record)); // copia profunda

  const simpleFields = [
    'codigo_proyecto','nro_concurso','fecha_recepcion','beneficiario',
    'predio','roles_avaluo','comuna','provincia','region',
    'utm_este','utm_norte','utm_datum','utm_huso','uso',
    'fecha_pago','nro_bono','fecha_visita',
    'cultivo_inicial','cultivo_actual','observaciones_tecnicas',
    'tiempo_funcionamiento',
  ];

  simpleFields.forEach(field => {
    const el = document.getElementById(`f_${field}`);
    if (el) el.value = record[field] || '';
  });

  // Cumple objetivo
  const cumpleInput = document.querySelector(`input[name="cumple_objetivo"][value="${record.cumple_objetivo}"]`);
  if (cumpleInput) {
    cumpleInput.checked = true;
    updateCumpleVisual(record.cumple_objetivo);
  } else {
    document.querySelectorAll('.cumple-option').forEach(o => o.classList.remove('selected'));
  }

  // Listas dinámicas
  renderDynamicList('antecedentes-list', record.antecedentes || ['']);
  renderDynamicList('obs-generales-list', record.observaciones_generales || ['']);

  // Fotos
  renderPhotos();

  // Actualizar id display
  const idDisplay = document.getElementById('record-id-display');
  if (idDisplay) {
    idDisplay.textContent = `ID: ${record._id.split('-')[0]} · ${record._synced ? '✓ Sincronizado' : '⏳ Pendiente sync'}`;
  }

  // Mostrar area de formulario
  document.getElementById('no-record-msg').style.display = 'none';
  document.getElementById('form-wrapper').style.display  = 'flex';
}

/* ══════════════════════════════════════════════════════════
   LISTAS DINÁMICAS (antecedentes / observaciones)
   ══════════════════════════════════════════════════════════ */
function renderDynamicList(containerId, items) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';

  const list = items.length > 0 ? items : [''];
  list.forEach((text, i) => addDynamicItem(container, text, i + 1));
}

function addDynamicItem(container, text = '', number = null) {
  const items    = container.querySelectorAll('.dynamic-item');
  const itemNum  = number || items.length + 1;
  const div      = document.createElement('div');
  div.className  = 'dynamic-item';
  div.innerHTML  = `
    <div class="item-number">${itemNum}</div>
    <textarea placeholder="Escriba aquí...">${escapeHtml(text)}</textarea>
    <button class="item-remove" title="Eliminar ítem">✕</button>
  `;

  div.querySelector('.item-remove').addEventListener('click', () => {
    div.remove();
    renumberDynamicList(container);
  });

  container.appendChild(div);
}

function renumberDynamicList(container) {
  container.querySelectorAll('.item-number').forEach((el, i) => {
    el.textContent = i + 1;
  });
}

/* ══════════════════════════════════════════════════════════
   FOTOS
   ══════════════════════════════════════════════════════════ */
function renderPhotos() {
  const container = document.getElementById('photos-grid');
  const photos    = State.currentRecord ? State.currentRecord.fotos || [] : [];
  const counter   = document.getElementById('photo-counter');

  if (counter) counter.textContent = `${photos.length} / ${CameraModule.MAX_PHOTOS} fotos`;

  CameraModule.renderPhotoGrid(
    photos,
    container,
    (photoId) => removePhoto(photoId),
    (photoId, caption) => updatePhotoCaption(photoId, caption),
  );
}

function addPhoto(photoObj) {
  if (!State.currentRecord) return;
  State.currentRecord.fotos = State.currentRecord.fotos || [];
  State.currentRecord.fotos.push(photoObj);
  renderPhotos();
  showToast(`Foto agregada (${Math.round(photoObj.sizeKB)} KB)`, 'success');
}

function removePhoto(photoId) {
  if (!State.currentRecord) return;
  State.currentRecord.fotos = State.currentRecord.fotos.filter(f => f.id !== photoId);
  renderPhotos();
}

function updatePhotoCaption(photoId, caption) {
  if (!State.currentRecord) return;
  const foto = State.currentRecord.fotos.find(f => f.id === photoId);
  if (foto) foto.caption = caption;
}

/* ══════════════════════════════════════════════════════════
   GEOLOCALIZACIÓN
   ══════════════════════════════════════════════════════════ */
function getGeoLocation() {
  if (!navigator.geolocation) {
    showToast('Geolocalización no disponible', 'error');
    return;
  }
  showToast('Obteniendo ubicación GPS…', 'info');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;

      // Conversión decimal a UTM simplificada (zona 19S para Chile central)
      // Para producción usar una librería proj4js completa
      const { easting, northing } = latLonToUTM(lat, lon);

      const elEste  = document.getElementById('f_utm_este');
      const elNorte = document.getElementById('f_utm_norte');
      if (elEste)  elEste.value  = easting.toFixed(0);
      if (elNorte) elNorte.value = northing.toFixed(0);

      if (State.currentRecord) {
        State.currentRecord.utm_este  = easting.toFixed(0);
        State.currentRecord.utm_norte = northing.toFixed(0);
      }
      showToast('Coordenadas obtenidas', 'success');
    },
    (err) => {
      showToast('No se pudo obtener la ubicación', 'error');
      console.error(err);
    },
    { enableHighAccuracy: true, timeout: 15000 }
  );
}

/**
 * Conversión WGS84 → UTM (zona 19H/19S, hemisferio sur)
 * Aproximación suficiente para terreno; para mayor precisión usar proj4.js
 */
function latLonToUTM(lat, lon) {
  const a  = 6378137.0;
  const f  = 1 / 298.257223563;
  const b  = a * (1 - f);
  const e2 = 1 - (b * b) / (a * a);
  const k0 = 0.9996;

  const latR = (lat * Math.PI) / 180;
  const lonR = (lon * Math.PI) / 180;

  // Meridiano central zona 19 = -69°
  const lon0R = (-69 * Math.PI) / 180;

  const N   = a / Math.sqrt(1 - e2 * Math.sin(latR) ** 2);
  const T   = Math.tan(latR) ** 2;
  const C   = (e2 / (1 - e2)) * Math.cos(latR) ** 2;
  const A   = Math.cos(latR) * (lonR - lon0R);
  const e4  = e2 * e2;
  const e6  = e4 * e2;

  const M = a * (
    (1 - e2/4 - 3*e4/64 - 5*e6/256) * latR
    - (3*e2/8 + 3*e4/32 + 45*e6/1024) * Math.sin(2*latR)
    + (15*e4/256 + 45*e6/1024) * Math.sin(4*latR)
    - (35*e6/3072) * Math.sin(6*latR)
  );

  const easting  = k0 * N * (A + (1-T+C)*A**3/6 + (5-18*T+T**2+72*C-58*(e2/(1-e2)))*A**5/120) + 500000;
  let   northing = k0 * (M + N * Math.tan(latR) * (A**2/2 + (5-T+9*C+4*C**2)*A**4/24 + (61-58*T+T**2+600*C-330*(e2/(1-e2)))*A**6/720));

  if (lat < 0) northing += 10000000; // hemisferio sur

  return { easting, northing };
}

/* ══════════════════════════════════════════════════════════
   EXPORTACIÓN JSON
   ══════════════════════════════════════════════════════════ */
function exportJSON(record) {
  // Excluimos los dataUrl de fotos del JSON (van separados)
  const exportData = JSON.parse(JSON.stringify(record));
  exportData.fotos = (record.fotos || []).map((f, i) => ({
    numero:    i + 1,
    filename:  CameraModule.getFilenameForDrive(i),
    caption:   f.caption || '',
    timestamp: f.timestamp,
    sizeKB:    f.sizeKB,
  }));

  const blob     = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url      = URL.createObjectURL(blob);
  const a        = document.createElement('a');
  a.href         = url;
  a.download     = `CNR_${record.codigo_proyecto || record._id.split('-')[0]}_ficha.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('JSON exportado', 'success');
}

/* ══════════════════════════════════════════════════════════
   EXPORTACIÓN CSV — compatible Access 2019/365 (UTF-8 BOM)
   ══════════════════════════════════════════════════════════ */
function exportCSV(record) {
  const headers = [
    'Código Proyecto','N° Concurso','Fecha Recepción Técnica',
    'Beneficiario','Predio','Rol(es) de Avalúo',
    'Comuna','Provincia','Región',
    'UTM Este','UTM Norte','UTM Datum','UTM Huso','Uso',
    'Fecha de Pago','N° Bono','Fecha de Visita',
    'Cultivo Inicial','Cultivo Actual',
    'Antecedentes','Observaciones Técnicas',
    'Tiempo Funcionamiento Obra (años)',
    'Observaciones Generales','Cumple con el Objetivo',
    'N° Foto 1','Pie de Foto 1',
    'N° Foto 2','Pie de Foto 2',
    'N° Foto 3','Pie de Foto 3',
    'N° Foto 4','Pie de Foto 4',
    'N° Foto 5','Pie de Foto 5',
    'ID Registro','Fecha Creación','Fecha Modificación','Sincronizado',
  ];

  const fotos = record.fotos || [];
  const fotoColumns = [];
  for (let i = 0; i < 5; i++) {
    const foto = fotos[i];
    fotoColumns.push(foto ? CameraModule.getFilenameForDrive(i) : '');
    fotoColumns.push(foto ? (foto.caption || '') : '');
  }

  const row = [
    record.codigo_proyecto,
    record.nro_concurso,
    record.fecha_recepcion,
    record.beneficiario,
    record.predio,
    record.roles_avaluo,
    record.comuna,
    record.provincia,
    record.region,
    record.utm_este,
    record.utm_norte,
    record.utm_datum,
    record.utm_huso,
    record.uso,
    record.fecha_pago,
    record.nro_bono,
    record.fecha_visita,
    record.cultivo_inicial,
    record.cultivo_actual,
    (record.antecedentes || []).map((a, i) => `${i+1}) ${a}`).join(' | '),
    record.observaciones_tecnicas,
    record.tiempo_funcionamiento,
    (record.observaciones_generales || []).map((o, i) => `${i+1}) ${o}`).join(' | '),
    record.cumple_objetivo,
    ...fotoColumns,
    record._id,
    record._created,
    record._modified,
    record._synced ? 'SÍ' : 'NO',
  ];

  const csvRow  = row.map(csvEscape).join(',');
  const csv     = [headers.map(csvEscape).join(','), csvRow].join('\r\n');
  const BOM     = '\uFEFF'; // UTF-8 BOM para Access
  const blob    = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
  const url     = URL.createObjectURL(blob);
  const a       = document.createElement('a');
  a.href        = url;
  a.download    = `CNR_${record.codigo_proyecto || record._id.split('-')[0]}_ficha.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV exportado', 'success');
}

function csvEscape(val) {
  const str = val === null || val === undefined ? '' : String(val);
  // Envuelve en comillas si contiene coma, comilla doble o salto de línea
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/* ══════════════════════════════════════════════════════════
   GOOGLE DRIVE — OAuth2 + Upload
   ══════════════════════════════════════════════════════════ */
function initGoogleAuth() {
  // Carga el script de Google Identity Services dinámicamente
  if (document.getElementById('gsi-script')) return;
  const script  = document.createElement('script');
  script.id     = 'gsi-script';
  script.src    = 'https://accounts.google.com/gsi/client';
  script.async  = true;
  script.defer  = true;
  document.head.appendChild(script);
}

function requestDriveToken() {
  return new Promise((resolve, reject) => {
    if (!window.google) {
      reject(new Error('Google Identity Services no cargado'));
      return;
    }

    const tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      scope: 'https://www.googleapis.com/auth/drive.file',
      callback: (response) => {
        if (response.error) {
          reject(new Error(response.error));
        } else {
          State.driveToken = response.access_token;
          resolve(response.access_token);
        }
      },
    });

    tokenClient.requestAccessToken({ prompt: '' });
  });
}

async function getOrCreateDriveFolder(token) {
  // Busca si ya existe la carpeta
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=name='${CONFIG.DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const searchData = await searchRes.json();
  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0].id;
  }

  // Crea la carpeta si no existe
  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name:     CONFIG.DRIVE_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });
  const createData = await createRes.json();
  return createData.id;
}

async function getOrCreateProjectFolder(token, parentId, codigoProyecto) {
  const folderName = codigoProyecto || 'sin_codigo';
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=name='${folderName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const searchData = await searchRes.json();
  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0].id;
  }

  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name:     folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents:  [parentId],
    }),
  });
  const createData = await createRes.json();
  return createData.id;
}

async function uploadFileToDrive(token, folderId, filename, blob, mimeType) {
  const metadata = JSON.stringify({ name: filename, parents: [folderId] });
  const formData = new FormData();
  formData.append('metadata', new Blob([metadata], { type: 'application/json' }));
  formData.append('file', blob);

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name',
    {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}` },
      body:    formData,
    }
  );
  return res.json();
}

/* ── Sincronización completa de un registro ─────────────── */
async function syncRecord(record, token) {
  const rootFolderId    = await getOrCreateDriveFolder(token);
  const projectFolderId = await getOrCreateProjectFolder(token, rootFolderId, record.codigo_proyecto);

  // 1. Subir CSV
  const BOM    = '\uFEFF';
  const csvStr = generateCSVString(record);
  const csvBlob = new Blob([BOM + csvStr], { type: 'text/csv;charset=utf-8;' });
  await uploadFileToDrive(
    token,
    projectFolderId,
    `${record.codigo_proyecto || record._id.split('-')[0]}_ficha.csv`,
    csvBlob,
    'text/csv'
  );

  // 2. Subir JSON
  const exportData     = prepareJSONExport(record);
  const jsonBlob       = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  await uploadFileToDrive(
    token,
    projectFolderId,
    `${record.codigo_proyecto || record._id.split('-')[0]}_ficha.json`,
    jsonBlob,
    'application/json'
  );

  // 3. Subir fotos
  for (let i = 0; i < (record.fotos || []).length; i++) {
    const foto     = record.fotos[i];
    const filename = CameraModule.getFilenameForDrive(i);
    const blob     = CameraModule.dataUrlToBlob(foto.dataUrl);
    await uploadFileToDrive(token, projectFolderId, filename, blob, 'image/jpeg');
  }

  return projectFolderId;
}

function generateCSVString(record) {
  const headers = [
    'Código Proyecto','N° Concurso','Fecha Recepción Técnica',
    'Beneficiario','Predio','Rol(es) de Avalúo',
    'Comuna','Provincia','Región',
    'UTM Este','UTM Norte','UTM Datum','UTM Huso','Uso',
    'Fecha de Pago','N° Bono','Fecha de Visita',
    'Cultivo Inicial','Cultivo Actual',
    'Antecedentes','Observaciones Técnicas',
    'Tiempo Funcionamiento Obra (años)',
    'Observaciones Generales','Cumple con el Objetivo',
    'N° Foto 1','Pie de Foto 1','N° Foto 2','Pie de Foto 2',
    'N° Foto 3','Pie de Foto 3','N° Foto 4','Pie de Foto 4',
    'N° Foto 5','Pie de Foto 5',
    'ID Registro','Fecha Creación','Fecha Modificación','Sincronizado',
  ];

  const fotos = record.fotos || [];
  const fotoColumns = [];
  for (let i = 0; i < 5; i++) {
    const foto = fotos[i];
    fotoColumns.push(foto ? CameraModule.getFilenameForDrive(i) : '');
    fotoColumns.push(foto ? (foto.caption || '') : '');
  }

  const row = [
    record.codigo_proyecto, record.nro_concurso, record.fecha_recepcion,
    record.beneficiario, record.predio, record.roles_avaluo,
    record.comuna, record.provincia, record.region,
    record.utm_este, record.utm_norte, record.utm_datum, record.utm_huso, record.uso,
    record.fecha_pago, record.nro_bono, record.fecha_visita,
    record.cultivo_inicial, record.cultivo_actual,
    (record.antecedentes || []).map((a, i) => `${i+1}) ${a}`).join(' | '),
    record.observaciones_tecnicas,
    record.tiempo_funcionamiento,
    (record.observaciones_generales || []).map((o, i) => `${i+1}) ${o}`).join(' | '),
    record.cumple_objetivo,
    ...fotoColumns,
    record._id, record._created, record._modified, 'SÍ',
  ];

  return [headers.map(csvEscape).join(','), row.map(csvEscape).join(',')].join('\r\n');
}

function prepareJSONExport(record) {
  const data  = JSON.parse(JSON.stringify(record));
  data.fotos  = (record.fotos || []).map((f, i) => ({
    numero:    i + 1,
    filename:  CameraModule.getFilenameForDrive(i),
    caption:   f.caption || '',
    timestamp: f.timestamp,
    sizeKB:    f.sizeKB,
  }));
  return data;
}

/* ── Trigger de sincronización ──────────────────────────── */
async function triggerSync() {
  if (State.isSyncing || !State.isOnline) return;
  const unsynced = State.records.filter(r => !r._synced);
  if (unsynced.length === 0) return;

  State.isSyncing = true;
  updateSyncUI('syncing');

  try {
    let token = State.driveToken;
    if (!token) {
      token = await requestDriveToken();
    }

    for (const record of unsynced) {
      await syncRecord(record, token);
      record._synced   = true;
      record._syncedAt = new Date().toISOString();
      await dbPut(record);
    }

    State.records = await dbGetAll();
    renderRecordsList();
    showToast(`${unsynced.length} registro(s) sincronizado(s) a Drive`, 'success');
    updateSyncUI('online');

  } catch (err) {
    console.error('Error de sincronización:', err);
    showToast('Error al sincronizar. Intente manualmente.', 'error');
    updateSyncUI('online');

    // Token expirado → limpiar para forzar nuevo login
    if (err.message && err.message.includes('401')) {
      State.driveToken = null;
    }
  } finally {
    State.isSyncing = false;
  }
}

/* ══════════════════════════════════════════════════════════
   RENDERIZADO UI
   ══════════════════════════════════════════════════════════ */
function renderRecordsList() {
  const container  = document.getElementById('records-list');
  const searchVal  = (document.getElementById('search-input')?.value || '').toLowerCase();

  let filtered = State.records;
  if (searchVal) {
    filtered = State.records.filter(r =>
      (r.beneficiario || '').toLowerCase().includes(searchVal) ||
      (r.codigo_proyecto || '').toLowerCase().includes(searchVal) ||
      (r.nro_bono || '').toLowerCase().includes(searchVal)
    );
  }

  // Más recientes primero
  filtered.sort((a, b) => new Date(b._modified) - new Date(a._modified));

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📋</div>
        <h3>${searchVal ? 'Sin resultados' : 'Sin registros'}</h3>
        <p>${searchVal ? 'Pruebe con otro término' : 'Cree un nuevo registro con el botón "+"'}</p>
      </div>`;
    return;
  }

  container.innerHTML = '';
  filtered.forEach(record => {
    const card = document.createElement('div');
    card.className = 'record-card' + (State.currentRecord?._id === record._id ? ' active' : '');
    card.innerHTML = `
      <div class="record-card-code">${escapeHtml(record.codigo_proyecto || 'Sin código')}</div>
      <div class="record-card-name">${escapeHtml(record.beneficiario || 'Sin beneficiario')}</div>
      <div class="record-card-meta">
        <span>${escapeHtml(record.fecha_visita || '')}</span>
        <span class="badge ${record._synced ? 'badge-synced' : 'badge-pending'}">
          ${record._synced ? '✓ Sync' : '⏳ Local'}
        </span>
        ${record.cumple_objetivo ? `<span class="badge badge-${record.cumple_objetivo.toLowerCase()}">${record.cumple_objetivo}</span>` : ''}
      </div>
    `;
    card.addEventListener('click', () => {
      loadRecordToForm(record);
      renderRecordsList(); // actualiza clase active
    });
    container.appendChild(card);
  });
}

function updateSyncUI(state) {
  const dot  = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  const btn  = document.getElementById('sync-btn');

  const states = {
    online:  { dot: 'online',  text: 'En línea', btn: 'Sincronizar' },
    offline: { dot: 'offline', text: 'Sin conexión', btn: 'Sin conexión' },
    syncing: { dot: 'syncing', text: 'Sincronizando…', btn: 'Sincronizando…' },
  };

  const s = states[state] || states.offline;
  if (dot)  { dot.className = `status-dot ${s.dot}`; }
  if (text) { text.textContent = s.text; }
  if (btn)  {
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
        class="${state === 'syncing' ? 'spin-anim' : ''}">
        <path d="M23 4v6h-6M1 20v-6h6"/>
        <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
      </svg>
      ${s.btn}`;
    btn.disabled = state === 'syncing' || state === 'offline';
  }
}

function updateCumpleVisual(value) {
  document.querySelectorAll('.cumple-option').forEach(opt => opt.classList.remove('selected'));
  if (value) {
    const selected = document.querySelector(`.cumple-option.${value.toLowerCase()}-opt`);
    if (selected) selected.classList.add('selected');
  }
}

/* ══════════════════════════════════════════════════════════
   TOAST
   ══════════════════════════════════════════════════════════ */
function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = `${icons[type] || ''} ${msg}`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

/* ══════════════════════════════════════════════════════════
   UTILIDADES
   ══════════════════════════════════════════════════════════ */
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(isoString) {
  if (!isoString) return '';
  return new Date(isoString).toLocaleDateString('es-CL');
}

/* ══════════════════════════════════════════════════════════
   INICIALIZACIÓN
   ══════════════════════════════════════════════════════════ */
async function init() {
  // Abrir DB
  State.db      = await openDB();
  State.records = await dbGetAll();

  // Inicializar módulo de cámara
  CameraModule.init(addPhoto);

  // Google Identity Services
  initGoogleAuth();

  // Escuchar eventos de cámara
  window.addEventListener('cnr:toast', (e) => showToast(e.detail.msg, e.detail.type));

  // Conectividad
  window.addEventListener('online',  () => {
    State.isOnline = true;
    updateSyncUI('online');
    triggerSync();
  });
  window.addEventListener('offline', () => {
    State.isOnline = false;
    updateSyncUI('offline');
  });
  updateSyncUI(State.isOnline ? 'online' : 'offline');

  // PWA install prompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    State.installPrompt = e;
    const banner = document.getElementById('install-banner');
    if (banner) banner.classList.add('visible');
  });

  // Renderizar lista inicial
  renderRecordsList();

  // Eventos del formulario
  bindFormEvents();
}

function bindFormEvents() {
  // Nuevo registro
  document.getElementById('new-record-btn')?.addEventListener('click', () => {
    State.currentRecord = createEmptyRecord();
    State.records.push(State.currentRecord);
    loadRecordToForm(State.currentRecord);
    renderRecordsList();
  });

  // Guardar
  document.getElementById('save-btn')?.addEventListener('click', saveCurrentRecord);

  // Exportar JSON
  document.getElementById('export-json-btn')?.addEventListener('click', () => {
    if (State.currentRecord) {
      collectFormValues();
      exportJSON(State.currentRecord);
    }
  });

  // Exportar CSV
  document.getElementById('export-csv-btn')?.addEventListener('click', () => {
    if (State.currentRecord) {
      collectFormValues();
      exportCSV(State.currentRecord);
    }
  });

  // Sync manual
  document.getElementById('sync-btn')?.addEventListener('click', triggerSync);

  // Búsqueda
  document.getElementById('search-input')?.addEventListener('input', renderRecordsList);

  // GPS
  document.getElementById('gps-btn')?.addEventListener('click', getGeoLocation);

  // Cámara
  document.getElementById('camera-btn')?.addEventListener('click', () => {
    if (!State.currentRecord) { showToast('Primero guarde o cree un registro', 'error'); return; }
    CameraModule.captureFromCamera((State.currentRecord.fotos || []).length);
  });

  // Galería
  document.getElementById('gallery-btn')?.addEventListener('click', () => {
    if (!State.currentRecord) { showToast('Primero guarde o cree un registro', 'error'); return; }
    CameraModule.selectFromGallery((State.currentRecord.fotos || []).length);
  });

  // Cumple objetivo
  document.querySelectorAll('.cumple-option').forEach(opt => {
    opt.addEventListener('click', () => {
      const input = opt.querySelector('input[type="radio"]');
      if (input) {
        input.checked = true;
        updateCumpleVisual(input.value);
      }
    });
  });

  // Listas dinámicas — botones agregar ítem
  document.getElementById('add-antecedente')?.addEventListener('click', () => {
    const container = document.getElementById('antecedentes-list');
    addDynamicItem(container);
  });

  document.getElementById('add-obs-general')?.addEventListener('click', () => {
    const container = document.getElementById('obs-generales-list');
    addDynamicItem(container);
  });

  // Install PWA
  document.getElementById('install-btn')?.addEventListener('click', async () => {
    if (State.installPrompt) {
      State.installPrompt.prompt();
      const result = await State.installPrompt.userChoice;
      if (result.outcome === 'accepted') {
        document.getElementById('install-banner')?.classList.remove('visible');
      }
    }
  });
}

/* ── Arranque ────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', init);
