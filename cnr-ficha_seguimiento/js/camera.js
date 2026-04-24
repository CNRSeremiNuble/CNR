/**
 * camera.js — Captura y compresión de fotos
 * CNR Seguimiento PWA
 * Soporta: cámara del dispositivo + galería + compresión JPEG
 */

'use strict';

const CameraModule = (() => {

  const MAX_PHOTOS   = 5;
  const MAX_WIDTH    = 1280;   // px máximo lado mayor
  const QUALITY      = 0.75;   // calidad JPEG 0-1
  const MAX_KB       = 400;    // tamaño máximo objetivo KB

  /* ── Referencia al módulo principal ─────────────────── */
  let _onPhotoAdded = null;

  /**
   * Inicializa el módulo.
   * @param {Function} onPhotoAdded - callback(photoObj) cuando se agrega foto
   */
  function init(onPhotoAdded) {
    _onPhotoAdded = onPhotoAdded;
  }

  /* ══════════════════════════════════════════════════════
     CAPTURA DESDE CÁMARA
     ══════════════════════════════════════════════════════ */
  function captureFromCamera(currentCount) {
    if (currentCount >= MAX_PHOTOS) {
      showToast(`Máximo ${MAX_PHOTOS} fotos por registro`, 'error');
      return;
    }
    const input = document.createElement('input');
    input.type    = 'file';
    input.accept  = 'image/*';
    input.capture = 'environment'; // cámara trasera en Android
    input.onchange = (e) => _handleFileInput(e, currentCount);
    input.click();
  }

  /* ══════════════════════════════════════════════════════
     SELECCIÓN DESDE GALERÍA
     ══════════════════════════════════════════════════════ */
  function selectFromGallery(currentCount) {
    const remaining = MAX_PHOTOS - currentCount;
    if (remaining <= 0) {
      showToast(`Máximo ${MAX_PHOTOS} fotos por registro`, 'error');
      return;
    }
    const input    = document.createElement('input');
    input.type     = 'file';
    input.accept   = 'image/*';
    input.multiple = remaining > 1;
    input.onchange = (e) => _handleFileInput(e, currentCount);
    input.click();
  }

  /* ══════════════════════════════════════════════════════
     PROCESAMIENTO DE ARCHIVOS
     ══════════════════════════════════════════════════════ */
  async function _handleFileInput(event, currentCount) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    const remaining = MAX_PHOTOS - currentCount;
    const toProcess = files.slice(0, remaining);

    if (files.length > remaining) {
      showToast(`Solo se agregarán ${remaining} foto(s) (límite ${MAX_PHOTOS})`, 'info');
    }

    for (const file of toProcess) {
      try {
        const photoObj = await _processImage(file);
        if (_onPhotoAdded) _onPhotoAdded(photoObj);
      } catch (err) {
        console.error('Error procesando imagen:', err);
        showToast('Error al procesar la imagen', 'error');
      }
    }
  }

  /* ══════════════════════════════════════════════════════
     COMPRESIÓN DE IMAGEN
     ══════════════════════════════════════════════════════ */
  async function _processImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          try {
            const canvas = _resizeImage(img);
            const dataUrl = _compressCanvas(canvas);
            const sizeKB  = Math.round((dataUrl.length * 3/4) / 1024);

            resolve({
              id:        `foto_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
              filename:  _sanitizeFilename(file.name),
              dataUrl:   dataUrl,
              sizeKB:    sizeKB,
              timestamp: new Date().toISOString(),
              caption:   '',
            });
          } catch (err) {
            reject(err);
          }
        };
        img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
        img.src = e.target.result;
      };

      reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
      reader.readAsDataURL(file);
    });
  }

  function _resizeImage(img) {
    let { width, height } = img;

    if (width > MAX_WIDTH || height > MAX_WIDTH) {
      if (width >= height) {
        height = Math.round(height * (MAX_WIDTH / width));
        width  = MAX_WIDTH;
      } else {
        width  = Math.round(width * (MAX_WIDTH / height));
        height = MAX_WIDTH;
      }
    }

    const canvas    = document.createElement('canvas');
    canvas.width    = width;
    canvas.height   = height;
    const ctx       = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
    return canvas;
  }

  function _compressCanvas(canvas) {
    let quality = QUALITY;
    let dataUrl = canvas.toDataURL('image/jpeg', quality);
    let sizeKB  = Math.round((dataUrl.length * 3/4) / 1024);

    // Reducir calidad iterativamente si supera MAX_KB
    while (sizeKB > MAX_KB && quality > 0.3) {
      quality -= 0.1;
      dataUrl  = canvas.toDataURL('image/jpeg', quality);
      sizeKB   = Math.round((dataUrl.length * 3/4) / 1024);
    }

    return dataUrl;
  }

  function _sanitizeFilename(name) {
    // Remueve caracteres especiales y normaliza extensión
    const base = name.replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase();
    return base.endsWith('.jpg') || base.endsWith('.jpeg')
      ? base
      : base.replace(/\.[^.]+$/, '') + '.jpg';
  }

  /* ══════════════════════════════════════════════════════
     RENDERIZADO DE THUMBNAILS
     ══════════════════════════════════════════════════════ */
  function renderPhotoGrid(photos, container, onRemove, onCaptionChange) {
    container.innerHTML = '';

    if (!photos || photos.length === 0) {
      container.innerHTML = `
        <div style="color:var(--gray-400);font-size:.85rem;padding:20px 0;text-align:center;grid-column:1/-1;">
          Sin fotos. Use los botones para agregar.
        </div>`;
      return;
    }

    photos.forEach((photo, index) => {
      const div = document.createElement('div');
      div.className = 'photo-thumb';
      div.innerHTML = `
        <img src="${photo.dataUrl}" alt="Foto ${index + 1}" loading="lazy">
        <div class="photo-number">${index + 1}</div>
        <div class="photo-thumb-overlay">
          <input
            class="photo-caption-input"
            type="text"
            placeholder="Descripción (opcional)"
            value="${escapeHtml(photo.caption || '')}"
            data-photo-id="${photo.id}"
          >
          <button class="photo-remove" data-photo-id="${photo.id}" title="Eliminar foto">✕</button>
        </div>
        ${photo.caption ? `<div class="photo-caption-display">${escapeHtml(photo.caption)}</div>` : ''}
      `;

      // Evento: eliminar foto
      div.querySelector('.photo-remove').addEventListener('click', () => {
        if (onRemove) onRemove(photo.id);
      });

      // Evento: editar caption
      const captionInput = div.querySelector('.photo-caption-input');
      captionInput.addEventListener('input', () => {
        if (onCaptionChange) onCaptionChange(photo.id, captionInput.value);
      });

      container.appendChild(div);
    });
  }

  /* ══════════════════════════════════════════════════════
     CONVERSIÓN PARA SINCRONIZACIÓN
     ══════════════════════════════════════════════════════ */

  /**
   * Convierte dataUrl a Blob para subir a Google Drive
   */
  function dataUrlToBlob(dataUrl) {
    const parts = dataUrl.split(',');
    const mime  = parts[0].match(/:(.*?);/)[1];
    const bin   = atob(parts[1]);
    const arr   = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  /**
   * Genera nombre de archivo para Drive: foto_01.jpg, foto_02.jpg, etc.
   */
  function getFilenameForDrive(index) {
    return `foto_${String(index + 1).padStart(2, '0')}.jpg`;
  }

  /* ── Utilidades ─────────────────────────────────────── */
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function showToast(msg, type) {
    // Delegado al módulo principal vía evento global
    window.dispatchEvent(new CustomEvent('cnr:toast', { detail: { msg, type } }));
  }

  /* ── API pública ─────────────────────────────────────── */
  return {
    init,
    captureFromCamera,
    selectFromGallery,
    renderPhotoGrid,
    dataUrlToBlob,
    getFilenameForDrive,
    MAX_PHOTOS,
  };

})();
