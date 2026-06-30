/**
 * VidaSegura — Módulo SOS (Firebase)
 * Ciclo de vida completo de emergencia SOS: cuenta regresiva, activación,
 * rastreo GPS de emergencia, notificación de contactos, temporizador
 * transcurrido y cancelación.
 *
 * Cambios clave respecto a la versión IndexedDB:
 *   - Alerta se escribe en Firestore: alerts/{autoId}
 *   - Flag sosActive se escribe en Realtime Database: users/{uid}/sosActive
 *   - Cancelación actualiza Firestore y limpia flag en RTDB
 *   - userId se obtiene de firebaseAuth.currentUser.uid
 *
 * Globals requeridos: firebaseAuth, firestore, realtimeDb  (de firebase-config.js)
 */
window.VidaSegura = window.VidaSegura || {};
window.VidaSegura.SOS = (function () {
  'use strict';

  // ──────────────────────────────────────────────
  // Estado privado
  // ──────────────────────────────────────────────
  var isActive       = false;
  var activeAlert    = null;   // { firestoreId, ... }
  var countdownTimer = null;
  var countdownValue = 5;
  var sosTimer       = null;
  var sosStartTime   = null;

  // Patrón de vibración Morse SOS (· · · — — — · · ·)
  var SOS_VIBRATE_PATTERN = [
    100, 50, 100, 50, 100,        // S  (· · ·)
    200,                           // gap
    200, 50, 200, 50, 200,        // O  (— — —)
    200,                           // gap
    100, 50, 100, 50, 100,        // S  (· · ·)
  ];

  function $(id) {
    return document.getElementById(id);
  }

  /**
   * Formatea segundos en MM:SS.
   */
  function formatTime(totalSeconds) {
    var m = Math.floor(totalSeconds / 60);
    var s = totalSeconds % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  /**
   * Formatea coordenadas para visualización.
   */
  function fmtCoords(lat, lng) {
    if (lat == null || lng == null) return 'Obteniendo ubicación…';
    return lat.toFixed(6) + ', ' + lng.toFixed(6);
  }

  /**
   * Obtiene el UID del usuario autenticado o null.
   */
  function _getUid() {
    var user = firebaseAuth.currentUser;
    return user ? user.uid : null;
  }

  // ──────────────────────────────────────────────
  // API pública
  // ──────────────────────────────────────────────

  /**
   * Inicializa los event listeners del botón SOS.
   */
  function init() {
    try {
      var btnSosFloat  = $('btn-sos-float');
      var btnCancel    = $('btn-sos-countdown-cancel');
      var btnSosCancel = $('btn-sos-cancel');

      if (btnSosFloat) {
        btnSosFloat.addEventListener('click', function () {
          startCountdown();
        });
      }

      if (btnCancel) {
        btnCancel.addEventListener('click', function () {
          cancelCountdown();
        });
      }

      if (btnSosCancel) {
        btnSosCancel.addEventListener('click', function () {
          cancel();
        });
      }

      console.log('[SOS] Módulo inicializado (Firebase)');
    } catch (err) {
      console.error('[SOS] Error durante init:', err);
    }
  }

  /**
   * Inicia la cuenta regresiva de 5 segundos antes de activar SOS.
   */
  function startCountdown() {
    try {
      // Prevenir activación duplicada
      if (isActive || countdownTimer) return;

      var overlay = $('sos-countdown-overlay');
      if (overlay) overlay.classList.add('active');

      countdownValue = 5;
      var numberEl = $('sos-countdown-number');
      if (numberEl) numberEl.textContent = countdownValue;

      // Vibrar al inicio
      if (navigator.vibrate) {
        navigator.vibrate(200);
      }

      countdownTimer = setInterval(function () {
        countdownValue--;

        if (numberEl) numberEl.textContent = countdownValue;

        // Vibración de tick
        if (navigator.vibrate) {
          navigator.vibrate(100);
        }

        if (countdownValue <= 0) {
          clearInterval(countdownTimer);
          countdownTimer = null;
          activate();
        }
      }, 1000);

      console.log('[SOS] Cuenta regresiva iniciada');
    } catch (err) {
      console.error('[SOS] Error iniciando cuenta regresiva:', err);
    }
  }

  /**
   * Cancela la cuenta regresiva antes de la activación.
   */
  function cancelCountdown() {
    try {
      if (countdownTimer) {
        clearInterval(countdownTimer);
        countdownTimer = null;
      }

      var overlay = $('sos-countdown-overlay');
      if (overlay) overlay.classList.remove('active');

      console.log('[SOS] Cuenta regresiva cancelada');
    } catch (err) {
      console.error('[SOS] Error cancelando cuenta regresiva:', err);
    }
  }

  /**
   * Activa la emergencia SOS.
   * Escribe la alerta en Firestore y marca sosActive en Realtime Database.
   */
  async function activate() {
    // ── GUARD: prevenir cualquier activación duplicada ──
    if (isActive) return;
    isActive = true;

    // Ocultar overlay de cuenta regresiva inmediatamente
    var overlay = $('sos-countdown-overlay');
    if (overlay) overlay.classList.remove('active');

    var GPS = window.VidaSegura.GPS;
    var App = window.VidaSegura.App;
    var uid = _getUid();

    // Obtener posición actual (fallo silencioso)
    var position = null;
    try {
      position = await GPS.getCurrentPosition();
    } catch (_) {}

    // Iniciar rastreo GPS de emergencia (fallo silencioso)
    try {
      GPS.startTracking('emergency');
    } catch (_) {}

    // Construir objeto de alerta
    activeAlert = {
      firestoreId: null,         // se asignará al guardar en Firestore
      userId:      uid,
      location:    position ? { lat: position.lat, lng: position.lng } : null,
      timestamp:   Date.now(),
      status:      'active',
      type:        'sos'
    };

    // ── 1. Guardar alerta en Firestore: alerts/{autoId} ──
    try {
      var docRef = await firestore.collection('alerts').add(activeAlert);
      activeAlert.firestoreId = docRef.id;
      console.log('[SOS] Alerta creada en Firestore:', docRef.id);
    } catch (fsErr) {
      console.warn('[SOS] Error guardando alerta en Firestore:', fsErr);
    }

    // ── 2. Marcar sosActive en Realtime Database ──
    if (uid) {
      try {
        await realtimeDb.ref('users/' + uid + '/sosActive').set(true);
      } catch (rtErr) {
        console.warn('[SOS] Error marcando sosActive en RTDB:', rtErr);
      }
    }

    // Obtener contactos de emergencia desde Firestore
    var contacts = [];
    try {
      var DB = window.VidaSegura.DB;
      if (DB && DB.getUser) {
        var userData = await DB.getUser();
        contacts = (userData && userData.emergencyContacts) || [];
      }
    } catch (_) {}

    // Navegar a la página SOS activo
    if (App && App.navigate) {
      App.navigate('sos-active');
    }
    
    // TRUCO DE PRUEBA: Lanzar notificación Push en 5 segundos para que el usuario pueda minimizar la app
    if (window.VidaSegura.Notifications && typeof window.VidaSegura.Notifications.sendEmergencyNotification === 'function') {
      setTimeout(function() {
        window.VidaSegura.Notifications.sendEmergencyNotification('Tú (Modo Prueba)', position);
      }, 5000);
    }

    // Actualizar UI de la página SOS
    updateSOSPageUI(position, contacts);

    // Iniciar temporizador transcurrido
    sosStartTime = Date.now();
    var timerEl = $('sos-timer');
    if (sosTimer) clearInterval(sosTimer);
    sosTimer = setInterval(function () {
      var elapsed = Math.floor((Date.now() - sosStartTime) / 1000);
      if (timerEl) timerEl.textContent = formatTime(elapsed);
    }, 1000);

    // Patrón de vibración SOS
    try { if (navigator.vibrate) navigator.vibrate(SOS_VIBRATE_PATTERN); } catch (_) {}

    // Toast — solo una vez
    if (App && App.showToast) {
      App.showToast('🚨 Emergencia activada', 'warning');
    }

    console.log('[SOS] Emergencia activada — Firestore ID:', activeAlert.firestoreId);
  }

  /**
   * Llena la pantalla SOS activa con ubicación, mapa y contactos.
   */
  function updateSOSPageUI(position, contacts) {
    try {
      // Texto de ubicación
      var locTextEl = $('sos-location-text');
      if (locTextEl) {
        locTextEl.textContent = position
          ? fmtCoords(position.lat, position.lng)
          : 'Obteniendo ubicación…';
      }

      // Mapa
      try {
        var MapMod = window.VidaSegura.Map;
        if (MapMod && position) {
          var sosMap = MapMod.init('sos-map-container', {
            center: [position.lat, position.lng],
            zoom:   15,
          });
          if (sosMap) {
            MapMod.addMarker('sos-map-container', 'sos-user-location',
              position.lat, position.lng, {
                icon:  '<div class="sos-marker-pulse">🆘</div>',
                popup: 'Tu ubicación de emergencia',
              });
          }
        }
      } catch (mapErr) {
        console.warn('[SOS] Error inicializando mapa SOS:', mapErr);
      }

      // Contactos notificados
      var contactsEl = $('sos-contacts-notified');
      if (contactsEl && contacts && contacts.length) {
        contactsEl.innerHTML = '';
        contacts.forEach(function (c) {
          var div = document.createElement('div');
          div.className = 'sos-contact-item';
          div.innerHTML =
            '<span class="sos-contact-name">' + (c.name || 'Contacto') + '</span>' +
            (c.relation ? ' <span class="sos-contact-relation">(' + c.relation + ')</span>' : '') +
            ' — ' +
            '<a href="tel:' + (c.phone || '') + '" class="sos-contact-call">📞 ' + (c.phone || '') + '</a>';
          contactsEl.appendChild(div);
        });
      } else if (contactsEl) {
        contactsEl.innerHTML = '<p class="text-muted">No hay contactos de emergencia configurados.</p>';
      }

      // Actualizar mapa cuando el GPS envíe nuevas posiciones
      var GPS = window.VidaSegura.GPS;
      if (GPS) {
        GPS.onPositionUpdate(function (pos) {
          if (!isActive) return;
          try {
            var MapMod = window.VidaSegura.Map;
            if (MapMod) {
              MapMod.updateMarker('sos-user-location', pos.lat, pos.lng);
              MapMod.setCenter('sos-map-container', pos.lat, pos.lng);
            }
            var locEl = $('sos-location-text');
            if (locEl) locEl.textContent = fmtCoords(pos.lat, pos.lng);
          } catch (_) {}
        });
      }
    } catch (err) {
      console.error('[SOS] Error actualizando UI de SOS:', err);
    }
  }

  /**
   * Cancela la emergencia SOS activa.
   * Actualiza Firestore (status → resolved) y limpia flag en RTDB.
   */
  async function cancel() {
    try {
      // 1. Desactivar
      isActive = false;
      var uid = _getUid();

      // 2. Detener rastreo GPS de emergencia
      var GPS = window.VidaSegura.GPS;
      if (GPS) {
        GPS.stopTracking();
      }

      // 3. Limpiar temporizador transcurrido
      if (sosTimer) {
        clearInterval(sosTimer);
        sosTimer = null;
      }

      // 4. Actualizar alerta en Firestore → estado 'resolved'
      if (activeAlert && activeAlert.firestoreId) {
        try {
          await firestore.collection('alerts').doc(activeAlert.firestoreId).update({
            status:     'resolved',
            resolvedAt: Date.now()
          });
          console.log('[SOS] Alerta actualizada en Firestore:', activeAlert.firestoreId);
        } catch (fsErr) {
          console.warn('[SOS] Error actualizando alerta en Firestore:', fsErr);
        }
      }
      activeAlert = null;

      // 5. Limpiar flag sosActive en Realtime Database
      if (uid) {
        try {
          await realtimeDb.ref('users/' + uid + '/sosActive').set(false);
        } catch (rtErr) {
          console.warn('[SOS] Error limpiando sosActive en RTDB:', rtErr);
        }
      }

      // Detener vibración
      if (navigator.vibrate) {
        navigator.vibrate(0);
      }

      // 6. Navegar al dashboard
      var App = window.VidaSegura.App;
      if (App && App.navigate) {
        App.navigate('dashboard');
      }

      // 7. Toast
      if (App && App.showToast) {
        App.showToast('Emergencia cancelada', 'success');
      }

      console.log('[SOS] Emergencia cancelada');
    } catch (err) {
      console.error('[SOS] Error cancelando emergencia:', err);
      if (window.VidaSegura.App && window.VidaSegura.App.showToast) {
        window.VidaSegura.App.showToast('Error al cancelar la emergencia', 'error');
      }
    }
  }

  /**
   * Indica si el SOS está activo actualmente.
   */
  function isSOSActive() {
    return isActive;
  }

  /**
   * Devuelve el objeto de alerta activa (o null).
   */
  function getActiveAlert() {
    return activeAlert;
  }

  // ──────────────────────────────────────────────
  return {
    init:            init,
    startCountdown:  startCountdown,
    cancelCountdown: cancelCountdown,
    activate:        activate,
    cancel:          cancel,
    isSOSActive:     isSOSActive,
    getActiveAlert:  getActiveAlert,
  };
})();
