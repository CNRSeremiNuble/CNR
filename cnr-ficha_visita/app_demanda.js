/**
 * app_demanda.js — Lógica principal Ficha Visita Terreno CNR
 * IndexedDB compartida · Exportación JSON/CSV · Google Drive OAuth2
 * v2.0 — Agrega módulo de croquis con dibujo sobre imagen
 */

'use strict';

/* ══════════════════════════════════════════════════════════
   CONFIGURACIÓN
   ══════════════════════════════════════════════════════════ */
const CONFIG = {
  GOOGLE_CLIENT_ID:  '353831203919-9uf4jmk8he5df4dvvpdoq0dle1jmeiju.apps.googleusercontent.com',
  DRIVE_FOLDER_NAME: 'CNR_Demanda',
  DB_NAME:           'cnr_seguimiento',
  DB_VERSION:        2,
  STORE_NAME:        'registros_demanda',
  TIPO_FICHA:        'Visita Terreno CNR',
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
  firmaData:     null,
  firmaModified: false,
  foto:          null,
  croquis:       null,  // { dataUrl, timestamp }
};

/* ══════════════════════════════════════════════════════════
   MODELO DE DATOS
   ══════════════════════════════════════════════════════════ */
function createEmptyRecord() {
  const today = dateToISO(new Date());
  const id    = generateId();
  return {
    _id:              id,
    _created:         new Date().toISOString(),
    _modified:        new Date().toISOString(),
    _modified_count:  0,
    _synced:          false,
    _syncedAt:        null,
    tipo_ficha:       CONFIG.TIPO_FICHA,

    fecha_visita:            today,
    codigo_vinculado:        '',
    nombre:                  '',
    rut:                     '',
    telefono:                '',
    email:                   '',
    n_grupo_familiar:        '',
    otros_datos:             '',
    region:                  'Ñuble',
    provincia:               '',
    comuna:                  '',
    sector:                  '',
    genero:                  '',
    pueblos_originarios:     '',
    cual_pueblo:             '',
    aporte_tipos:            [],
    aporte_otro_desc:        '',
    pct_aporte:              '',
    interes_programa:        '',
    firma_data:              null,
    no_firma:                false,

    viv_norte:  '', viv_este:  '', viv_datum: 'WGS84', viv_huso:  '19',

    tipo_fuente_agua:        '',
    cap_norte:  '', cap_este:  '', cap_datum: 'WGS84', cap_huso:  '19',
    proy_norte: '', proy_este: '', proy_datum:'WGS84', proy_huso: '19',
    caracteristicas_fuente:  '',
    obs_fuente:              '',

    tipo_tenencia_tierra:    '',
    docs_tierra:             false,
    tipo_tenencia_agua:      '',
    docs_agua:               false,
    obs_tenencia:            '',

    cultivo_actual:          '', cultivo_proyecto:  '',
    superficie_actual:       '', superficie_proyecto: '',
    metodo_actual:           '', metodo_proyecto:   '',
    meses_actual:            '', meses_proyecto:    '',
    obras_actual:            '', obras_proyecto:    '',
    obs_caudal:              '',

    energia_tipos:           [],
    red_electrica_disp:      '',
    energia_desc:            '',

    indap_participa:         '',
    indap_acreditado:        '',
    inicio_actividades:      '',
    incluye_iva:             '',
    con_consultor:           '',
    nombre_consultor:        '',

    nombre_encuestador:      '',
    cargo_encuestador:       '',
    contacto_encuestador:    '',

    observaciones_generales: '',

    foto:    null,
    croquis: null,  // { dataUrl, timestamp }
  };
}

function generateId() {
  const now  = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
  const rand = Math.random().toString(36).slice(2,10).toUpperCase();
  return `VT-${date}-${rand}`;
}

/* ══════════════════════════════════════════════════════════
   UTILIDADES DE FECHA
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
function formatDateShort(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('es-CL',{
      day:'2-digit', month:'2-digit', year:'numeric',
      hour:'2-digit', minute:'2-digit'
    });
  } catch { return iso; }
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
        store.createIndex('nombre',  'nombre',  { unique: false });
        store.createIndex('rut',     'rut',     { unique: false });
        store.createIndex('_synced', '_synced', { unique: false });
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
function dbDelete(id) {
  return new Promise((resolve, reject) => {
    const tx  = State.db.transaction(CONFIG.STORE_NAME, 'readwrite');
    const req = tx.objectStore(CONFIG.STORE_NAME).delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });
}

/* ══════════════════════════════════════════════════════════
   RECOLECTAR VALORES DEL FORMULARIO
   ══════════════════════════════════════════════════════════ */
function collectFormValues() {
  const r = State.currentRecord;
  if (!r) return;

  const simpleFields = [
    'codigo_vinculado','nombre','rut','telefono','email',
    'n_grupo_familiar','otros_datos','sector',
    'tipo_fuente_agua','caracteristicas_fuente','obs_fuente',
    'tipo_tenencia_tierra','tipo_tenencia_agua','obs_tenencia',
    'cultivo_actual','cultivo_proyecto',
    'superficie_actual','superficie_proyecto',
    'metodo_actual','metodo_proyecto',
    'meses_actual','meses_proyecto',
    'obras_actual','obras_proyecto','obs_caudal',
    'energia_desc','nombre_consultor',
    'nombre_encuestador','cargo_encuestador','contacto_encuestador',
    'observaciones_generales','aporte_otro_desc',
    'viv_norte','viv_este','viv_huso',
    'cap_norte','cap_este','cap_huso',
    'proy_norte','proy_este','proy_huso',
  ];
  simpleFields.forEach(field => {
    const el = document.getElementById(`f_${field}`);
    if (el) r[field] = el.value.trim();
  });

  const provEl = document.getElementById('f_provincia');
  const comEl  = document.getElementById('f_comuna');
  if (provEl) r.provincia = provEl.value;
  if (comEl)  r.comuna    = comEl.value;

  ['viv','cap','proy'].forEach(pfx => {
    const el = document.getElementById(`f_${pfx}_huso`);
    if (el) r[`${pfx}_huso`] = el.value;
  });

  const fechaEl = document.getElementById('f_fecha_visita');
  if (fechaEl) r.fecha_visita = displayToISO(fechaEl.value.trim());

  const radioFields = [
    'genero','pueblos_originarios','pct_aporte','interes_programa',
    'red_electrica_disp','indap_participa','indap_acreditado',
    'inicio_actividades','incluye_iva','con_consultor',
  ];
  radioFields.forEach(name => {
    const checked = document.querySelector(`input[name="${name}"]:checked`);
    r[name] = checked ? checked.value : '';
  });

  const cualpuebloEl = document.getElementById('f_cual_pueblo');
  if (cualpuebloEl) r.cual_pueblo = cualpuebloEl.value.trim();

  r.aporte_tipos = Array.from(
    document.querySelectorAll('input[name="aporte"]:checked')
  ).map(cb => cb.value);

  r.energia_tipos = Array.from(
    document.querySelectorAll('input[name="energia"]:checked')
  ).map(cb => cb.value);

  r.docs_tierra = document.getElementById('cb_docs_tierra')?.checked || false;
  r.docs_agua   = document.getElementById('cb_docs_agua')?.checked   || false;
  r.no_firma    = document.getElementById('cb_no_firma')?.checked    || false;

  if (State.firmaModified) r.firma_data = State.firmaData;

  r.foto    = State.foto;
  r.croquis = State.croquis;

  const captionEl = document.getElementById('f_foto_caption');
  if (captionEl && r.foto) r.foto.caption = captionEl.value.trim();
}

/* ══════════════════════════════════════════════════════════
   CARGAR REGISTRO AL FORMULARIO
   ══════════════════════════════════════════════════════════ */
function loadRecordToForm(record) {
  State.currentRecord = JSON.parse(JSON.stringify(record));
  State.firmaData     = record.firma_data || null;
  State.firmaModified = false;
  State.foto          = record.foto    || null;
  State.croquis       = record.croquis || null;

  const simpleFields = [
    'codigo_vinculado','nombre','rut','telefono','email',
    'n_grupo_familiar','otros_datos','sector',
    'tipo_fuente_agua','caracteristicas_fuente','obs_fuente',
    'tipo_tenencia_tierra','tipo_tenencia_agua','obs_tenencia',
    'cultivo_actual','cultivo_proyecto',
    'superficie_actual','superficie_proyecto',
    'metodo_actual','metodo_proyecto',
    'meses_actual','meses_proyecto',
    'obras_actual','obras_proyecto','obs_caudal',
    'energia_desc','nombre_consultor',
    'nombre_encuestador','cargo_encuestador','contacto_encuestador',
    'observaciones_generales','aporte_otro_desc',
    'viv_norte','viv_este','cap_norte','cap_este','proy_norte','proy_este',
  ];
  simpleFields.forEach(field => {
    const el = document.getElementById(`f_${field}`);
    if (el) el.value = record[field] || '';
  });

  const fechaEl = document.getElementById('f_fecha_visita');
  if (fechaEl) fechaEl.value = isoToDisplay(record.fecha_visita || '');

  const provEl = document.getElementById('f_provincia');
  if (provEl && record.provincia) {
    provEl.value = record.provincia;
    if (window.updateComunasDemanda) window.updateComunasDemanda(record.provincia);
  }
  setTimeout(() => {
    const comEl = document.getElementById('f_comuna');
    if (comEl && record.comuna) comEl.value = record.comuna;
  }, 60);

  ['viv','cap','proy'].forEach(pfx => {
    const el = document.getElementById(`f_${pfx}_huso`);
    if (el && record[`${pfx}_huso`]) el.value = record[`${pfx}_huso`];
  });

  const radioFields = [
    'genero','pueblos_originarios','pct_aporte','interes_programa',
    'red_electrica_disp','indap_participa','indap_acreditado',
    'inicio_actividades','incluye_iva','con_consultor',
  ];
  radioFields.forEach(name => {
    document.querySelectorAll(`input[name="${name}"]`).forEach(r => {
      r.checked = (r.value === record[name]);
    });
  });

  const grupoPueblo    = document.getElementById('grupo-cual-pueblo');
  const grupoConsultor = document.getElementById('grupo-consultor');
  if (grupoPueblo)    grupoPueblo.style.display    = record.pueblos_originarios === 'Sí' ? 'flex' : 'none';
  if (grupoConsultor) grupoConsultor.style.display  = record.con_consultor       === 'Sí' ? 'flex' : 'none';

  document.querySelectorAll('input[name="aporte"]').forEach(cb => {
    cb.checked = (record.aporte_tipos || []).includes(cb.value);
  });
  document.querySelectorAll('input[name="energia"]').forEach(cb => {
    cb.checked = (record.energia_tipos || []).includes(cb.value);
  });

  const cbDocsTierra = document.getElementById('cb_docs_tierra');
  const cbDocsAgua   = document.getElementById('cb_docs_agua');
  const cbNoFirma    = document.getElementById('cb_no_firma');
  if (cbDocsTierra) cbDocsTierra.checked = !!record.docs_tierra;
  if (cbDocsAgua)   cbDocsAgua.checked   = !!record.docs_agua;
  if (cbNoFirma)    cbNoFirma.checked    = !!record.no_firma;

  loadFirmaToCanvas(record.firma_data, record.no_firma);
  renderFoto();
  renderCroquis();

  const idDisplay = document.getElementById('record-id-display');
  if (idDisplay) {
    const modCount = record._modified_count || 0;
    const modLabel = modCount > 1
      ? `<span class="mod-indicator">✱ Mod. ${modCount - 1}x · ${formatDateShort(record._modified)}</span>`
      : '';
    const syncLabel = record._synced ? '✓ Sync' : '⏳ Local';
    idDisplay.innerHTML = `<span style="opacity:.6">${record._id}</span> ${modLabel} <span>${syncLabel}</span>`;
  }

  document.getElementById('no-record-msg').style.display = 'none';
  document.getElementById('form-wrapper').style.display  = 'flex';

  // Actualizar etiqueta botón descartar/cerrar
  const discardLabel = document.getElementById('discard-btn-label');
  if (discardLabel) {
    discardLabel.textContent = (record._modified_count === 0) ? 'Descartar' : 'Cerrar';
  }
}

/* ══════════════════════════════════════════════════════════
   GUARDAR REGISTRO
   ══════════════════════════════════════════════════════════ */
async function saveCurrentRecord() {
  if (!State.currentRecord) return;
  collectFormValues();
  const r = State.currentRecord;

  if (!r.rut || r.rut.trim() === '') {
    document.getElementById('modal-warn-rut')?.classList.add('open');
    return;
  }
  if (!r.firma_data && !r.no_firma) {
    document.getElementById('modal-warn-firma')?.classList.add('open');
    return;
  }
  await _doSave();
}

async function _doSave() {
  const r = State.currentRecord;
  const isFirstSave = r._modified_count === 0;
  r._modified       = new Date().toISOString();
  r._modified_count = (r._modified_count || 0) + 1;
  r._synced         = false;
  await dbPut(r);
  State.records = await dbGetAll();
  renderRecordsList();
  if (State.isOnline) triggerSync();
  if (isFirstSave) showPostSaveModal();
  else showToast('Ficha actualizada ✓', 'success');

  // Actualizar etiqueta a "Cerrar" tras primer guardado
  const discardLabel = document.getElementById('discard-btn-label');
  if (discardLabel) discardLabel.textContent = 'Cerrar';
}

/* ══════════════════════════════════════════════════════════
   ELIMINAR REGISTRO
   ══════════════════════════════════════════════════════════ */
let _pendingDeleteRecord = null;

function showDeleteConfirm(record) {
  _pendingDeleteRecord = record;
  const modal  = document.getElementById('modal-confirm-delete');
  const nameEl = document.getElementById('modal-delete-name');
  if (nameEl) nameEl.textContent = `${record._id} — ${record.nombre || 'Sin nombre'}`;
  if (modal)  modal.classList.add('open');
}

async function deleteRecord(record) {
  await dbDelete(record._id);
  State.records = State.records.filter(r => r._id !== record._id);

  if (record._synced && State.isOnline) {
    try {
      const token = State.driveToken || await requestDriveToken();
      await markDeletedInDrive(token, record);
    } catch (err) {
      console.warn('No se pudo marcar eliminado en Drive:', err);
    }
  }

  if (State.currentRecord && State.currentRecord._id === record._id) {
    State.currentRecord = null;
    State.firmaData     = null;
    State.foto          = null;
    State.croquis       = null;
    document.getElementById('no-record-msg').style.display = 'flex';
    document.getElementById('form-wrapper').style.display  = 'none';
    document.getElementById('action-bar').style.display    = 'none';
  }

  renderRecordsList();
  showToast('Ficha eliminada', 'success');
}

async function markDeletedInDrive(token, record) {
  const rootId    = await driveGetOrCreateFolder(token, CONFIG.DRIVE_FOLDER_NAME);
  const projectId = await driveGetOrCreateFolder(token, record._id, rootId);
  const csv = buildCSV([Object.assign({}, record, {
    _deleted: true, _deletedAt: new Date().toISOString()
  })]);
  await driveUploadFile(token, projectId,
    `ELIMINADO_${record._id}_visita.csv`,
    new Blob([csv], { type: 'text/csv;charset=utf-8;' }), 'text/csv');
}

/* ══════════════════════════════════════════════════════════
   FIRMA DEL AGRICULTOR
   ══════════════════════════════════════════════════════════ */
let _firmaCanvas  = null;
let _firmaCtx     = null;
let _firmaDrawing = false;
let _firmaHasData = false;

function initFirmaCanvas() {
  _firmaCanvas = document.getElementById('firma-canvas');
  if (!_firmaCanvas) return;
  _firmaCtx = _firmaCanvas.getContext('2d');
  _firmaCtx.strokeStyle = '#1a1a2e';
  _firmaCtx.lineWidth   = 2;
  _firmaCtx.lineCap     = 'round';
  _firmaCtx.lineJoin    = 'round';

  _firmaCanvas.addEventListener('pointerdown', _firmaStart, { passive: false });
  _firmaCanvas.addEventListener('pointermove', _firmaMove,  { passive: false });
  _firmaCanvas.addEventListener('pointerup',   _firmaEnd);
  _firmaCanvas.addEventListener('pointerout',  _firmaEnd);
}

function _getCanvasPos(canvas, e) {
  const rect   = canvas.getBoundingClientRect();
  const scaleX = canvas.width  / rect.width;
  const scaleY = canvas.height / rect.height;
  return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
}

function _firmaStart(e) {
  if (document.getElementById('cb_no_firma')?.checked) return;
  e.preventDefault();
  _firmaDrawing = true;
  const pos = _getCanvasPos(_firmaCanvas, e);
  _firmaCtx.beginPath();
  _firmaCtx.moveTo(pos.x, pos.y);
  _firmaCanvas.setPointerCapture(e.pointerId);
}
function _firmaMove(e) {
  if (!_firmaDrawing) return;
  e.preventDefault();
  const pos = _getCanvasPos(_firmaCanvas, e);
  _firmaCtx.lineTo(pos.x, pos.y);
  _firmaCtx.stroke();
  _firmaHasData = true;
  document.getElementById('firma-canvas-wrap')?.classList.add('tiene-firma');
  document.getElementById('firma-placeholder')?.classList.add('hidden');
}
function _firmaEnd() {
  if (!_firmaDrawing) return;
  _firmaDrawing = false;
  if (_firmaHasData) {
    State.firmaData     = _firmaCanvas.toDataURL('image/png');
    State.firmaModified = true;
    if (State.currentRecord) State.currentRecord.firma_data = State.firmaData;
  }
}
function clearFirma() {
  if (!_firmaCanvas || !_firmaCtx) return;
  _firmaCtx.clearRect(0, 0, _firmaCanvas.width, _firmaCanvas.height);
  _firmaHasData       = false;
  State.firmaData     = null;
  State.firmaModified = true;
  if (State.currentRecord) State.currentRecord.firma_data = null;
  const wrap = document.getElementById('firma-canvas-wrap');
  const ph   = document.getElementById('firma-placeholder');
  if (wrap) { wrap.classList.remove('tiene-firma'); wrap.classList.remove('no-firma-marcada'); }
  if (ph)   ph.classList.remove('hidden');
}
function loadFirmaToCanvas(dataUrl, noFirma) {
  if (!_firmaCanvas || !_firmaCtx) return;
  _firmaCtx.clearRect(0, 0, _firmaCanvas.width, _firmaCanvas.height);
  _firmaHasData = false;
  const wrap = document.getElementById('firma-canvas-wrap');
  const ph   = document.getElementById('firma-placeholder');
  if (noFirma) {
    if (wrap) { wrap.classList.remove('tiene-firma'); wrap.classList.add('no-firma-marcada'); }
    if (ph)   ph.classList.add('hidden');
    return;
  }
  if (wrap) wrap.classList.remove('no-firma-marcada');
  if (dataUrl) {
    const img = new Image();
    img.onload = () => {
      _firmaCtx.drawImage(img, 0, 0);
      _firmaHasData = true;
      if (wrap) wrap.classList.add('tiene-firma');
      if (ph)   ph.classList.add('hidden');
    };
    img.src = dataUrl;
  } else {
    if (wrap) wrap.classList.remove('tiene-firma');
    if (ph)   ph.classList.remove('hidden');
  }
}
function handleNoFirmaToggle(checked) {
  const wrap = document.getElementById('firma-canvas-wrap');
  if (checked) {
    if (wrap) { wrap.classList.add('no-firma-marcada'); wrap.classList.remove('tiene-firma'); }
    _firmaCtx?.clearRect(0, 0, _firmaCanvas?.width, _firmaCanvas?.height);
    _firmaHasData   = false;
    State.firmaData = null;
    if (State.currentRecord) { State.currentRecord.firma_data = null; State.currentRecord.no_firma = true; }
  } else {
    if (wrap) wrap.classList.remove('no-firma-marcada');
    if (State.currentRecord) State.currentRecord.no_firma = false;
  }
}

/* ══════════════════════════════════════════════════════════
   FOTO ÚNICA DE REFERENCIA
   ══════════════════════════════════════════════════════════ */
const MAX_WIDTH_IMG = 1280;
const QUALITY_IMG   = 0.75;
const MAX_KB_IMG    = 400;

function captureFoto(fromCamera) {
  const input    = document.createElement('input');
  input.type     = 'file';
  input.accept   = 'image/*';
  if (fromCamera) input.capture = 'environment';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const foto = await processImage(file);
      State.foto = foto;
      if (State.currentRecord) State.currentRecord.foto = foto;
      renderFoto();
      showToast(`Foto agregada (${foto.sizeKB} KB)`, 'success');
    } catch (err) {
      showToast('Error al procesar la foto', 'error');
    }
  };
  input.click();
}

async function processImage(file, maxKB = MAX_KB_IMG) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > MAX_WIDTH_IMG || height > MAX_WIDTH_IMG) {
          if (width >= height) { height = Math.round(height * (MAX_WIDTH_IMG/width)); width = MAX_WIDTH_IMG; }
          else                 { width  = Math.round(width  * (MAX_WIDTH_IMG/height)); height = MAX_WIDTH_IMG; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        let quality = QUALITY_IMG;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        let sizeKB  = Math.round((dataUrl.length * 3/4) / 1024);
        while (sizeKB > maxKB && quality > 0.3) {
          quality -= 0.1;
          dataUrl  = canvas.toDataURL('image/jpeg', quality);
          sizeKB   = Math.round((dataUrl.length * 3/4) / 1024);
        }
        resolve({ dataUrl, caption: '', sizeKB, timestamp: new Date().toISOString() });
      };
      img.onerror = () => reject(new Error('No se pudo cargar imagen'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('No se pudo leer archivo'));
    reader.readAsDataURL(file);
  });
}

function renderFoto() {
  const empty    = document.getElementById('foto-empty');
  const preview  = document.getElementById('foto-preview');
  const img      = document.getElementById('foto-img');
  const captionEl= document.getElementById('f_foto_caption');
  const wrap     = document.getElementById('foto-referencia-wrap');
  if (!State.foto) {
    if (empty)   empty.style.display   = 'flex';
    if (preview) preview.style.display = 'none';
    if (wrap)    wrap.style.border = '2px dashed var(--gray-300)';
    return;
  }
  if (empty)    empty.style.display   = 'none';
  if (preview)  preview.style.display = 'block';
  if (img)      img.src = State.foto.dataUrl;
  if (captionEl) captionEl.value = State.foto.caption || '';
  if (wrap)     wrap.style.border = '2px solid var(--cnr-green)';
}

function removeFoto() {
  State.foto = null;
  if (State.currentRecord) State.currentRecord.foto = null;
  renderFoto();
}

/* ══════════════════════════════════════════════════════════
   MÓDULO CROQUIS — DIBUJO SOBRE IMAGEN
   ══════════════════════════════════════════════════════════ */
const Croquis = (() => {
  let _canvas      = null;
  let _ctx         = null;
  let _bgImage     = null;   // Image object del fondo
  let _tool        = 'pen';  // 'pen' | 'line'
  let _color       = '#000000';
  let _lineWidth   = 3;
  let _drawing     = false;
  let _startX      = 0;
  let _startY      = 0;
  let _snapshot    = null;   // ImageData para preview de línea recta
  let _history     = [];     // stack de estados para deshacer
  const MAX_HISTORY = 20;

  function init() {
    _canvas = document.getElementById('croquis-canvas');
    if (!_canvas) return;
    _ctx = _canvas.getContext('2d');

    _canvas.addEventListener('pointerdown', _onDown,   { passive: false });
    _canvas.addEventListener('pointermove', _onMove,   { passive: false });
    _canvas.addEventListener('pointerup',   _onUp,     { passive: false });
    _canvas.addEventListener('pointerout',  _onCancel, { passive: false });
  }

  function _getPos(e) {
    const rect   = _canvas.getBoundingClientRect();
    const scaleX = _canvas.width  / rect.width;
    const scaleY = _canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function _onDown(e) {
    e.preventDefault();
    _drawing = true;
    const pos = _getPos(e);
    _startX = pos.x;
    _startY = pos.y;
    _canvas.setPointerCapture(e.pointerId);

    if (_tool === 'pen') {
      _saveHistory();
      _ctx.beginPath();
      _ctx.moveTo(pos.x, pos.y);
    } else if (_tool === 'line') {
      _snapshot = _ctx.getImageData(0, 0, _canvas.width, _canvas.height);
    }
  }

  function _onMove(e) {
    if (!_drawing) return;
    e.preventDefault();
    const pos = _getPos(e);

    if (_tool === 'pen') {
      _ctx.strokeStyle = _color;
      _ctx.lineWidth   = _lineWidth;
      _ctx.lineCap     = 'round';
      _ctx.lineJoin    = 'round';
      _ctx.lineTo(pos.x, pos.y);
      _ctx.stroke();
    } else if (_tool === 'line') {
      // Restaurar snapshot para preview limpio
      _ctx.putImageData(_snapshot, 0, 0);
      _ctx.beginPath();
      _ctx.strokeStyle = _color;
      _ctx.lineWidth   = _lineWidth;
      _ctx.lineCap     = 'round';
      _ctx.moveTo(_startX, _startY);
      _ctx.lineTo(pos.x, pos.y);
      _ctx.stroke();
    }
  }

  function _onUp(e) {
    if (!_drawing) return;
    e.preventDefault();
    _drawing = false;

    if (_tool === 'line') {
      _saveHistory();
      const pos = _getPos(e);
      _ctx.putImageData(_snapshot, 0, 0);
      _ctx.beginPath();
      _ctx.strokeStyle = _color;
      _ctx.lineWidth   = _lineWidth;
      _ctx.lineCap     = 'round';
      _ctx.moveTo(_startX, _startY);
      _ctx.lineTo(pos.x, pos.y);
      _ctx.stroke();
      _snapshot = null;
    }
  }

  function _onCancel(e) {
    if (_drawing && _tool === 'line' && _snapshot) {
      _ctx.putImageData(_snapshot, 0, 0);
      _snapshot = null;
    }
    _drawing = false;
  }

  function _saveHistory() {
    _history.push(_ctx.getImageData(0, 0, _canvas.width, _canvas.height));
    if (_history.length > MAX_HISTORY) _history.shift();
  }

  function undo() {
    if (!_history.length) return;
    _ctx.putImageData(_history.pop(), 0, 0);
  }

  function clearDrawing() {
    if (!_canvas || !_ctx) return;
    _history = [];
    _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
    if (_bgImage) _ctx.drawImage(_bgImage, 0, 0, _canvas.width, _canvas.height);
  }

  function clearAll() {
    if (!_canvas || !_ctx) return;
    _history  = [];
    _bgImage  = null;
    _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
    _updateEmptyState(true);
  }

  function setTool(tool) {
    _tool = tool;
    document.querySelectorAll('.croquis-tool-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.tool === tool);
    });
  }

  function setColor(color) {
    _color = color;
    document.querySelectorAll('.croquis-color-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.color === color);
    });
    document.getElementById('croquis-color-indicator')?.style.setProperty('background', color);
  }

  function setLineWidth(w) {
    _lineWidth = w;
    document.querySelectorAll('.croquis-width-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.width === String(w));
    });
  }

  function loadBackground(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        // Ajustar canvas al aspecto de la imagen
        const maxW = _canvas.parentElement.clientWidth || 800;
        const ratio = img.height / img.width;
        _canvas.width  = Math.min(img.width,  maxW);
        _canvas.height = Math.round(_canvas.width * ratio);
        _history  = [];
        _bgImage  = img;
        _ctx.drawImage(img, 0, 0, _canvas.width, _canvas.height);
        _updateEmptyState(false);
        showToast('Imagen cargada. Dibuje sobre ella con el S-Pen.', 'success');
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function _updateEmptyState(isEmpty) {
    const emptyMsg = document.getElementById('croquis-empty');
    const toolbar  = document.getElementById('croquis-toolbar');
    const actions  = document.getElementById('croquis-actions');
    if (emptyMsg) emptyMsg.style.display = isEmpty ? 'flex' : 'none';
    if (toolbar)  toolbar.style.display  = isEmpty ? 'none' : 'flex';
    if (actions)  actions.style.display  = isEmpty ? 'none' : 'flex';
  }

  function getDataUrl() {
    if (!_canvas) return null;
    // Imagen aplanada: fondo + trazos
    return _canvas.toDataURL('image/jpeg', 0.85);
  }

  function loadFromDataUrl(dataUrl) {
    if (!dataUrl || !_canvas) return;
    const img = new Image();
    img.onload = () => {
      _canvas.width  = img.width  || 800;
      _canvas.height = img.height || 600;
      _history = [];
      _bgImage = img;
      _ctx.drawImage(img, 0, 0);
      _updateEmptyState(false);
    };
    img.src = dataUrl;
  }

  return { init, setTool, setColor, setLineWidth, loadBackground, undo, clearDrawing, clearAll, getDataUrl, loadFromDataUrl };
})();

function renderCroquis() {
  if (State.croquis?.dataUrl) {
    Croquis.loadFromDataUrl(State.croquis.dataUrl);
  }
}

function saveCroquis() {
  const dataUrl = Croquis.getDataUrl();
  if (!dataUrl) return;
  State.croquis = { dataUrl, timestamp: new Date().toISOString() };
  if (State.currentRecord) State.currentRecord.croquis = State.croquis;
  showToast('Croquis guardado ✓', 'success');
}

/* ══════════════════════════════════════════════════════════
   GEOLOCALIZACIÓN Y UTM
   ══════════════════════════════════════════════════════════ */
function latLonToUTM(lat, lon) {
  const a=6378137.0, f=1/298.257223563, b=a*(1-f), e2=1-(b*b)/(a*a), k0=0.9996;
  const latR=(lat*Math.PI)/180, lonR=(lon*Math.PI)/180;
  const husoNum = lon >= -72 ? 19 : 18;
  const lonCentral = husoNum === 19 ? -69 : -75;
  const lon0R = (lonCentral * Math.PI) / 180;
  const N=a/Math.sqrt(1-e2*Math.sin(latR)**2), T=Math.tan(latR)**2;
  const C=(e2/(1-e2))*Math.cos(latR)**2, A=Math.cos(latR)*(lonR-lon0R);
  const e4=e2*e2, e6=e4*e2;
  const M=a*((1-e2/4-3*e4/64-5*e6/256)*latR-(3*e2/8+3*e4/32+45*e6/1024)*Math.sin(2*latR)+(15*e4/256+45*e6/1024)*Math.sin(4*latR)-(35*e6/3072)*Math.sin(6*latR));
  const easting=k0*N*(A+(1-T+C)*A**3/6+(5-18*T+T**2+72*C-58*(e2/(1-e2)))*A**5/120)+500000;
  let northing=k0*(M+N*Math.tan(latR)*(A**2/2+(5-T+9*C+4*C**2)*A**4/24+(61-58*T+T**2+600*C-330*(e2/(1-e2)))*A**6/720));
  if (lat<0) northing+=10000000;
  return { easting, northing, huso: String(husoNum) };
}

function setCoords(target, easting, northing, huso) {
  const prefix = { 'vivienda':'viv', 'captacion':'cap', 'proyecto':'proy' }[target];
  if (!prefix) return;
  const norte  = document.getElementById(`f_${prefix}_norte`);
  const este   = document.getElementById(`f_${prefix}_este`);
  const husoEl = document.getElementById(`f_${prefix}_huso`);
  if (norte)  norte.value  = northing.toFixed(0);
  if (este)   este.value   = easting.toFixed(0);
  if (husoEl) husoEl.value = huso;
  if (State.currentRecord) {
    State.currentRecord[`${prefix}_norte`] = northing.toFixed(0);
    State.currentRecord[`${prefix}_este`]  = easting.toFixed(0);
    State.currentRecord[`${prefix}_huso`]  = huso;
  }
}

function getGPS(target) {
  if (!navigator.geolocation) { showToast('GPS no disponible', 'error'); return; }
  showToast('Obteniendo ubicación GPS…', 'info');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { easting, northing, huso } = latLonToUTM(pos.coords.latitude, pos.coords.longitude);
      setCoords(target, easting, northing, huso);
      showToast(`Coordenadas GPS obtenidas ✓ (Huso ${huso})`, 'success');
    },
    (err) => { showToast('No se pudo obtener la ubicación', 'error'); console.error(err); },
    { enableHighAccuracy: true, timeout: 15000 }
  );
}

async function pasteFromMaps(target) {
  let texto = '';
  try { texto = await navigator.clipboard.readText(); }
  catch { texto = prompt('Pegue las coordenadas de Google Maps (ej: -36.641, -71.943):') || ''; }
  if (!texto) return;
  const match = texto.match(/(-?\d+\.\d+)[,\s]+(-?\d+\.\d+)/);
  if (!match) { showToast('Formato no reconocido. Copie el pin desde Google Maps.', 'error'); return; }
  let lat = parseFloat(match[1]), lon = parseFloat(match[2]);
  if (lat > 0 && lon < 0) { lat = parseFloat(match[2]); lon = parseFloat(match[1]); }
  const { easting, northing, huso } = latLonToUTM(lat, lon);
  setCoords(target, easting, northing, huso);
  showToast(`Coordenadas importadas ✓ (Huso ${huso})`, 'success');
}

/* ══════════════════════════════════════════════════════════
   CONSTRUCCIÓN CSV
   ══════════════════════════════════════════════════════════ */
function csvHeaders() {
  return [
    'Tipo_Ficha','ID_Visita','Fecha_Visita','Codigo_Vinculado',
    'Nombre','RUT','Telefono','Email','N_Grupo_Familiar','Otros_Datos',
    'Region','Provincia','Comuna','Sector',
    'Genero','Pueblos_Originarios','Cual_Pueblo',
    'Aporte_Tipos','Aporte_Otro_Desc','Pct_Aporte',
    'Interes_Programa','No_Firma',
    'Viv_Norte','Viv_Este','Viv_Datum','Viv_Huso',
    'Tipo_Fuente_Agua',
    'Cap_Norte','Cap_Este','Cap_Datum','Cap_Huso',
    'Proy_Norte','Proy_Este','Proy_Datum','Proy_Huso',
    'Caracteristicas_Fuente','Obs_Fuente',
    'Tipo_Tenencia_Tierra','Docs_Tierra',
    'Tipo_Tenencia_Agua','Docs_Agua','Obs_Tenencia',
    'Cultivo_Actual','Cultivo_Proyecto',
    'Superficie_Actual','Superficie_Proyecto',
    'Metodo_Actual','Metodo_Proyecto',
    'Meses_Actual','Meses_Proyecto',
    'Obras_Actual','Obras_Proyecto','Obs_Caudal',
    'Energia_Tipos','Red_Electrica_Disp','Energia_Desc',
    'INDAP_Participa','INDAP_Acreditado',
    'Inicio_Actividades','Incluye_IVA',
    'Con_Consultor','Nombre_Consultor',
    'Nombre_Encuestador','Cargo_Encuestador','Contacto_Encuestador',
    'Observaciones_Generales',
    'Ruta_Foto_Referencia','Pie_Foto_Referencia',
    'Ruta_Croquis',
    'ID_Registro','Fecha_Creacion','Fecha_Modificacion',
    'Veces_Modificado','Sincronizado',
  ];
}

function recordToRow(r) {
  const fotoruta    = r.foto    ? `Fotos\\${r._id}\\foto_referencia.jpg` : '';
  const fotocaption = r.foto    ? (r.foto.caption || '')                 : '';
  const croquiruta  = r.croquis ? `Fotos\\${r._id}\\croquis.jpg`        : '';
  return [
    r.tipo_ficha || CONFIG.TIPO_FICHA, r._id, r.fecha_visita, r.codigo_vinculado || '',
    r.nombre, r.rut, r.telefono, r.email, r.n_grupo_familiar, r.otros_datos,
    r.region, r.provincia, r.comuna, r.sector,
    r.genero, r.pueblos_originarios, r.cual_pueblo,
    (r.aporte_tipos || []).join(' | '), r.aporte_otro_desc, r.pct_aporte,
    r.interes_programa, r.no_firma ? 'SÍ' : 'NO',
    r.viv_norte, r.viv_este, r.viv_datum || 'WGS84', r.viv_huso,
    r.tipo_fuente_agua,
    r.cap_norte, r.cap_este, r.cap_datum || 'WGS84', r.cap_huso,
    r.proy_norte, r.proy_este, r.proy_datum || 'WGS84', r.proy_huso,
    r.caracteristicas_fuente, r.obs_fuente,
    r.tipo_tenencia_tierra, r.docs_tierra ? 'SÍ' : 'NO',
    r.tipo_tenencia_agua, r.docs_agua ? 'SÍ' : 'NO', r.obs_tenencia,
    r.cultivo_actual, r.cultivo_proyecto,
    r.superficie_actual, r.superficie_proyecto,
    r.metodo_actual, r.metodo_proyecto,
    r.meses_actual, r.meses_proyecto,
    r.obras_actual, r.obras_proyecto, r.obs_caudal,
    (r.energia_tipos || []).join(' | '), r.red_electrica_disp, r.energia_desc,
    r.indap_participa, r.indap_acreditado,
    r.inicio_actividades, r.incluye_iva,
    r.con_consultor, r.nombre_consultor,
    r.nombre_encuestador, r.cargo_encuestador, r.contacto_encuestador,
    r.observaciones_generales,
    fotoruta, fotocaption, croquiruta,
    r._id, r._created, r._modified, r._modified_count || 0, r._synced ? 'SÍ' : 'NO',
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
  downloadBlob(new Blob([buildCSV([record])], { type: 'text/csv;charset=utf-8;' }),
    `CNR_${record._id}_visita.csv`);
  showToast('CSV exportado ✓', 'success');
}
function exportAllCSV() {
  if (!State.records.length) { showToast('No hay fichas para exportar', 'error'); return; }
  downloadBlob(new Blob([buildCSV(State.records)], { type: 'text/csv;charset=utf-8;' }),
    `CNR_VisitaTerreno_Todas_${dateToISO(new Date())}.csv`);
  showToast(`${State.records.length} fichas exportadas ✓`, 'success');
}

/* ══════════════════════════════════════════════════════════
   GOOGLE DRIVE
   ══════════════════════════════════════════════════════════ */
function initGoogleAuth() {
  if (document.getElementById('gsi-script-demanda')) return;
  const s = document.createElement('script');
  s.id='gsi-script-demanda'; s.src='https://accounts.google.com/gsi/client';
  s.async=true; s.defer=true; document.head.appendChild(s);
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
  const q = `name='${name}' and mimeType='application/vnd.google-apps.folder'${parentId?` and '${parentId}' in parents`:''} and trashed=false`;
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`,
    { headers: { Authorization: `Bearer ${token}` } });
  const d = await res.json();
  if (d.files?.length) return d.files[0].id;
  const body = { name, mimeType: 'application/vnd.google-apps.folder', ...(parentId && { parents:[parentId] }) };
  const cr = await fetch('https://www.googleapis.com/drive/v3/files',
    { method:'POST', headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json' }, body:JSON.stringify(body) });
  return (await cr.json()).id;
}
async function driveUploadFile(token, folderId, filename, blob, mimeType) {
  const q = `name='${filename}' and '${folderId}' in parents and trashed=false`;
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`,
    { headers: { Authorization: `Bearer ${token}` } });
  const d   = await res.json();
  const eid = d.files?.[0]?.id || null;
  const meta = JSON.stringify({ name:filename, ...(!eid && { parents:[folderId] }) });
  const form = new FormData();
  form.append('metadata', new Blob([meta], { type:'application/json' }));
  form.append('file', blob);
  const url = eid
    ? `https://www.googleapis.com/upload/drive/v3/files/${eid}?uploadType=multipart`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
  return fetch(url, { method: eid?'PATCH':'POST', headers:{ Authorization:`Bearer ${token}` }, body:form });
}

function dataUrlToBlob(dataUrl) {
  const parts = dataUrl.split(',');
  const mime  = parts[0].match(/:(.*?);/)[1];
  const bin   = atob(parts[1]);
  const arr   = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

async function syncRecord(record, token) {
  const rootId    = await driveGetOrCreateFolder(token, CONFIG.DRIVE_FOLDER_NAME);
  const projectId = await driveGetOrCreateFolder(token, record._id, rootId);
  await driveUploadFile(token, projectId, `${record._id}_visita.csv`,
    new Blob([buildCSV([record])], { type:'text/csv;charset=utf-8;' }), 'text/csv');
  const jdata = JSON.parse(JSON.stringify(record));
  jdata.firma_data = jdata.firma_data ? '[firma_presente]' : null;
  if (jdata.foto?.dataUrl)    { jdata.foto    = { ...jdata.foto,    dataUrl: null, ruta: 'foto_referencia.jpg' }; }
  if (jdata.croquis?.dataUrl) { jdata.croquis = { ...jdata.croquis, dataUrl: null, ruta: 'croquis.jpg' }; }
  await driveUploadFile(token, projectId, `${record._id}_visita.json`,
    new Blob([JSON.stringify(jdata, null, 2)], { type:'application/json' }), 'application/json');
  if (record.foto?.dataUrl) {
    await driveUploadFile(token, projectId, 'foto_referencia.jpg',
      dataUrlToBlob(record.foto.dataUrl), 'image/jpeg');
  }
  if (record.croquis?.dataUrl) {
    await driveUploadFile(token, projectId, 'croquis.jpg',
      dataUrlToBlob(record.croquis.dataUrl), 'image/jpeg');
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
      record._synced   = true;
      record._syncedAt = new Date().toISOString();
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
   UI — LISTA DE REGISTROS
   ══════════════════════════════════════════════════════════ */
function renderRecordsList() {
  const container = document.getElementById('records-list');
  const searchVal = (document.getElementById('search-input')?.value || '').toLowerCase();
  let filtered = State.records.filter(r =>
    !searchVal ||
    (r.nombre || '').toLowerCase().includes(searchVal) ||
    (r.rut    || '').toLowerCase().includes(searchVal) ||
    (r._id    || '').toLowerCase().includes(searchVal)
  ).sort((a, b) => new Date(b._modified) - new Date(a._modified));

  const fichasLabel = document.getElementById('mis-fichas-label');
  if (fichasLabel) {
    const total = State.records.length;
    fichasLabel.innerHTML = `Mis Fichas ${total > 0 ? `<span class="count-badge">${total}</span>` : ''}`;
  }

  if (!filtered.length) {
    container.innerHTML = `<div class="empty-state">
      <div style="font-size:2rem;">🌾</div>
      <h3>${searchVal ? 'Sin resultados' : 'Sin fichas'}</h3>
      <p>${searchVal ? 'Pruebe otro término' : 'Cree una ficha con "Nueva Ficha"'}</p>
    </div>`;
    return;
  }

  container.innerHTML = '';
  filtered.forEach(record => {
    const isModified = (record._modified_count || 0) > 1;
    const card = document.createElement('div');
    card.className = 'record-card' + (State.currentRecord?._id === record._id ? ' active' : '');
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
          ${escapeHtml(record._id)}
          ${isModified ? `<span class="mod-star">✱</span>` : ''}
        </div>
        <div class="record-card-name">${escapeHtml(record.nombre || 'Sin nombre')}</div>
        <div class="record-card-meta">
          <span>${isoToDisplay(record.fecha_visita || '')}</span>
          <span class="badge ${record._synced ? 'badge-synced' : 'badge-pending'}">
            ${record._synced ? '✓ Sync' : '⏳ Local'}
          </span>
          ${record.rut ? `<span style="font-size:.72rem;color:var(--gray-500)">RUT: ${escapeHtml(record.rut)}</span>` : ''}
        </div>
      </div>`;
    card.querySelector('.record-card-inner').addEventListener('click', () => {
      if (card.classList.contains('swiping-left')) { card.classList.remove('swiping-left'); return; }
      loadRecordToForm(record);
      renderRecordsList();
    });
    bindSwipeDelete(card, record);
    container.appendChild(card);
  });
}

function bindSwipeDelete(card, record) {
  let startX = 0, startY = 0, isDragging = false, longPressTimer = null;
  card.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX; startY = e.touches[0].clientY; isDragging = false;
    longPressTimer = setTimeout(() => { card.classList.add('press-long'); showDeleteConfirm(record); }, 600);
  }, { passive: true });
  card.addEventListener('touchmove', (e) => {
    clearTimeout(longPressTimer);
    const dx = e.touches[0].clientX - startX, dy = e.touches[0].clientY - startY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
      isDragging = true;
      if (dx < -20) card.classList.add('swiping-left');
      else if (dx > 20) card.classList.remove('swiping-left');
    }
  }, { passive: true });
  card.addEventListener('touchend', (e) => {
    clearTimeout(longPressTimer); card.classList.remove('press-long');
    if (!isDragging) return;
    if (e.changedTouches[0].clientX - startX < -60) {
      card.classList.add('swiping-left');
      card.querySelector('.record-card-delete-bg').addEventListener('click', () => showDeleteConfirm(record), { once: true });
    } else { card.classList.remove('swiping-left'); }
  }, { passive: true });
}

function showPostSaveModal()  { document.getElementById('modal-post-save')?.classList.add('open'); }
function hidePostSaveModal()  { document.getElementById('modal-post-save')?.classList.remove('open'); }

function updateSyncUI(state) {
  const cfg = {
    online:  { dot:'online',  text:'En línea',       btn:'Sincronizar'    },
    offline: { dot:'offline', text:'Sin conexión',   btn:'Sin conexión'   },
    syncing: { dot:'syncing', text:'Sincronizando…', btn:'Sincronizando…' },
  }[state];
  if (!cfg) return;
  const dot  = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  const btn  = document.getElementById('sync-btn');
  if (dot)  dot.className    = `status-dot ${cfg.dot}`;
  if (text) text.textContent = cfg.text;
  if (btn)  {
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      style="${state==='syncing'?'animation:spin 1s linear infinite':''}">
      <path d="M23 4v6h-6M1 20v-6h6"/>
      <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
    </svg>${cfg.btn}`;
    btn.disabled = state === 'syncing' || state === 'offline';
  }
}

function showToast(msg, type = 'info') {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const t = document.createElement('div');
  t.className   = `toast ${type}`;
  t.textContent = `${{ success:'✓', error:'✕', info:'ℹ' }[type] || ''} ${msg}`;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}
function escapeHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ══════════════════════════════════════════════════════════
   VINCULAR EVENTOS
   ══════════════════════════════════════════════════════════ */
function bindEvents() {

  // Nueva ficha
  document.getElementById('new-record-btn')?.addEventListener('click', () => {
    State.currentRecord = createEmptyRecord();
    State.records.push(State.currentRecord);
    loadRecordToForm(State.currentRecord);
    renderRecordsList();
  });

  // Guardar
  document.getElementById('save-btn')?.addEventListener('click', saveCurrentRecord);

  // Exportar
  document.getElementById('export-csv-btn')?.addEventListener('click', () => {
    if (State.currentRecord) exportCSV(State.currentRecord);
  });
  document.getElementById('export-all-csv-btn')?.addEventListener('click', exportAllCSV);

  // Descartar / Cerrar
  document.getElementById('discard-btn')?.addEventListener('click', () => {
    if (!State.currentRecord) return;
    if (State.currentRecord._modified_count === 0) {
      document.getElementById('modal-confirm-discard')?.classList.add('open');
    } else {
      State.currentRecord = null; State.firmaData = null; State.foto = null; State.croquis = null;
      document.getElementById('no-record-msg').style.display = 'flex';
      document.getElementById('form-wrapper').style.display  = 'none';
      document.getElementById('action-bar').style.display    = 'none';
      document.querySelectorAll('.record-card').forEach(c => c.classList.remove('active'));
    }
  });
  document.getElementById('modal-discard-cancel')?.addEventListener('click', () => {
    document.getElementById('modal-confirm-discard')?.classList.remove('open');
  });
  document.getElementById('modal-discard-confirm')?.addEventListener('click', async () => {
    document.getElementById('modal-confirm-discard')?.classList.remove('open');
    if (!State.currentRecord) return;
    await dbDelete(State.currentRecord._id);
    State.records = State.records.filter(r => r._id !== State.currentRecord._id);
    State.currentRecord = null; State.firmaData = null; State.foto = null; State.croquis = null;
    document.getElementById('no-record-msg').style.display = 'flex';
    document.getElementById('form-wrapper').style.display  = 'none';
    document.getElementById('action-bar').style.display    = 'none';
    renderRecordsList();
    showToast('Ficha descartada', 'info');
  });

  // Eliminar
  document.getElementById('delete-btn')?.addEventListener('click', () => {
    if (!State.currentRecord) return;
    showDeleteConfirm(State.currentRecord);
  });
  document.getElementById('modal-delete-cancel')?.addEventListener('click', () => {
    document.getElementById('modal-confirm-delete')?.classList.remove('open');
    _pendingDeleteRecord = null;
    document.querySelectorAll('.record-card.swiping-left').forEach(c => c.classList.remove('swiping-left'));
  });
  document.getElementById('modal-delete-confirm')?.addEventListener('click', async () => {
    document.getElementById('modal-confirm-delete')?.classList.remove('open');
    if (_pendingDeleteRecord) { await deleteRecord(_pendingDeleteRecord); _pendingDeleteRecord = null; }
  });

  // Sincronizar
  document.getElementById('sync-btn')?.addEventListener('click', triggerSync);

  // Búsqueda
  document.getElementById('search-input')?.addEventListener('input', renderRecordsList);

  // Firma
  document.getElementById('firma-clear-btn')?.addEventListener('click', clearFirma);
  document.getElementById('cb_no_firma')?.addEventListener('change', (e) => handleNoFirmaToggle(e.target.checked));

  // Foto
  document.getElementById('foto-camera-btn')?.addEventListener('click', () => {
    if (!State.currentRecord) { showToast('Primero cree o guarde una ficha', 'error'); return; }
    captureFoto(true);
  });
  document.getElementById('foto-gallery-btn')?.addEventListener('click', () => {
    if (!State.currentRecord) { showToast('Primero cree o guarde una ficha', 'error'); return; }
    captureFoto(false);
  });
  document.getElementById('foto-remove-btn')?.addEventListener('click', removeFoto);
  document.getElementById('f_foto_caption')?.addEventListener('input', (e) => {
    if (State.foto) State.foto.caption = e.target.value;
    if (State.currentRecord?.foto) State.currentRecord.foto.caption = e.target.value;
  });

  // GPS / Maps (todos los targets)
  document.querySelectorAll('.btn-gps').forEach(btn => {
    btn.addEventListener('click', () => getGPS(btn.dataset.coordsTarget));
  });
  document.querySelectorAll('.btn-maps').forEach(btn => {
    btn.addEventListener('click', () => pasteFromMaps(btn.dataset.coordsTarget));
  });

  // ── Croquis ──────────────────────────────────────────
  document.getElementById('croquis-import-btn')?.addEventListener('click', () => {
    if (!State.currentRecord) { showToast('Primero cree o guarde una ficha', 'error'); return; }
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = (e) => { if (e.target.files[0]) Croquis.loadBackground(e.target.files[0]); };
    input.click();
  });

  document.querySelectorAll('.croquis-tool-btn').forEach(btn => {
    btn.addEventListener('click', () => Croquis.setTool(btn.dataset.tool));
  });

  document.querySelectorAll('.croquis-color-btn').forEach(btn => {
    btn.addEventListener('click', () => Croquis.setColor(btn.dataset.color));
  });

  document.querySelectorAll('.croquis-width-btn').forEach(btn => {
    btn.addEventListener('click', () => Croquis.setLineWidth(Number(btn.dataset.width)));
  });

  document.getElementById('croquis-undo-btn')?.addEventListener('click',         () => Croquis.undo());
  document.getElementById('croquis-clear-drawing-btn')?.addEventListener('click', () => Croquis.clearDrawing());
  document.getElementById('croquis-clear-all-btn')?.addEventListener('click',    () => {
    Croquis.clearAll();
    State.croquis = null;
    if (State.currentRecord) State.currentRecord.croquis = null;
  });
  document.getElementById('croquis-save-btn')?.addEventListener('click', saveCroquis);

  // Modales post-guardado
  document.getElementById('modal-nueva-ficha')?.addEventListener('click', () => {
    hidePostSaveModal();
    State.currentRecord = createEmptyRecord();
    State.records.push(State.currentRecord);
    loadRecordToForm(State.currentRecord);
    renderRecordsList();
  });
  document.getElementById('modal-ver-registros')?.addEventListener('click', () => {
    hidePostSaveModal();
    if (window.innerWidth <= 900) {
      document.getElementById('records-sidebar')?.classList.add('mobile-visible');
      document.getElementById('sidebar-overlay')?.classList.add('visible');
      document.body.style.overflow = 'hidden';
    }
  });
  document.getElementById('modal-continuar')?.addEventListener('click', hidePostSaveModal);

  // Modales advertencia RUT
  document.getElementById('modal-rut-cancel')?.addEventListener('click', () => {
    document.getElementById('modal-warn-rut')?.classList.remove('open');
    document.getElementById('f_rut')?.focus();
  });
  document.getElementById('modal-rut-confirm')?.addEventListener('click', async () => {
    document.getElementById('modal-warn-rut')?.classList.remove('open');
    const r = State.currentRecord;
    if (!r.firma_data && !r.no_firma) { document.getElementById('modal-warn-firma')?.classList.add('open'); return; }
    await _doSave();
  });

  // Modal advertencia firma
  document.getElementById('modal-firma-cancel')?.addEventListener('click', () => {
    document.getElementById('modal-warn-firma')?.classList.remove('open');
    document.getElementById('firma-canvas')?.scrollIntoView({ behavior:'smooth' });
  });
  document.getElementById('modal-firma-confirm')?.addEventListener('click', async () => {
    document.getElementById('modal-warn-firma')?.classList.remove('open');
    await _doSave();
  });

  // Banner instalación
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); State.installPrompt = e;
    document.getElementById('install-banner')?.classList.add('visible');
  });
  document.getElementById('install-btn')?.addEventListener('click', async () => {
    if (State.installPrompt) {
      State.installPrompt.prompt();
      const r = await State.installPrompt.userChoice;
      if (r.outcome === 'accepted') document.getElementById('install-banner')?.classList.remove('visible');
    }
  });

  // Online/Offline
  window.addEventListener('online',  () => { State.isOnline = true;  updateSyncUI('online');  triggerSync(); });
  window.addEventListener('offline', () => { State.isOnline = false; updateSyncUI('offline'); });
}

/* ══════════════════════════════════════════════════════════
   INICIALIZACIÓN
   ══════════════════════════════════════════════════════════ */
async function init() {
  State.db      = await openDB();
  State.records = await dbGetAll();
  initGoogleAuth();
  initFirmaCanvas();
  Croquis.init();
  Croquis.setTool('pen');
  Croquis.setColor('#000000');
  Croquis.setLineWidth(3);
  bindEvents();
  updateSyncUI(State.isOnline ? 'online' : 'offline');
  renderRecordsList();
}

document.addEventListener('DOMContentLoaded', init);
