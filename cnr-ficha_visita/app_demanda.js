/**
 * app_demanda.js — Lógica principal Ficha Visita Terreno CNR
 * IndexedDB compartida · Exportación JSON/CSV · Google Drive OAuth2
 * v1.0 — Demanda de riego / Ficha visita terreno
 */

'use strict';

/* ══════════════════════════════════════════════════════════
   CONFIGURACIÓN
   ══════════════════════════════════════════════════════════ */
const CONFIG = {
  GOOGLE_CLIENT_ID:  '353831203919-9uf4jmk8he5df4dvvpdoq0dle1jmeiju.apps.googleusercontent.com',
  DRIVE_FOLDER_NAME: 'CNR_Demanda',
  DB_NAME:           'cnr_seguimiento',   // misma BD que ficha de seguimiento
  DB_VERSION:        2,                   // sube de v1 a v2 — agrega store nuevo
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
  firmaData:     null,   // dataURL de la firma actual
  firmaModified: false,  // si el canvas fue tocado
  foto:          null,   // objeto foto única { dataUrl, caption, ... }
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

    // Encabezado
    fecha_visita:            today,
    codigo_vinculado:        '',

    // Contacto
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
    aporte_tipos:            [],   // array: ['Dinero','Bienes comprados',...]
    aporte_otro_desc:        '',
    pct_aporte:              '',
    interes_programa:        '',
    firma_data:              null, // dataURL firma
    no_firma:                false,

    // Coordenadas vivienda
    viv_norte:  '', viv_este:  '', viv_datum: 'WGS84', viv_huso:  '19',

    // Fuente de agua
    tipo_fuente_agua:        '',
    cap_norte:  '', cap_este:  '', cap_datum: 'WGS84', cap_huso:  '19',
    proy_norte: '', proy_este: '', proy_datum:'WGS84', proy_huso: '19',
    caracteristicas_fuente:  '',
    obs_fuente:              '',

    // Derechos de agua y tenencia
    tipo_tenencia_tierra:    '',
    docs_tierra:             false,
    tipo_tenencia_agua:      '',
    docs_agua:               false,
    obs_tenencia:            '',

    // Corroboración de caudal
    cultivo_actual:          '', cultivo_proyecto:  '',
    superficie_actual:       '', superficie_proyecto: '',
    metodo_actual:           '', metodo_proyecto:   '',
    meses_actual:            '', meses_proyecto:    '',
    obras_actual:            '', obras_proyecto:    '',
    obs_caudal:              '',

    // Energía
    energia_tipos:           [], // array de valores seleccionados
    red_electrica_disp:      '',
    energia_desc:            '',

    // Otros datos
    indap_participa:         '',
    indap_acreditado:        '',
    inicio_actividades:      '',
    incluye_iva:             '',
    con_consultor:           '',
    nombre_consultor:        '',

    // Encuestador
    nombre_encuestador:      '',
    cargo_encuestador:       '',
    contacto_encuestador:    '',

    // Observaciones generales
    observaciones_generales: '',

    // Foto única
    foto: null,  // { dataUrl, caption, sizeKB, timestamp }
  };
}

/* Genera código de ficha: VT-YYYYMMDD-XXXXXXXX */
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
   INDEXEDDB — BD COMPARTIDA v2
   ══════════════════════════════════════════════════════════ */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      // El store de seguimiento ya existe (v1) → no se toca
      // Solo crear el nuevo store si no existe
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

  // Campos de texto simples
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

  // Provincia y comuna (select)
  const provEl = document.getElementById('f_provincia');
  const comEl  = document.getElementById('f_comuna');
  if (provEl) r.provincia = provEl.value;
  if (comEl)  r.comuna    = comEl.value;

  // Husos (selects fuera del prefijo f_)
  ['viv','cap','proy'].forEach(pfx => {
    const el = document.getElementById(`f_${pfx}_huso`);
    if (el) r[`${pfx}_huso`] = el.value;
  });

  // Fecha
  const fechaEl = document.getElementById('f_fecha_visita');
  if (fechaEl) r.fecha_visita = displayToISO(fechaEl.value.trim());

  // Radios
  const radioFields = [
    'genero','pueblos_originarios','pct_aporte','interes_programa',
    'red_electrica_disp','indap_participa','indap_acreditado',
    'inicio_actividades','incluye_iva','con_consultor',
  ];
  radioFields.forEach(name => {
    const checked = document.querySelector(`input[name="${name}"]:checked`);
    r[name] = checked ? checked.value : '';
  });

  // Cual pueblo
  const cualpuebloEl = document.getElementById('f_cual_pueblo');
  if (cualpuebloEl) r.cual_pueblo = cualpuebloEl.value.trim();

  // Checkboxes aporte
  r.aporte_tipos = Array.from(
    document.querySelectorAll('input[name="aporte"]:checked')
  ).map(cb => cb.value);

  // Checkboxes energía
  r.energia_tipos = Array.from(
    document.querySelectorAll('input[name="energia"]:checked')
  ).map(cb => cb.value);

  // Checkboxes individuales
  r.docs_tierra = document.getElementById('cb_docs_tierra')?.checked || false;
  r.docs_agua   = document.getElementById('cb_docs_agua')?.checked   || false;
  r.no_firma    = document.getElementById('cb_no_firma')?.checked    || false;

  // Firma
  if (State.firmaModified) {
    r.firma_data = State.firmaData;
  }

  // Foto
  r.foto = State.foto;

  // Caption foto
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
  State.foto          = record.foto || null;

  // Campos simples
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

  // Fecha
  const fechaEl = document.getElementById('f_fecha_visita');
  if (fechaEl) fechaEl.value = isoToDisplay(record.fecha_visita || '');

  // Provincia / Comuna
  const provEl = document.getElementById('f_provincia');
  if (provEl && record.provincia) {
    provEl.value = record.provincia;
    if (window.updateComunasDemanda) window.updateComunasDemanda(record.provincia);
  }
  setTimeout(() => {
    const comEl = document.getElementById('f_comuna');
    if (comEl && record.comuna) comEl.value = record.comuna;
  }, 60);

  // Husos
  ['viv','cap','proy'].forEach(pfx => {
    const el = document.getElementById(`f_${pfx}_huso`);
    if (el && record[`${pfx}_huso`]) el.value = record[`${pfx}_huso`];
  });

  // Radios
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

  // Mostrar/ocultar cual pueblo y consultor
  const grupoPueblo = document.getElementById('grupo-cual-pueblo');
  if (grupoPueblo) grupoPueblo.style.display = record.pueblos_originarios === 'Sí' ? 'flex' : 'none';
  const grupoConsultor = document.getElementById('grupo-consultor');
  if (grupoConsultor) grupoConsultor.style.display = record.con_consultor === 'Sí' ? 'flex' : 'none';

  // Checkboxes aporte
  document.querySelectorAll('input[name="aporte"]').forEach(cb => {
    cb.checked = (record.aporte_tipos || []).includes(cb.value);
  });

  // Checkboxes energía
  document.querySelectorAll('input[name="energia"]').forEach(cb => {
    cb.checked = (record.energia_tipos || []).includes(cb.value);
  });

  // Checkboxes individuales
  const cbDoctTierra = document.getElementById('cb_docs_tierra');
  const cbDocAgua    = document.getElementById('cb_docs_agua');
  const cbNoFirma    = document.getElementById('cb_no_firma');
  if (cbDoctTierra) cbDoctTierra.checked = !!record.docs_tierra;
  if (cbDocAgua)    cbDocAgua.checked    = !!record.docs_agua;
  if (cbNoFirma)    cbNoFirma.checked    = !!record.no_firma;

  // Firma
  loadFirmaToCanvas(record.firma_data, record.no_firma);

  // Foto
  renderFoto();

  // ID Display
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
}

/* ══════════════════════════════════════════════════════════
   GUARDAR REGISTRO
   ══════════════════════════════════════════════════════════ */
async function saveCurrentRecord() {
  if (!State.currentRecord) return;

  // Recolectar valores antes de validar
  collectFormValues();

  const r = State.currentRecord;

  // Validación RUT
  if (!r.rut || r.rut.trim() === '') {
    document.getElementById('modal-warn-rut').classList.add('open');
    return;
  }

  // Validación firma
  if (!r.firma_data && !r.no_firma) {
    document.getElementById('modal-warn-firma').classList.add('open');
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

  if (isFirstSave) {
    showPostSaveModal();
  } else {
    showToast('Ficha actualizada ✓', 'success');
  }
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
  await driveUploadFile(
    token, projectId,
    `ELIMINADO_${record._id}_visita.csv`,
    new Blob([csv], { type: 'text/csv;charset=utf-8;' }),
    'text/csv'
  );
}

/* ══════════════════════════════════════════════════════════
   FIRMA DEL AGRICULTOR
   ══════════════════════════════════════════════════════════ */
let _firmaCanvas   = null;
let _firmaCtx      = null;
let _firmaDrawing  = false;
let _firmaLastX    = 0;
let _firmaLastY    = 0;
let _firmaHasData  = false;

function initFirmaCanvas() {
  _firmaCanvas = document.getElementById('firma-canvas');
  if (!_firmaCanvas) return;
  _firmaCtx = _firmaCanvas.getContext('2d');

  // Configuración del trazo (S-Pen friendly)
  _firmaCtx.strokeStyle = '#1a1a2e';
  _firmaCtx.lineWidth   = 2;
  _firmaCtx.lineCap     = 'round';
  _firmaCtx.lineJoin    = 'round';

  // Pointer events (funciona con touch y S-Pen)
  _firmaCanvas.addEventListener('pointerdown', _firmaStart, { passive: false });
  _firmaCanvas.addEventListener('pointermove', _firmaMove,  { passive: false });
  _firmaCanvas.addEventListener('pointerup',   _firmaEnd);
  _firmaCanvas.addEventListener('pointerout',  _firmaEnd);
}

function _getCanvasPos(e) {
  const rect  = _firmaCanvas.getBoundingClientRect();
  const scaleX = _firmaCanvas.width  / rect.width;
  const scaleY = _firmaCanvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top)  * scaleY,
  };
}

function _firmaStart(e) {
  if (document.getElementById('cb_no_firma')?.checked) return;
  e.preventDefault();
  _firmaDrawing = true;
  const pos = _getCanvasPos(e);
  _firmaLastX = pos.x;
  _firmaLastY = pos.y;
  _firmaCtx.beginPath();
  _firmaCtx.moveTo(pos.x, pos.y);
  _firmaCanvas.setPointerCapture(e.pointerId);
}

function _firmaMove(e) {
  if (!_firmaDrawing) return;
  e.preventDefault();
  const pos = _getCanvasPos(e);
  _firmaCtx.lineTo(pos.x, pos.y);
  _firmaCtx.stroke();
  _firmaLastX = pos.x;
  _firmaLastY = pos.y;
  _firmaHasData = true;

  // Actualizar estado visual
  const wrap = document.getElementById('firma-canvas-wrap');
  const ph   = document.getElementById('firma-placeholder');
  if (wrap) wrap.classList.add('tiene-firma');
  if (ph)   ph.classList.add('hidden');
}

function _firmaEnd() {
  if (!_firmaDrawing) return;
  _firmaDrawing = false;
  if (_firmaHasData) {
    State.firmaData    = _firmaCanvas.toDataURL('image/png');
    State.firmaModified = true;
    if (State.currentRecord) State.currentRecord.firma_data = State.firmaData;
  }
}

function clearFirma() {
  if (!_firmaCanvas || !_firmaCtx) return;
  _firmaCtx.clearRect(0, 0, _firmaCanvas.width, _firmaCanvas.height);
  _firmaHasData  = false;
  State.firmaData = null;
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

  if (wrap) { wrap.classList.remove('no-firma-marcada'); }

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
    if (State.currentRecord) {
      State.currentRecord.firma_data = null;
      State.currentRecord.no_firma   = true;
    }
  } else {
    if (wrap) wrap.classList.remove('no-firma-marcada');
    if (State.currentRecord) State.currentRecord.no_firma = false;
  }
}

/* ══════════════════════════════════════════════════════════
   FOTO ÚNICA DE REFERENCIA
   ══════════════════════════════════════════════════════════ */
const MAX_WIDTH_FOTO = 1280;
const QUALITY_FOTO   = 0.75;
const MAX_KB_FOTO    = 400;

function captureFoto(fromCamera) {
  const input    = document.createElement('input');
  input.type     = 'file';
  input.accept   = 'image/*';
  if (fromCamera) input.capture = 'environment';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const foto = await processFoto(file);
      State.foto = foto;
      if (State.currentRecord) State.currentRecord.foto = foto;
      renderFoto();
      showToast(`Foto agregada (${foto.sizeKB} KB)`, 'success');
    } catch (err) {
      console.error('Error foto:', err);
      showToast('Error al procesar la foto', 'error');
    }
  };
  input.click();
}

async function processFoto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > MAX_WIDTH_FOTO || height > MAX_WIDTH_FOTO) {
          if (width >= height) { height = Math.round(height * (MAX_WIDTH_FOTO/width)); width = MAX_WIDTH_FOTO; }
          else                 { width  = Math.round(width  * (MAX_WIDTH_FOTO/height)); height = MAX_WIDTH_FOTO; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);

        let quality = QUALITY_FOTO;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        let sizeKB  = Math.round((dataUrl.length * 3/4) / 1024);
        while (sizeKB > MAX_KB_FOTO && quality > 0.3) {
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
   GEOLOCALIZACIÓN Y CONVERSIÓN UTM
   ══════════════════════════════════════════════════════════ */
function latLonToUTM(lat, lon) {
  const a=6378137.0, f=1/298.257223563, b=a*(1-f), e2=1-(b*b)/(a*a), k0=0.9996;
  const latR=(lat*Math.PI)/180, lonR=(lon*Math.PI)/180;
  // Determinar huso automáticamente para Ñuble (18 o 19)
  const husoNum = lon >= -72 ? 19 : 18;
  const lonCentral = (husoNum === 19) ? -69 : -75;
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
  const prefix = {
    'vivienda':  'viv',
    'captacion': 'cap',
    'proyecto':  'proy',
  }[target];
  if (!prefix) return;

  const norte = document.getElementById(`f_${prefix}_norte`);
  const este  = document.getElementById(`f_${prefix}_este`);
  const husoEl= document.getElementById(`f_${prefix}_huso`);

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
  try {
    texto = await navigator.clipboard.readText();
  } catch {
    texto = prompt('Pegue las coordenadas de Google Maps (ej: -36.641, -71.943):') || '';
  }
  if (!texto) return;

  const match = texto.match(/(-?\d+\.\d+)[,\s]+(-?\d+\.\d+)/);
  if (!match) {
    showToast('Formato no reconocido. Copie el pin desde Google Maps.', 'error');
    return;
  }
  const lat = parseFloat(match[1]);
  const lon = parseFloat(match[2]);
  let latFinal = lat, lonFinal = lon;
  // Asegurar que lat esté en rango Chile
  if (lat > 0 && lon < 0) { latFinal = lon; lonFinal = lat; }

  const { easting, northing, huso } = latLonToUTM(latFinal, lonFinal);
  setCoords(target, easting, northing, huso);
  showToast(`Coordenadas importadas ✓ (Huso ${huso})`, 'success');
}

/* ══════════════════════════════════════════════════════════
   CONSTRUCCIÓN CSV
   ══════════════════════════════════════════════════════════ */
function csvHeaders() {
  return [
    'Tipo_Ficha','ID_Visita','Fecha_Visita','Codigo_Vinculado',
    // Contacto
    'Nombre','RUT','Telefono','Email','N_Grupo_Familiar','Otros_Datos',
    'Region','Provincia','Comuna','Sector',
    'Genero','Pueblos_Originarios','Cual_Pueblo',
    'Aporte_Tipos','Aporte_Otro_Desc','Pct_Aporte',
    'Interes_Programa','No_Firma',
    // Coordenadas vivienda
    'Viv_Norte','Viv_Este','Viv_Datum','Viv_Huso',
    // Fuente agua
    'Tipo_Fuente_Agua',
    'Cap_Norte','Cap_Este','Cap_Datum','Cap_Huso',
    'Proy_Norte','Proy_Este','Proy_Datum','Proy_Huso',
    'Caracteristicas_Fuente','Obs_Fuente',
    // Derechos
    'Tipo_Tenencia_Tierra','Docs_Tierra',
    'Tipo_Tenencia_Agua','Docs_Agua','Obs_Tenencia',
    // Caudal
    'Cultivo_Actual','Cultivo_Proyecto',
    'Superficie_Actual','Superficie_Proyecto',
    'Metodo_Actual','Metodo_Proyecto',
    'Meses_Actual','Meses_Proyecto',
    'Obras_Actual','Obras_Proyecto','Obs_Caudal',
    // Energía
    'Energia_Tipos','Red_Electrica_Disp','Energia_Desc',
    // Otros
    'INDAP_Participa','INDAP_Acreditado',
    'Inicio_Actividades','Incluye_IVA',
    'Con_Consultor','Nombre_Consultor',
    // Encuestador
    'Nombre_Encuestador','Cargo_Encuestador','Contacto_Encuestador',
    // Observaciones y foto
    'Observaciones_Generales',
    'Ruta_Foto_Referencia','Pie_Foto_Referencia',
    // Metadatos
    'ID_Registro','Fecha_Creacion','Fecha_Modificacion',
    'Veces_Modificado','Sincronizado',
  ];
}

function recordToRow(r) {
  const fotoruta = r.foto
    ? `Fotos\\${r._id}\\foto_referencia.jpg`
    : '';
  const fotocaption = r.foto ? (r.foto.caption || '') : '';

  return [
    r.tipo_ficha || CONFIG.TIPO_FICHA,
    r._id,
    r.fecha_visita,
    r.codigo_vinculado || '',
    r.nombre, r.rut, r.telefono, r.email,
    r.n_grupo_familiar, r.otros_datos,
    r.region, r.provincia, r.comuna, r.sector,
    r.genero, r.pueblos_originarios, r.cual_pueblo,
    (r.aporte_tipos || []).join(' | '),
    r.aporte_otro_desc, r.pct_aporte,
    r.interes_programa,
    r.no_firma ? 'SÍ' : 'NO',
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
    (r.energia_tipos || []).join(' | '),
    r.red_electrica_disp, r.energia_desc,
    r.indap_participa, r.indap_acreditado,
    r.inicio_actividades, r.incluye_iva,
    r.con_consultor, r.nombre_consultor,
    r.nombre_encuestador, r.cargo_encuestador, r.contacto_encuestador,
    r.observaciones_generales,
    fotoruta, fotocaption,
    r._id, r._created, r._modified,
    r._modified_count || 0,
    r._synced ? 'SÍ' : 'NO',
  ];
}

function buildCSV(records) {
  const rows = [csvHeaders(), ...records.map(recordToRow)]
    .map(r => r.map(csvEscape).join(','));
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
    `CNR_${record._id}_visita.csv`
  );
  showToast('CSV exportado ✓', 'success');
}

function exportAllCSV() {
  if (!State.records.length) { showToast('No hay fichas para exportar', 'error'); return; }
  downloadBlob(
    new Blob([buildCSV(State.records)], { type: 'text/csv;charset=utf-8;' }),
    `CNR_VisitaTerreno_Todas_${dateToISO(new Date())}.csv`
  );
  showToast(`${State.records.length} fichas exportadas ✓`, 'success');
}

/* ══════════════════════════════════════════════════════════
   GOOGLE DRIVE
   ══════════════════════════════════════════════════════════ */
function initGoogleAuth() {
  if (document.getElementById('gsi-script-demanda')) return;
  const s = document.createElement('script');
  s.id='gsi-script-demanda'; s.src='https://accounts.google.com/gsi/client';
  s.async=true; s.defer=true;
  document.head.appendChild(s);
}

function requestDriveToken() {
  return new Promise((resolve, reject) => {
    if (!window.google) { reject(new Error('Google Identity Services no cargado')); return; }
    google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      scope: 'https://www.googleapis.com/auth/drive.file',
      callback: (r) => r.error
        ? reject(new Error(r.error))
        : (State.driveToken = r.access_token, resolve(r.access_token)),
    }).requestAccessToken({ prompt: '' });
  });
}

async function driveGetOrCreateFolder(token, name, parentId = null) {
  const q = `name='${name}' and mimeType='application/vnd.google-apps.folder'${parentId?` and '${parentId}' in parents`:''} and trashed=false`;
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const d = await res.json();
  if (d.files?.length) return d.files[0].id;
  const body = { name, mimeType: 'application/vnd.google-apps.folder', ...(parentId && { parents:[parentId] }) };
  const cr = await fetch('https://www.googleapis.com/drive/v3/files',
    { method:'POST', headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json' }, body:JSON.stringify(body) }
  );
  return (await cr.json()).id;
}

async function driveUploadFile(token, folderId, filename, blob, mimeType) {
  // Buscar si ya existe
  const q = `name='${filename}' and '${folderId}' in parents and trashed=false`;
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
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

async function syncRecord(record, token) {
  const rootId    = await driveGetOrCreateFolder(token, CONFIG.DRIVE_FOLDER_NAME);
  const projectId = await driveGetOrCreateFolder(token, record._id, rootId);

  // CSV
  await driveUploadFile(token, projectId, `${record._id}_visita.csv`,
    new Blob([buildCSV([record])], { type:'text/csv;charset=utf-8;' }), 'text/csv');

  // JSON (sin dataUrls de firma y foto para ahorrar espacio)
  const jdata = JSON.parse(JSON.stringify(record));
  jdata.firma_data = jdata.firma_data ? '[firma_presente]' : null;
  if (jdata.foto?.dataUrl) jdata.foto = { ...jdata.foto, dataUrl: null, ruta: `foto_referencia.jpg` };
  await driveUploadFile(token, projectId, `${record._id}_visita.json`,
    new Blob([JSON.stringify(jdata, null, 2)], { type:'application/json' }), 'application/json');

  // Foto (si existe)
  if (record.foto?.dataUrl) {
    const blob = dataUrlToBlob(record.foto.dataUrl);
    await driveUploadFile(token, projectId, 'foto_referencia.jpg', blob, 'image/jpeg');
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
      record._synced    = true;
      record._syncedAt  = new Date().toISOString();
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

function dataUrlToBlob(dataUrl) {
  const parts = dataUrl.split(',');
  const mime  = parts[0].match(/:(.*?);/)[1];
  const bin   = atob(parts[1]);
  const arr   = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
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

  // Actualizar contador en botón Mis Fichas
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
          ${isModified ? `<span class="mod-star" title="Modificado">✱</span>` : ''}
        </div>
        <div class="record-card-name">${escapeHtml(record.nombre || 'Sin nombre')}</div>
        <div class="record-card-meta">
          <span>${isoToDisplay(record.fecha_visita || '')}</span>
          <span class="badge ${record._synced ? 'badge-synced' : 'badge-pending'}">
            ${record._synced ? '✓ Sync' : '⏳ Local'}
          </span>
          ${record.rut ? `<span style="font-size:.72rem;color:var(--gray-500)">RUT: ${escapeHtml(record.rut)}</span>` : ''}
        </div>
      </div>
    `;

    card.querySelector('.record-card-inner').addEventListener('click', () => {
      if (card.classList.contains('swiping-left')) { card.classList.remove('swiping-left'); return; }
      loadRecordToForm(record);
      renderRecordsList();
    });

    bindSwipeDelete(card, record);
    container.appendChild(card);
  });
}

/* ── Desliz / press largo para borrar ─────────────────── */
function bindSwipeDelete(card, record) {
  let startX = 0, startY = 0, isDragging = false, longPressTimer = null;
  const SWIPE_THRESHOLD  = 60;
  const LONG_PRESS_DELAY = 600;

  card.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    isDragging = false;
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
      card.querySelector('.record-card-delete-bg').addEventListener('click', () => {
        showDeleteConfirm(record);
      }, { once: true });
    } else {
      card.classList.remove('swiping-left');
    }
  }, { passive: true });
}

/* ── Modales ─────────────────────────────────────────── */
function showPostSaveModal() {
  document.getElementById('modal-post-save')?.classList.add('open');
}
function hidePostSaveModal() {
  document.getElementById('modal-post-save')?.classList.remove('open');
}

/* ── Sync UI ─────────────────────────────────────────── */
function updateSyncUI(state) {
  const cfg = {
    online:  { dot: 'online',  text: 'En línea',       btn: 'Sincronizar'   },
    offline: { dot: 'offline', text: 'Sin conexión',   btn: 'Sin conexión'  },
    syncing: { dot: 'syncing', text: 'Sincronizando…', btn: 'Sincronizando…'},
  }[state];
  if (!cfg) return;
  const dot  = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  const btn  = document.getElementById('sync-btn');
  if (dot)  dot.className    = `status-dot ${cfg.dot}`;
  if (text) text.textContent = cfg.text;
  if (btn)  {
    btn.innerHTML  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      style="${state==='syncing'?'animation:spin 1s linear infinite':''}">
      <path d="M23 4v6h-6M1 20v-6h6"/>
      <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
    </svg>${cfg.btn}`;
    btn.disabled = state === 'syncing' || state === 'offline';
  }
}

/* ── Toast ───────────────────────────────────────────── */
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

  // Eliminar
  document.getElementById('delete-btn')?.addEventListener('click', () => {
    if (!State.currentRecord) return;
    showDeleteConfirm(State.currentRecord);
  });

  // Sincronizar
  document.getElementById('sync-btn')?.addEventListener('click', triggerSync);

  // Búsqueda
  document.getElementById('search-input')?.addEventListener('input', renderRecordsList);

  // Firma
  document.getElementById('firma-clear-btn')?.addEventListener('click', clearFirma);
  document.getElementById('cb_no_firma')?.addEventListener('change', (e) => {
    handleNoFirmaToggle(e.target.checked);
  });

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

  // Caption foto en tiempo real
  document.getElementById('f_foto_caption')?.addEventListener('input', (e) => {
    if (State.foto) State.foto.caption = e.target.value;
    if (State.currentRecord?.foto) State.currentRecord.foto.caption = e.target.value;
  });

  // GPS botones (todos los targets)
  document.querySelectorAll('.btn-gps').forEach(btn => {
    btn.addEventListener('click', () => getGPS(btn.dataset.coordsTarget));
  });

  // Pegar desde Maps (todos los targets)
  document.querySelectorAll('.btn-maps').forEach(btn => {
    btn.addEventListener('click', () => pasteFromMaps(btn.dataset.coordsTarget));
  });

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
    document.querySelectorAll('.record-card.swiping-left').forEach(c => c.classList.remove('swiping-left'));
  });
  document.getElementById('modal-delete-confirm')?.addEventListener('click', async () => {
    document.getElementById('modal-confirm-delete')?.classList.remove('open');
    if (_pendingDeleteRecord) {
      await deleteRecord(_pendingDeleteRecord);
      _pendingDeleteRecord = null;
    }
  });

  // Modal advertencia RUT
  document.getElementById('modal-rut-cancel')?.addEventListener('click', () => {
    document.getElementById('modal-warn-rut')?.classList.remove('open');
    document.getElementById('f_rut')?.focus();
  });
  document.getElementById('modal-rut-confirm')?.addEventListener('click', async () => {
    document.getElementById('modal-warn-rut')?.classList.remove('open');
    // Verificar firma antes de guardar definitivo
    const r = State.currentRecord;
    if (!r.firma_data && !r.no_firma) {
      document.getElementById('modal-warn-firma')?.classList.add('open');
      return;
    }
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
    e.preventDefault();
    State.installPrompt = e;
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
  bindEvents();

  updateSyncUI(State.isOnline ? 'online' : 'offline');
  renderRecordsList();
}

document.addEventListener('DOMContentLoaded', init);
