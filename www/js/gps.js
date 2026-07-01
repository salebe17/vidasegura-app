/**
 * VidaSegura — GPS Module (Firebase Realtime Database)
 * 
 * Proporciona servicios de geolocalización: obtención de posición única,
 * seguimiento continuo (modos normal y emergencia), detección de batería,
 * y persistencia en tiempo real via Firebase Realtime Database.
 *
 * Rutas en Realtime Database:
 *   users/{uid}/location          → posición actual (sobrescribe siempre)
 *   users/{uid}/locationHistory   → historial de posiciones (push/append)
 *
 * Globals requeridos: firebaseAuth, realtimeDb (de firebase-config.js)
 */
window.VidaSegura = window.VidaSegura || {};
window.VidaSegura.GPS = (function () {
  'use strict';

  // ──────────────────────────────────────────────
  // Estado privado
  // ──────────────────────────────────────────────
  var watchId              = null;
  var lastPosition         = null;
  var callbacks            = [];
  var trackingMode         = 'off'; // 'off' | 'normal' | 'emergency'
  var disconnectRefSetUp   = false; // evita registrar onDisconnect más de una vez
  var lastPersistTimestamp = 0;     // throttle para escrituras en modo normal

  // Intervalo mínimo entre escrituras a RTDB en modo normal (ms).
  // En modo emergencia se escribe cada actualización.
  var NORMAL_WRITE_INTERVAL_MS = 15000; // 15 segundos

  // ──────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────

  /**
   * Normaliza un GeolocationPosition nativo en un objeto plano.
   */
  function normalise(pos) {
    return {
      lat:       pos.coords.latitude,
      lng:       pos.coords.longitude,
      accuracy:  pos.coords.accuracy,
      altitude:  pos.coords.altitude  || null,
      speed:     pos.coords.speed     || null,
      heading:   pos.coords.heading   || null,
      timestamp: pos.timestamp || Date.now(),
    };
  }

  /**
   * Obtiene el UID del usuario autenticado en Firebase.
   * @returns {string|null}
   */
  function getUid() {
    try {
      var user = firebaseAuth.currentUser;
      return user ? user.uid : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Configura el handler onDisconnect para marcar al usuario como offline
   * cuando pierde la conexión.  Solo se registra una vez por sesión.
   */
  function setupOnDisconnect(uid) {
    if (disconnectRefSetUp) return;
    try {
      var onlineRef = realtimeDb.ref('users/' + uid + '/location/online');
      onlineRef.onDisconnect().set(false);
      disconnectRefSetUp = true;
      console.log('[GPS] Handler onDisconnect configurado para uid:', uid);
    } catch (err) {
      console.warn('[GPS] No se pudo configurar onDisconnect:', err);
    }
  }

  /**
   * Persiste la posición en Firebase Realtime Database.
   *
   * 1. Sobrescribe  users/{uid}/location  con la posición actual + online:true
   * 2. Agrega (push) a  users/{uid}/locationHistory  un registro compacto
   *
   * En modo normal se aplica throttle para no saturar la base de datos.
   * En modo emergencia se escribe cada posición sin demora.
   */
  async function persistPosition(posObj) {
    var uid = getUid();
    if (!uid) {
      // Sin usuario autenticado — no podemos escribir a RTDB
      return;
    }

    // Throttle en modo normal
    var now = Date.now();
    if (trackingMode === 'normal' && (now - lastPersistTimestamp) < NORMAL_WRITE_INTERVAL_MS) {
      return;
    }
    lastPersistTimestamp = now;

    // Configurar onDisconnect la primera vez
    setupOnDisconnect(uid);

    var batteryLvl = null;
    var charging = null;
    try {
      if (navigator.getBattery) {
        var battery = await navigator.getBattery();
        batteryLvl = Math.round(battery.level * 100);
        charging = battery.charging;
      }
    } catch (e) {
      console.warn('[GPS] Error obteniendo batería:', e);
    }

    // 1. Posición actual (sobrescribe)
    var currentLocationRef = realtimeDb.ref('users/' + uid + '/location');
    var currentData = {
      lat:       posObj.lat,
      lng:       posObj.lng,
      accuracy:  posObj.accuracy  || null,
      altitude:  posObj.altitude  || null,
      speed:     posObj.speed     || null,
      heading:   posObj.heading   || null,
      timestamp: posObj.timestamp || Date.now(),
      online:    true,
      battery:   batteryLvl,
      charging:  charging
    };

    currentLocationRef.set(currentData).catch(function (err) {
      console.error('[GPS] Error escribiendo ubicación actual a RTDB:', err);
    });

    // 2. Historial (append con push)
    var historyData = {
      lat:       posObj.lat,
      lng:       posObj.lng,
      accuracy:  posObj.accuracy || null,
      altitude:  posObj.altitude || null,
      speed:     posObj.speed || null,
      heading:   posObj.heading || null,
      battery:   batteryLvl,
      charging:  charging,
      timestamp: posObj.timestamp || Date.now(),
    };

    if (navigator.onLine) {
      // Subir directo
      var historyRef = realtimeDb.ref('users/' + uid + '/locationHistory');
      historyRef.push(historyData).catch(function (err) {
        console.error('[GPS] Error escribiendo historial a RTDB:', err);
        _queueOfflineLocation(historyData);
      });
      // Intentar sincronizar lo pendiente
      syncOfflineLocations();
    } else {
      // Guardar local
      _queueOfflineLocation(historyData);
    }
  }

  function _queueOfflineLocation(data) {
    try {
      var queue = JSON.parse(localStorage.getItem('vs_offline_locations') || '[]');
      queue.push(data);
      // Limitar el tamaño a unas 2000 ubicaciones (~2-4 dias)
      if (queue.length > 2000) queue = queue.slice(-2000);
      localStorage.setItem('vs_offline_locations', JSON.stringify(queue));
    } catch(e) { console.warn('[GPS] Error guardando offline', e); }
  }

  async function syncOfflineLocations() {
    var uid = getUid();
    if (!uid || !navigator.onLine) return;
    try {
      var queue = JSON.parse(localStorage.getItem('vs_offline_locations') || '[]');
      if (queue.length === 0) return;
      
      var historyRef = realtimeDb.ref('users/' + uid + '/locationHistory');
      
      // Batch update is not natively array push in RTDB, we must push individually or create a big update object.
      // Since RTDB push creates a unique key, we can do it via a bulk update:
      var updates = {};
      queue.forEach(function(loc) {
        var newKey = historyRef.push().key;
        updates[newKey] = loc;
      });
      
      await historyRef.update(updates);
      localStorage.removeItem('vs_offline_locations');
      console.log('[GPS] Sincronizados', queue.length, 'puntos offline.');
    } catch(e) {
      console.warn('[GPS] Error sincronizando offline:', e);
    }
  }

  // Escuchar cuando vuelva internet para sincronizar rápido
  window.addEventListener('online', syncOfflineLocations);

  /**
   * Dispara todos los callbacks registrados con la posición más reciente.
   */
  function fireCallbacks(posObj) {
    callbacks.forEach(function (cb) {
      try { cb(posObj); } catch (e) {
        console.error('[GPS] Error en callback de posición:', e);
      }
    });
  }

  /**
   * Handler de éxito compartido para watchPosition.
   */
  function onWatchSuccess(geolocationPos) {
    var posObj = normalise(geolocationPos);
    lastPosition = posObj;
    persistPosition(posObj);
    fireCallbacks(posObj);
  }

  /**
   * Handler de error compartido para watchPosition.
   */
  function onWatchError(err) {
    console.warn('[GPS] Error de seguimiento:', err.message || err);
  }

  // ──────────────────────────────────────────────
  // API Pública
  // ──────────────────────────────────────────────

  /**
   * Inicializa el módulo GPS: verifica disponibilidad de la API de
   * geolocalización y realiza un intento silencioso de obtener la posición
   * inicial.
   */
  function init() {
    try {
      function continueInit() {
        if (!navigator.geolocation) {
          console.warn('[GPS] Geolocalización no disponible en este dispositivo');
          if (window.VidaSegura.App && window.VidaSegura.App.showToast) {
            window.VidaSegura.App.showToast(
              'Tu dispositivo no soporta geolocalización', 'warning'
            );
          }
          return;
        }

        // Intento silencioso de posición inicial
        navigator.geolocation.getCurrentPosition(
          function (pos) {
            lastPosition = normalise(pos);
            persistPosition(lastPosition);
            console.log('[GPS] Posición inicial obtenida');
            // Auto-iniciar seguimiento normal para compartir ubicación
            startTracking('normal');
          },
          function (err) {
            // Silencioso — no molestar al usuario si no ha dado permiso aún
            console.log('[GPS] Posición inicial no obtenida:', err.message || err);
          },
          { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
        );

        // Escuchar cambios de autenticación para reconfigurar onDisconnect
        firebaseAuth.onAuthStateChanged(function (user) {
          if (user) {
            disconnectRefSetUp = false; // Permitir re-configurar con nuevo uid
            setupOnDisconnect(user.uid);
            console.log('[GPS] Usuario autenticado, onDisconnect configurado');
          } else {
            disconnectRefSetUp = false;
          }
        });

        console.log('[GPS] Módulo inicializado (Firebase Realtime Database)');
      }

      // Capacitor Geolocation permissions with Prominent Disclosure
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Geolocation) {
        var hasSeenDisclosure = localStorage.getItem('vs_prominent_disclosure_accepted');
        
        if (!hasSeenDisclosure) {
          // Show disclosure modal
          var overlay = document.getElementById('modal-disclosure-overlay');
          var acceptBtn = document.getElementById('btn-accept-disclosure');
          
          if (overlay && acceptBtn) {
            overlay.classList.remove('hidden');
            
            acceptBtn.onclick = function() {
              localStorage.setItem('vs_prominent_disclosure_accepted', 'true');
              overlay.classList.add('hidden');
              
              // Request permissions after disclosure is accepted
              window.Capacitor.Plugins.Geolocation.requestPermissions().then(function(status) {
                console.log('[GPS] Capacitor permissions status:', status);
                continueInit();
              }).catch(function(e) {
                console.warn('[GPS] Error requesting Capacitor permissions:', e);
                continueInit();
              });
            };
          } else {
            // Fallback if UI not found
            continueInit();
          }
        } else {
          // Already seen, just request/check
          window.Capacitor.Plugins.Geolocation.requestPermissions().then(function(status) {
            console.log('[GPS] Capacitor permissions status:', status);
            continueInit();
          }).catch(function(e) {
            console.warn('[GPS] Error requesting Capacitor permissions:', e);
            continueInit();
          });
        }
      } else {
        continueInit();
      }
    } catch (err) {
      console.error('[GPS] Error durante init:', err);
    }
  }

  /**
   * Obtiene la posición actual como promesa (una sola vez).
   * @returns {Promise<{lat, lng, accuracy, altitude, speed, timestamp}>}
   */
  function getCurrentPosition() {
    return new Promise(function (resolve, reject) {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Geolocation) {
        window.Capacitor.Plugins.Geolocation.getCurrentPosition({ enableHighAccuracy: true })
          .then(function(pos) {
             var posObj = normalise(pos);
             lastPosition = posObj;
             persistPosition(posObj);
             resolve(posObj);
          })
          .catch(function(err) {
             console.warn('[GPS] Capacitor getCurrentPosition error', err);
             reject(err);
          });
        return;
      }

      if (!navigator.geolocation) {
        reject(new Error('Geolocalización no disponible'));
        return;
      }

      // Usar alta precisión según configuración del usuario (default: true)
      var highAccuracy = true;
      try {
        var settings = window.VidaSegura.DB && window.VidaSegura.DB.getSettings
          ? window.VidaSegura.DB.getSettings()
          : null;
        if (settings && settings.highAccuracy !== undefined) {
          highAccuracy = !!settings.highAccuracy;
        }
      } catch (_) { /* usar default */ }

      navigator.geolocation.getCurrentPosition(
        function (pos) {
          var posObj = normalise(pos);
          lastPosition = posObj;
          persistPosition(posObj);
          resolve(posObj);
        },
        function (err) {
          console.warn('[GPS] Error obteniendo posición:', err.message || err);
          reject(err);
        },
        { enableHighAccuracy: highAccuracy, timeout: 15000, maximumAge: 0 }
      );
    });
  }

  /**
   * Inicia el seguimiento continuo de posición.
   * @param {'normal'|'emergency'} mode
   */
  function startTracking(mode) {
    try {
      mode = mode || 'normal';

      // Detener cualquier watch existente primero
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }

      if (!navigator.geolocation) {
        console.warn('[GPS] Geolocalización no disponible');
        return;
      }

      var options;
      if (mode === 'emergency') {
        options = {
          enableHighAccuracy: true,
          maximumAge:         0,
          timeout:            30000,
        };
        // En emergencia, resetear throttle para escribir inmediatamente
        lastPersistTimestamp = 0;
      } else {
        options = {
          enableHighAccuracy: false,
          maximumAge:         60000,  // 1 minuto
          timeout:            30000,  // 30 segundos
        };
      }

      watchId = navigator.geolocation.watchPosition(
        onWatchSuccess,
        onWatchError,
        options
      );

      trackingMode = mode;
      console.log('[GPS] Seguimiento iniciado — modo:', mode);
    } catch (err) {
      console.error('[GPS] Error iniciando seguimiento:', err);
    }
  }

  /**
   * Detiene el seguimiento continuo.
   * Marca la ubicación actual como offline en RTDB.
   */
  function stopTracking() {
    try {
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }
      trackingMode = 'off';

      // Marcar como offline al detener el tracking
      var uid = getUid();
      if (uid) {
        realtimeDb.ref('users/' + uid + '/location/online').set(false)
          .catch(function (err) {
            console.warn('[GPS] Error marcando offline:', err);
          });
      }

      console.log('[GPS] Seguimiento detenido');
    } catch (err) {
      console.error('[GPS] Error deteniendo seguimiento:', err);
    }
  }

  /**
   * Retorna la última posición conocida o null.
   */
  function getLastKnownPosition() {
    return lastPosition;
  }

  /**
   * Registra un callback que se ejecuta en cada actualización de posición.
   * @param {Function} callback  Recibe un posObj.
   */
  function onPositionUpdate(callback) {
    if (typeof callback === 'function') {
      callbacks.push(callback);
    }
  }

  /**
   * Indica si el seguimiento está activo.
   */
  function isTracking() {
    return trackingMode !== 'off';
  }

  /**
   * Retorna el modo de seguimiento actual.
   */
  function getTrackingMode() {
    return trackingMode;
  }

  /**
   * Intenta leer el nivel de batería del dispositivo.
   * @returns {Promise<number|null>}  Porcentaje (0–100) o null.
   */
  async function getBatteryLevel() {
    try {
      if (!navigator.getBattery) return null;
      var battery = await navigator.getBattery();
      return Math.round(battery.level * 100);
    } catch (err) {
      console.warn('[GPS] No se pudo obtener nivel de batería:', err);
      return null;
    }
  }

  // ──────────────────────────────────────────────
  return {
    init:                 init,
    getCurrentPosition:   getCurrentPosition,
    startTracking:        startTracking,
    stopTracking:         stopTracking,
    getLastKnownPosition: getLastKnownPosition,
    onPositionUpdate:     onPositionUpdate,
    isTracking:           isTracking,
    getTrackingMode:      getTrackingMode,
    getBatteryLevel:      getBatteryLevel,
  };
})();
