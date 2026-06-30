/**
 * VidaSegura — QR Module (Firebase Realtime Database)
 *
 * Genera un QR con URL que enlaza al perfil público de emergencia.
 * Escaneo externo → abre navegador con perfil completo + mapa en vivo.
 * Escaneo interno → navega a la página de perfil público.
 *
 * Ubicación en vivo: usa listener de Firebase Realtime Database
 * (realtimeDb.ref('users/{uid}/location').on('value')) en lugar de
 * polling con setInterval, proporcionando actualizaciones instantáneas.
 *
 * Globals requeridos: realtimeDb, firebaseAuth (de firebase-config.js)
 */
window.VidaSegura = window.VidaSegura || {};
window.VidaSegura.QR = (function () {
  'use strict';

  var qrInstance     = null;
  var html5QrScanner = null;
  var isScanning     = false;

  // Referencia al listener activo de ubicación para poder desuscribirse
  var activeLiveListener = null;
  var activeLiveRef      = null;

  function $(id) { return document.getElementById(id); }

  function calcAge(birthdate) {
    if (!birthdate) return null;
    var dob  = new Date(birthdate);
    var diff = Date.now() - dob.getTime();
    var age  = new Date(diff);
    return Math.abs(age.getUTCFullYear() - 1970);
  }

  function fmtCoords(lat, lng) {
    if (lat == null || lng == null) return 'No disponible';
    return lat.toFixed(6) + ', ' + lng.toFixed(6);
  }

  // ── Comprimir foto a un base64 más pequeño para la URL del QR ──
  function compressPhoto(base64, maxWidth, quality) {
    maxWidth = maxWidth || 120;
    quality  = quality  || 0.5;
    return new Promise(function (resolve) {
      if (!base64) { resolve(null); return; }
      var img = new Image();
      img.onload = function () {
        var canvas = document.createElement('canvas');
        var ratio  = Math.min(maxWidth / img.width, maxWidth / img.height);
        canvas.width  = Math.round(img.width  * ratio);
        canvas.height = Math.round(img.height * ratio);
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = function () { resolve(null); };
      img.src = base64;
    });
  }

  // ── Construir la URL base para los enlaces QR ──
  function getBaseURL() {
    // Retorna el origin actual.
    // En producción esto será el dominio de Firebase Hosting.
    return window.location.origin + window.location.pathname;
  }

  /**
   * Detiene y limpia el listener de ubicación en vivo activo.
   * Debe llamarse antes de navegar fuera del perfil público
   * o antes de configurar un nuevo listener.
   */
  function cleanupLiveListener() {
    if (activeLiveRef && activeLiveListener) {
      activeLiveRef.off('value', activeLiveListener);
      console.log('[QR] Listener de ubicación en vivo desconectado');
    }
    activeLiveRef      = null;
    activeLiveListener = null;
  }

  // ── API Pública ──

  function init() {
    try {
      var btnDownload = $('btn-download-qr');
      var btnShare    = $('btn-share-qr');
      var btnPrint    = $('btn-print-qr');
      var btnStart    = $('btn-start-scanner');
      var btnStop     = $('btn-stop-scanner');

      if (btnDownload) btnDownload.addEventListener('click', downloadQR);
      if (btnShare)    btnShare.addEventListener('click', shareQR);
      if (btnPrint)    btnPrint.addEventListener('click', printQR);
      if (btnStart)    btnStart.addEventListener('click', startScanner);
      if (btnStop)     btnStop.addEventListener('click', stopScanner);

      console.log('[QR] Módulo inicializado (Firebase Realtime Database)');
    } catch (err) {
      console.error('[QR] Error durante init:', err);
    }
  }

  /**
   * Genera un código QR con URL que contiene los datos del perfil embebidos.
   * Al escanear → abre http://HOST/index.html#p=BASE64DATA
   */
  async function generateQR() {
    try {
      var DB   = window.VidaSegura.DB;
      var user = await DB.getUser();
      if (!user) {
        console.warn('[QR] No se encontró usuario');
        return;
      }

      // Obtener última ubicación conocida
      var locations = [];
      try { locations = await DB.getLocations(); } catch (_) {}
      var lastLoc = locations && locations.length ? locations[0] : null;

      // Comprimir foto para el QR (miniatura pequeña)
      var thumbPhoto = null;
      try {
        thumbPhoto = await compressPhoto(user.photo, 100, 0.4);
      } catch (_) {}

      // Construir array de contactos de emergencia
      var contacts = [];
      if (user.emergencyName1 || user.emergencyPhone1) {
        contacts.push({ n: user.emergencyName1 || '', p: user.emergencyPhone1 || '' });
      }
      if (user.emergencyName2 || user.emergencyPhone2) {
        contacts.push({ n: user.emergencyName2 || '', p: user.emergencyPhone2 || '' });
      }
      // Verificar formato anterior
      if (user.emergencyContacts && user.emergencyContacts.length) {
        user.emergencyContacts.forEach(function (c) {
          contacts.push({ n: c.name || c.n || '', p: c.phone || c.p || '' });
        });
      }

      // Obtener UID de Firebase Auth para tracking en vivo
      var uid = '';
      try {
        var currentUser = firebaseAuth.currentUser;
        if (currentUser) uid = currentUser.uid;
      } catch (_) {}

      // Construir payload de datos QR — claves compactas para ahorrar espacio
      var qrData = {
        _v:  2,                                     // versión
        _a:  'VidaSegura',                          // identificador de app
        id:  uid || user.id || '',                  // UID de Firebase para tracking
        nm:  user.name      || '',                  // nombre
        ci:  user.cedula    || '',                  // cédula
        bt:  user.bloodType || '',                  // tipo de sangre
        bd:  user.birthdate || '',                  // fecha de nacimiento
        al:  user.allergies    || [],               // alergias
        md:  user.medications  || [],               // medicamentos
        co:  user.conditions   || [],               // condiciones
        ec:  contacts,                              // contactos de emergencia
        ph:  thumbPhoto || '',                      // foto (comprimida)
        in:  user.insurance    || '',               // seguro
        od:  user.organDonor   || false,            // donante de órganos
        mn:  user.medicalNotes || '',               // notas médicas
        st:  user.state        || '',               // estado
        ct:  user.city         || '',               // ciudad
        tl:  user.phone        || '',               // teléfono
        lo:  lastLoc ? {
               la: (typeof lastLoc.lat === 'object') ? lastLoc.lat.lat : lastLoc.lat,
               ln: (typeof lastLoc.lat === 'object') ? lastLoc.lat.lng : lastLoc.lng
             } : null,                              // ubicación
        ts:  Date.now(),                            // timestamp
      };

      // Codificar como URL base64
      var jsonStr    = JSON.stringify(qrData);
      var base64     = btoa(unescape(encodeURIComponent(jsonStr)));
      var profileURL = getBaseURL() + '#p=' + base64;

      console.log('[QR] Longitud de URL: ' + profileURL.length + ' caracteres');

      // Si la URL es muy larga (>2900 chars = límite QR), remover foto
      if (profileURL.length > 2900) {
        qrData.ph = '';
        jsonStr    = JSON.stringify(qrData);
        base64     = btoa(unescape(encodeURIComponent(jsonStr)));
        profileURL = getBaseURL() + '#p=' + base64;
        console.log('[QR] Sin foto, URL reducida: ' + profileURL.length + ' caracteres');
      }

      // Si aún es muy larga, usar versión mínima
      if (profileURL.length > 2900) {
        var minimal = {
          _v: 2, _a: 'VidaSegura',
          id: uid || user.id || '',
          nm: user.name || '', ci: user.cedula || '',
          bt: user.bloodType || '', al: user.allergies || [],
          ec: contacts.slice(0, 1),
          lo: qrData.lo, ts: qrData.ts
        };
        jsonStr    = JSON.stringify(minimal);
        base64     = btoa(unescape(encodeURIComponent(jsonStr)));
        profileURL = getBaseURL() + '#p=' + base64;
        console.log('[QR] Versión mínima: ' + profileURL.length + ' caracteres');
      }

      // Renderizar código QR
      var container = $('qr-code-container');
      if (!container) return;
      container.innerHTML = '';

      if (typeof QRCode === 'undefined') {
        if (window.VidaSegura.App)
          window.VidaSegura.App.showToast('Error: librería QR no disponible', 'error');
        return;
      }

      qrInstance = new QRCode(container, {
        text:         profileURL,
        width:        250,
        height:       250,
        colorDark:    '#0F172A',
        colorLight:   '#ffffff',
        correctLevel: QRCode.CorrectLevel.L,  // L = más capacidad de datos
      });

      // Actualizar etiquetas de información
      if ($('qr-user-name'))   $('qr-user-name').textContent   = user.name      || '—';
      if ($('qr-user-blood'))  $('qr-user-blood').textContent  = user.bloodType || '—';
      if ($('qr-user-cedula')) $('qr-user-cedula').textContent = user.cedula    || '—';
      if ($('qr-timestamp'))   $('qr-timestamp').textContent   = new Date().toLocaleString('es-VE');

      console.log('[QR] Código QR generado con URL');
    } catch (err) {
      console.error('[QR] Error generando QR:', err);
      if (window.VidaSegura.App)
        window.VidaSegura.App.showToast('Error al generar el código QR', 'error');
    }
  }

  // ── Escáner ──

  async function startScanner() {
    try {
      if (typeof Html5Qrcode === 'undefined') {
        if (window.VidaSegura.App)
          window.VidaSegura.App.showToast('Escáner QR no disponible', 'error');
        return;
      }

      html5QrScanner = new Html5Qrcode('qr-reader');
      await html5QrScanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        function onSuccess(decodedText) { handleScanResult(decodedText); },
        function onError() {}
      );

      isScanning = true;
      if ($('btn-start-scanner')) $('btn-start-scanner').style.display = 'none';
      if ($('btn-stop-scanner'))  $('btn-stop-scanner').style.display  = '';
    } catch (err) {
      console.error('[QR] Error iniciando escáner:', err);
      if (window.VidaSegura.App)
        window.VidaSegura.App.showToast('No se pudo acceder a la cámara', 'error');
    }
  }

  async function stopScanner() {
    try {
      if (isScanning && html5QrScanner) {
        await html5QrScanner.stop();
        html5QrScanner = null;
      }
      isScanning = false;
      if ($('btn-start-scanner')) $('btn-start-scanner').style.display = '';
      if ($('btn-stop-scanner'))  $('btn-stop-scanner').style.display  = 'none';
    } catch (err) {
      console.error('[QR] Error deteniendo escáner:', err);
    }
  }

  /**
   * Maneja el resultado del escaneo QR — puede ser una URL (#p=...) o JSON crudo.
   */
  async function handleScanResult(decodedText) {
    try {
      await stopScanner();

      var data = null;

      // Intentar formato basado en URL primero: buscar #p= en la URL
      var hashIdx = decodedText.indexOf('#p=');
      if (hashIdx !== -1) {
        var b64 = decodedText.substring(hashIdx + 3);
        try {
          var jsonStr = decodeURIComponent(escape(atob(b64)));
          data = JSON.parse(jsonStr);
        } catch (_) {}
      }

      // Fallback: intentar JSON crudo
      if (!data) {
        try {
          data = JSON.parse(decodedText);
        } catch (_) {}
      }

      if (!data || (data._a !== 'VidaSegura' && data.app !== 'VidaSegura')) {
        if (window.VidaSegura.App)
          window.VidaSegura.App.showToast('Código QR no reconocido', 'warning');
        return;
      }

      // Mostrar el perfil público
      displayPublicProfile(data);
    } catch (err) {
      console.error('[QR] Error procesando resultado:', err);
      if (window.VidaSegura.App)
        window.VidaSegura.App.showToast('Error al procesar el código QR', 'error');
    }
  }

  /**
   * Inyecta los estilos CSS para el indicador de "en vivo" pulsante.
   * Se inyecta una sola vez al <head>.
   */
  function injectLiveStyles() {
    if (document.getElementById('vidasegura-live-styles')) return;
    var style = document.createElement('style');
    style.id = 'vidasegura-live-styles';
    style.textContent =
      '@keyframes vs-live-pulse {' +
      '  0%   { box-shadow: 0 0 0 0 rgba(34,197,94,0.6); }' +
      '  70%  { box-shadow: 0 0 0 8px rgba(34,197,94,0); }' +
      '  100% { box-shadow: 0 0 0 0 rgba(34,197,94,0); }' +
      '}' +
      '.vs-live-dot {' +
      '  width: 10px; height: 10px; border-radius: 50%;' +
      '  background: var(--color-success, #22c55e);' +
      '  display: inline-block; margin-right: 6px;' +
      '  animation: vs-live-pulse 1.5s infinite;' +
      '}' +
      '.vs-live-dot--offline {' +
      '  background: var(--color-alert, #ef4444);' +
      '  animation: none;' +
      '}';
    document.head.appendChild(style);
  }

  /**
   * Parsea datos QR del hash de la URL y muestra el perfil público.
   * Llamado por App._checkURLHash o al escanear internamente.
   *
   * Usa Firebase Realtime Database listener (on('value')) para recibir
   * actualizaciones de ubicación en tiempo real en lugar de polling.
   */
  function displayPublicProfile(data) {
    try {
      var App = window.VidaSegura.App;

      // Limpiar listener previo de ubicación en vivo
      cleanupLiveListener();

      // Normalizar claves (v2 claves compactas → nombres completos)
      var profile = {
        name:        data.nm || data.name      || '—',
        cedula:      data.ci || data.cedula    || '—',
        bloodType:   data.bt || data.bloodType || data.blood || '—',
        birthdate:   data.bd || data.birthdate || '',
        allergies:   data.al || data.allergies   || [],
        medications: data.md || data.medications || [],
        conditions:  data.co || data.conditions  || [],
        photo:       data.ph || data.photo       || '',
        insurance:   data.in || data.insurance   || '',
        organDonor:  data.od || data.organDonor  || false,
        medicalNotes:data.mn || data.medicalNotes|| '',
        state:       data.st || data.state       || '',
        city:        data.ct || data.city        || '',
        phone:       data.tl || data.phone       || '',
        userId:      data.id || data.userId || '',
        location:    data.lo || data.lastLocation || null,
        timestamp:   data.ts || data.timestamp   || null,
        contacts:    data.ec || data.emergencyContacts || [],
      };

      // Navegar a perfil público
      if (App && App.navigate) App.navigate('public-profile');

      var set = function (id, val) {
        var el = $(id);
        if (el) el.textContent = val || '—';
      };

      // Nombre e info básica
      set('public-name',       profile.name);
      set('public-cedula',     profile.cedula);
      set('public-blood-type', profile.bloodType);

      // Edad
      var age = calcAge(profile.birthdate);
      set('public-age', age != null ? age + ' años' : '—');

      // Info médica
      var allergiesText = Array.isArray(profile.allergies) ? profile.allergies.join(', ') : profile.allergies;
      set('public-allergies', allergiesText || 'Ninguna reportada');

      var medsText = Array.isArray(profile.medications) ? profile.medications.join(', ') : profile.medications;
      set('public-medications', medsText || 'Ninguno reportado');

      var condsText = Array.isArray(profile.conditions) ? profile.conditions.join(', ') : profile.conditions;
      set('public-conditions', condsText || 'Ninguna reportada');

      // Notas médicas
      set('public-medical-notes', profile.medicalNotes || '—');

      // Foto
      var photoEl      = $('public-photo');
      var placeholderEl = $('public-photo-placeholder');
      if (photoEl && profile.photo) {
        photoEl.src = profile.photo;
        photoEl.style.display = 'block';
        if (placeholderEl) placeholderEl.style.display = 'none';
      } else if (photoEl) {
        photoEl.style.display = 'none';
        if (placeholderEl) placeholderEl.style.display = 'flex';
      }

      // Contactos de emergencia con click-to-call
      var contactsEl = $('public-emergency-contacts');
      if (contactsEl) {
        contactsEl.innerHTML = '';
        var contacts = profile.contacts || [];
        if (contacts.length === 0) {
          contactsEl.innerHTML = '<p class="empty-state">No hay contactos registrados</p>';
        }
        contacts.forEach(function (c) {
          var name  = c.n || c.name  || 'Contacto';
          var phone = c.p || c.phone || '';
          var div = document.createElement('div');
          div.className = 'public-contact-item';
          div.innerHTML =
            '<span><strong>' + name + '</strong><br><span class="text-secondary">' + phone + '</span></span>' +
            (phone ? '<a href="tel:' + phone + '" class="public-contact-btn">📞 Llamar</a>' : '');
          contactsEl.appendChild(div);
        });
      }

      // Ubicación + mapa
      var loc = profile.location;
      var lat = loc ? (loc.la || loc.lat) : null;
      var lng = loc ? (loc.ln || loc.lng) : null;

      // Compatibilidad con el bug de ubicación anidada
      if (lat && typeof lat === 'object') {
        lng = lat.lng || lat.ln;
        lat = lat.lat || lat.la;
      }

      if (lat && lng) {
        set('public-last-location', fmtCoords(lat, lng));

        // Inicializar mapa después de un pequeño delay (el DOM necesita ser visible)
        setTimeout(function () {
          try {
            var MapMod = window.VidaSegura.Map;
            if (MapMod && typeof MapMod.init === 'function') {
              var miniMap = MapMod.init('public-map-container', {
                center: [lat, lng],
                zoom: 15,
              });
              if (miniMap) {
                MapMod.addMarker('public-map-container', 'public-user-loc', lat, lng, {
                  popup: '<strong>' + profile.name + '</strong><br>📍 Última ubicación conocida<br><em>' +
                         fmtCoords(lat, lng) + '</em>',
                });
              }
              // Mostrar el contenedor del mapa
              var mapContainer = $('public-map-container');
              if (mapContainer) mapContainer.style.display = 'block';
            }
          } catch (mapErr) {
            console.warn('[QR] Error inicializando mapa público:', mapErr);
          }
        }, 300);

        // ── Ubicación en vivo via Firebase Realtime Database ──
        var userId = profile.userId || data.id || '';
        if (userId) {
          // Inyectar estilos del indicador pulsante
          injectLiveStyles();

          // Mostrar indicador de estado en vivo
          var liveStatusEl = $('public-live-status');
          if (liveStatusEl) {
            liveStatusEl.style.display = 'flex';
            // Asegurar que el dot tenga la clase correcta para la animación
            var dotEl = $('public-live-dot');
            if (dotEl) {
              dotEl.className = 'vs-live-dot';
            }
          }

          // Crear referencia a la ubicación del usuario en RTDB
          activeLiveRef = realtimeDb.ref('users/' + userId + '/location');

          // Escuchar cambios en tiempo real (reemplaza el polling cada 10s)
          activeLiveListener = activeLiveRef.on('value', function (snapshot) {
            var locData = snapshot.val();
            if (!locData || locData.lat == null || locData.lng == null) {
              // Sin datos de ubicación
              var dotEl = $('public-live-dot');
              if (dotEl) dotEl.className = 'vs-live-dot vs-live-dot--offline';
              return;
            }

            var newLat  = locData.lat;
            var newLng  = locData.lng;
            var isOnline = locData.online === true;

            // Actualizar indicador en vivo (pulsar verde si online, rojo si offline)
            var dotEl = $('public-live-dot');
            if (dotEl) {
              dotEl.className = isOnline ? 'vs-live-dot' : 'vs-live-dot vs-live-dot--offline';
            }

            var liveLabel = $('public-live-label');
            if (liveLabel) {
              liveLabel.textContent = isOnline ? 'En vivo' : 'Última posición conocida';
            }

            // Actualizar marcador del mapa
            try {
              var MapMod = window.VidaSegura.Map;
              if (MapMod) {
                MapMod.addMarker('public-map-container', 'public-user-loc', newLat, newLng, {
                  popup: '<strong>' + (profile.name || 'Usuario') + '</strong><br>' +
                         (isOnline ? '🟢 En vivo' : '🔴 Offline') + '<br>📍 ' +
                         newLat.toFixed(6) + ', ' + newLng.toFixed(6),
                });
              }
            } catch (_) {}

            // Actualizar texto de coordenadas
            var locEl = $('public-last-location');
            if (locEl) locEl.textContent = newLat.toFixed(6) + ', ' + newLng.toFixed(6);

            // Actualizar timestamp
            var tsEl = $('public-timestamp');
            if (tsEl && locData.timestamp) {
              tsEl.textContent = 'Actualizado: ' + new Date(locData.timestamp).toLocaleString('es-VE');
            }

            console.log('[QR] Ubicación en vivo actualizada:', newLat.toFixed(4), newLng.toFixed(4),
                         isOnline ? '(online)' : '(offline)');

          }, function (error) {
            // Error de lectura (permisos, desconexión, etc.)
            console.warn('[QR] Error en listener de ubicación en vivo:', error);
            var dotEl = $('public-live-dot');
            if (dotEl) dotEl.className = 'vs-live-dot vs-live-dot--offline';
          });

          console.log('[QR] Listener de ubicación en vivo activado para uid:', userId);
        }
      } else {
        set('public-last-location', 'Ubicación no disponible');
      }

      // Timestamp
      if (profile.timestamp) {
        var ts = typeof profile.timestamp === 'number'
          ? new Date(profile.timestamp)
          : new Date(profile.timestamp);
        set('public-timestamp', 'Última actualización: ' + ts.toLocaleString('es-VE'));
      }

      console.log('[QR] Perfil público mostrado para: ' + profile.name);
      if (App) App.showToast('Perfil de ' + profile.name + ' cargado', 'success');

    } catch (err) {
      console.error('[QR] Error mostrando perfil público:', err);
    }
  }

  // ── Descargar / Compartir / Imprimir ──

  function downloadQR() {
    try {
      var container = $('qr-code-container');
      if (!container) return;
      var canvas = container.querySelector('canvas');
      if (!canvas) {
        var img = container.querySelector('img');
        if (img) {
          var link = document.createElement('a');
          link.download = 'vidasegura-qr.png';
          link.href = img.src;
          link.click();
        }
        return;
      }
      canvas.toBlob(function (blob) {
        if (!blob) return;
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.download = 'vidasegura-qr.png';
        link.href = url;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }, 'image/png');
    } catch (err) {
      console.error('[QR] Error descargando QR:', err);
    }
  }

  async function shareQR() {
    try {
      if (!navigator.share) {
        if (window.VidaSegura.App)
          window.VidaSegura.App.showToast('Compartir no disponible. Descarga la imagen.', 'info');
        return;
      }
      var container = $('qr-code-container');
      if (!container) return;
      var canvas = container.querySelector('canvas');
      if (!canvas) return;

      var blob = await new Promise(function (resolve) {
        canvas.toBlob(resolve, 'image/png');
      });
      if (!blob) return;

      var file = new File([blob], 'vidasegura-qr.png', { type: 'image/png' });
      await navigator.share({
        title: 'Mi QR VidaSegura',
        text:  'Escanea este código para ver mi perfil de emergencia',
        files: [file],
      });
    } catch (err) {
      console.warn('[QR] Error al compartir:', err);
    }
  }

  function printQR() {
    window.print();
  }

  // ── API Pública ──
  return {
    init:                 init,
    generateQR:           generateQR,
    startScanner:         startScanner,
    stopScanner:          stopScanner,
    handleScanResult:     handleScanResult,
    displayPublicProfile: displayPublicProfile,
    cleanupLiveListener:  cleanupLiveListener,
    downloadQR:           downloadQR,
    shareQR:              shareQR,
    printQR:              printQR,
  };
})();
