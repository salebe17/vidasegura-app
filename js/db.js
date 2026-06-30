/**
 * VidaSegura — Módulo de Base de Datos (Firebase)
 * Wrapper para Firestore (datos de usuario, círculos, mensajes, alertas, ajustes)
 * y Realtime Database (ubicación actual e historial en tiempo real).
 *
 * Usa los globales definidos en firebase-config.js:
 *   firebaseAuth, firestore, realtimeDb
 *
 * API pública idéntica a la versión IndexedDB para compatibilidad total.
 */
window.VidaSegura = window.VidaSegura || {};
window.VidaSegura.DB = (function () {
  'use strict';

  // ── Estado interno ──────────────────────────────────────────────────────────

  /** @type {boolean} Indica si Firebase fue verificado */
  var _ready = false;

  /** Listeners activos de ubicación en Realtime Database (userId → unsubscribe fn) */
  var _locationListeners = {};

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Devuelve el UID del usuario autenticado.
   * Lanza error si no hay sesión activa.
   * @returns {string}
   */
  function _uid() {
    var user = firebaseAuth.currentUser;
    if (!user) {
      throw new Error('[DB] No hay usuario autenticado. Inicia sesión primero.');
    }
    return user.uid;
  }

  /**
   * Referencia a la colección/documento de Firestore.
   * Atajo para evitar repetir firestore.collection(...).
   */
  function _usersDoc(uid) {
    return firestore.collection('users').doc(uid || _uid());
  }

  // ── INICIALIZACIÓN ──────────────────────────────────────────────────────────

  /**
   * Verifica que Firebase esté listo para usarse.
   * Compatible con la firma anterior: DB.init() → Promise
   * @returns {Promise<void>}
   */
  function init() {
    return new Promise(function (resolve, reject) {
      try {
        if (_ready) {
          resolve();
          return;
        }

        // Verificar que los servicios globales existan
        if (typeof firebaseAuth === 'undefined' ||
            typeof firestore === 'undefined' ||
            typeof realtimeDb === 'undefined') {
          throw new Error('Los servicios de Firebase no están disponibles. Verifica firebase-config.js.');
        }

        _ready = true;
        console.log('[DB] Firebase verificado y listo.');
        resolve();
      } catch (err) {
        console.error('[DB] Error al inicializar:', err);
        reject(err);
      }
    });
  }

  // ── USERS ───────────────────────────────────────────────────────────────────
  // Firestore: users/{uid}

  /**
   * Obtiene el perfil del usuario autenticado desde Firestore.
   * @returns {Promise<Object|null>}
   */
  async function getUser() {
    try {
      var uid = _uid();
      var doc = await _usersDoc(uid).get();
      if (doc.exists) {
        var data = doc.data();
        data.id = uid; // Garantizar que el id siempre esté presente
        return data;
      }
      return null;
    } catch (e) {
      console.error('[DB.getUser]', e);
      return null;
    }
  }

  /**
   * Guarda (o sobreescribe) el perfil completo del usuario en Firestore.
   * Asigna createdAt y updatedAt si no existen.
   * @param {Object} userData
   * @returns {Promise<Object>}
   */
  async function saveUser(userData) {
    try {
      var uid = _uid();
      var now = Date.now();

      if (!userData.createdAt) {
        userData.createdAt = now;
      }
      userData.updatedAt = now;
      userData.id = uid;

      // merge: true para no borrar campos existentes que no se envíen
      await _usersDoc(uid).set(userData, { merge: true });
      console.log('[DB.saveUser] Perfil guardado en Firestore.');
      return userData;
    } catch (e) {
      console.error('[DB.saveUser]', e);
      throw e;
    }
  }

  /**
   * Actualiza campos específicos del usuario actual en Firestore.
   * @param {Object} fields - Campos a actualizar.
   * @returns {Promise<Object>}
   */
  async function updateUser(fields) {
    try {
      var uid = _uid();
      fields.updatedAt = Date.now();

      await _usersDoc(uid).update(fields);

      // Devolver el documento completo actualizado
      var updated = await getUser();
      console.log('[DB.updateUser] Perfil actualizado.');
      return updated;
    } catch (e) {
      console.error('[DB.updateUser]', e);
      throw e;
    }
  }

  // ── LOCATIONS ───────────────────────────────────────────────────────────────
  // Realtime Database: users/{uid}/location        (posición actual)
  //                    users/{uid}/locationHistory  (historial con pushId)

  /**
   * Guarda la ubicación actual del usuario.
   * Escribe en dos rutas: posición "live" y registro en historial.
   * @param {Object|number} latOrObj - Objeto {lat, lng, ...} o latitud numérica.
   * @param {number} [lng] - Longitud (solo si el primer arg es numérico).
   * @returns {Promise<Object>}
   */
  async function saveLocation(latOrObj, lng) {
    try {
      var uid = _uid();
      var location;

      if (typeof latOrObj === 'object' && latOrObj !== null) {
        location = {
          lat: latOrObj.lat,
          lng: latOrObj.lng,
          accuracy: latOrObj.accuracy || null,
          speed: latOrObj.speed || null,
          heading: latOrObj.heading || null,
          timestamp: latOrObj.timestamp || Date.now()
        };
      } else {
        location = {
          lat: latOrObj,
          lng: lng,
          timestamp: Date.now()
        };
      }

      // 1. Posición actual (sobrescribe)
      var currentRef = realtimeDb.ref('users/' + uid + '/location');
      await currentRef.set(location);

      // 2. Historial (push = auto-genera ID único)
      var historyRef = realtimeDb.ref('users/' + uid + '/locationHistory');
      await historyRef.push(location);

      return location;
    } catch (e) {
      console.error('[DB.saveLocation]', e);
      throw e;
    }
  }

  /**
   * Obtiene el historial de ubicaciones de las últimas N horas.
   * Consulta Realtime Database ordenando y filtrando por timestamp.
   * @param {number} [hours=48] - Horas hacia atrás.
   * @param {string} [targetUid] - UID opcional (si no, usa el propio).
   * @returns {Promise<Object[]>}
   */
  async function getLocations(hours, targetUid) {
    if (hours === undefined || hours === null) hours = 48;
    try {
      var uid = targetUid || _uid();
      var cutoff = Date.now() - (hours * 60 * 60 * 1000);

      var historyRef = realtimeDb.ref('users/' + uid + '/locationHistory');
      var snapshot = await historyRef
        .orderByChild('timestamp')
        .startAt(cutoff)
        .once('value');

      var locations = [];
      if (snapshot.exists()) {
        snapshot.forEach(function (child) {
          var loc = child.val();
          loc.id = child.key;
          locations.push(loc);
        });
      }

      // Ordenar descendente (más reciente primero), igual que la versión anterior
      locations.sort(function (a, b) { return b.timestamp - a.timestamp; });
      return locations;
    } catch (e) {
      console.error('[DB.getLocations]', e);
      return [];
    }
  }

  // ── CIRCLES ─────────────────────────────────────────────────────────────────
  // Firestore: circles/{circleId}
  //   → campo members (array) contiene UIDs

  /**
   * Obtiene los círculos en los que participa el usuario actual.
   * Usa array-contains para buscar el UID en el campo "members".
   * @returns {Promise<Object[]>}
   */
  async function getCircles() {
    try {
      var uid = _uid();
      var snapshot = await firestore.collection('circles')
        .where('members', 'array-contains', uid)
        .get();

      var circles = [];
      snapshot.forEach(function (doc) {
        var data = doc.data();
        data.id = doc.id;
        circles.push(data);
      });

      return circles;
    } catch (e) {
      console.error('[DB.getCircles]', e);
      return [];
    }
  }

  /**
   * Guarda (crea o actualiza) un círculo familiar.
   * Si no tiene id, Firestore genera uno automáticamente.
   * @param {Object} circle
   * @returns {Promise<Object>}
   */
  async function saveCircle(circle) {
    try {
      if (!circle.createdAt) {
        circle.createdAt = Date.now();
      }

      if (circle.id) {
        // Actualizar existente
        await firestore.collection('circles').doc(circle.id).set(circle, { merge: true });
      } else {
        // Crear nuevo — Firestore asigna el ID
        var docRef = await firestore.collection('circles').add(circle);
        circle.id = docRef.id;
      }

      console.log('[DB.saveCircle] Círculo guardado:', circle.id);
      return circle;
    } catch (e) {
      console.error('[DB.saveCircle]', e);
      throw e;
    }
  }

  /**
   * Elimina un círculo por su ID.
   * @param {string} id
   * @returns {Promise<void>}
   */
  async function deleteCircle(id) {
    try {
      await firestore.collection('circles').doc(id).delete();
      console.log('[DB.deleteCircle] Círculo eliminado:', id);
    } catch (e) {
      console.error('[DB.deleteCircle]', e);
      throw e;
    }
  }

  // ── MESSAGES ────────────────────────────────────────────────────────────────
  // Firestore: circles/{circleId}/messages/{msgId}

  /**
   * Obtiene los mensajes de un círculo, ordenados por timestamp ascendente.
   * @param {string} circleId
   * @returns {Promise<Object[]>}
   */
  async function getMessages(circleId) {
    try {
      var snapshot = await firestore.collection('circles').doc(circleId)
        .collection('messages')
        .orderBy('timestamp', 'asc')
        .get();

      var messages = [];
      snapshot.forEach(function (doc) {
        var data = doc.data();
        data.id = doc.id;
        messages.push(data);
      });

      return messages;
    } catch (e) {
      console.error('[DB.getMessages]', e);
      return [];
    }
  }

  /**
   * Guarda un mensaje en la subcolección de un círculo.
   * El objeto msg DEBE tener circleId definido.
   * @param {Object} msg
   * @returns {Promise<Object>}
   */
  async function saveMessage(msg) {
    try {
      if (!msg.circleId) {
        throw new Error('El mensaje debe tener circleId.');
      }
      if (!msg.timestamp) {
        msg.timestamp = Date.now();
      }

      var messagesRef = firestore.collection('circles').doc(msg.circleId)
        .collection('messages');

      if (msg.id) {
        await messagesRef.doc(msg.id).set(msg, { merge: true });
      } else {
        var docRef = await messagesRef.add(msg);
        msg.id = docRef.id;
      }

      return msg;
    } catch (e) {
      console.error('[DB.saveMessage]', e);
      throw e;
    }
  }

  // ── ALERTS ──────────────────────────────────────────────────────────────────
  // Firestore: alerts/{alertId}
  //   → campo userId = UID del usuario

  /**
   * Obtiene las alertas del usuario actual, ordenadas por timestamp descendente.
   * @returns {Promise<Object[]>}
   */
  async function getAlerts() {
    try {
      var uid = _uid();
      var snapshot = await firestore.collection('alerts')
        .where('userId', '==', uid)
        .orderBy('timestamp', 'desc')
        .get();

      var alerts = [];
      snapshot.forEach(function (doc) {
        var data = doc.data();
        data.id = doc.id;
        alerts.push(data);
      });

      return alerts;
    } catch (e) {
      console.error('[DB.getAlerts]', e);
      return [];
    }
  }

  /**
   * Guarda una alerta en Firestore.
   * Asigna userId, timestamp e id si no existen.
   * @param {Object} alertData
   * @returns {Promise<Object>}
   */
  async function saveAlert(alertData) {
    try {
      if (!alertData.timestamp) {
        alertData.timestamp = Date.now();
      }
      if (!alertData.userId) {
        alertData.userId = _uid();
      }

      if (alertData.id) {
        await firestore.collection('alerts').doc(alertData.id).set(alertData, { merge: true });
      } else {
        var docRef = await firestore.collection('alerts').add(alertData);
        alertData.id = docRef.id;
      }

      return alertData;
    } catch (e) {
      console.error('[DB.saveAlert]', e);
      throw e;
    }
  }

  // ── SETTINGS ────────────────────────────────────────────────────────────────
  // Firestore: users/{uid}/settings/{key}

  /**
   * Obtiene un valor de configuración por clave.
   * @param {string} key
   * @returns {Promise<*|null>}
   */
  async function getSetting(key) {
    try {
      var uid = _uid();
      var doc = await _usersDoc(uid).collection('settings').doc(key).get();
      if (doc.exists) {
        return doc.data().value;
      }
      return null;
    } catch (e) {
      console.error('[DB.getSetting]', e);
      return null;
    }
  }

  /**
   * Guarda un valor de configuración.
   * @param {string} key
   * @param {*} value
   * @returns {Promise<void>}
   */
  async function saveSetting(key, value) {
    try {
      var uid = _uid();
      await _usersDoc(uid).collection('settings').doc(key).set({ value: value });
    } catch (e) {
      console.error('[DB.saveSetting]', e);
      throw e;
    }
  }

  // ── REAL-TIME LOCATION LISTENERS (NUEVO) ────────────────────────────────────
  // Realtime Database: users/{userId}/location

  /**
   * Escucha cambios en la ubicación actual de un usuario en tiempo real.
   * Cada vez que cambia, ejecuta callback(locationData).
   * @param {string} userId - UID del usuario a observar.
   * @param {Function} callback - Recibe el objeto de ubicación o null.
   */
  function onLocationUpdate(userId, callback) {
    // Evitar duplicados: detener listener previo si existe
    offLocationUpdate(userId);

    var ref = realtimeDb.ref('users/' + userId + '/location');

    ref.on('value', function (snapshot) {
      var data = snapshot.exists() ? snapshot.val() : null;
      if (typeof callback === 'function') {
        callback(data);
      }
    }, function (error) {
      console.error('[DB.onLocationUpdate] Error escuchando ubicación de', userId, ':', error);
    });

    // Guardar referencia para poder detenerlo después
    _locationListeners[userId] = ref;
    console.log('[DB.onLocationUpdate] Escuchando ubicación de:', userId);
  }

  /**
   * Detiene la escucha en tiempo real de la ubicación de un usuario.
   * @param {string} userId - UID del usuario.
   */
  function offLocationUpdate(userId) {
    if (_locationListeners[userId]) {
      _locationListeners[userId].off('value');
      delete _locationListeners[userId];
      console.log('[DB.offLocationUpdate] Detenida escucha de:', userId);
    }
  }

  // ── MANTENIMIENTO ───────────────────────────────────────────────────────────

  /**
   * Cierra sesión en Firebase Auth y limpia datos locales.
   * La data en Firestore se mantiene (solo se cierra la sesión local).
   * @returns {Promise<void>}
   */
  async function clearAll() {
    try {
      // Detener todos los listeners de ubicación activos
      var userIds = Object.keys(_locationListeners);
      for (var i = 0; i < userIds.length; i++) {
        offLocationUpdate(userIds[i]);
      }

      // Cerrar sesión de Firebase Auth
      await firebaseAuth.signOut();

      // Limpiar caché local de Firestore (si el navegador lo soporta)
      try {
        await firestore.clearPersistence();
      } catch (_) {
        // clearPersistence solo funciona si no hay otros listeners activos;
        // no es crítico si falla
      }

      console.log('[DB.clearAll] Sesión cerrada y datos locales limpiados.');
    } catch (e) {
      console.error('[DB.clearAll]', e);
      throw e;
    }
  }

  // ── PLACES (ZONAS SEGURAS) ──────────────────────────────────────────────────
  // Firestore: circles/{circleId}/places/{placeId}

  async function getPlaces(circleId) {
    try {
      var snapshot = await firestore.collection('circles').doc(circleId)
        .collection('places').get();
      var places = [];
      snapshot.forEach(function (doc) {
        var p = doc.data();
        p.id = doc.id;
        places.push(p);
      });
      return places;
    } catch (e) {
      console.error('[DB.getPlaces]', e);
      return [];
    }
  }

  async function savePlace(circleId, place) {
    try {
      if (!place.id) {
        var ref = firestore.collection('circles').doc(circleId).collection('places').doc();
        place.id = ref.id;
      }
      if (!place.timestamp) place.timestamp = Date.now();
      await firestore.collection('circles').doc(circleId)
        .collection('places').doc(place.id).set(place);
      return place;
    } catch (e) {
      console.error('[DB.savePlace]', e);
      throw e;
    }
  }

  async function deletePlace(circleId, placeId) {
    try {
      await firestore.collection('circles').doc(circleId).collection('places').doc(placeId).delete();
    } catch (e) {
      console.error('[DB.deletePlace]', e);
      throw e;
    }
  }

  // ── COMMUNITY REPORTS ────────────────────────────────────────────────────────
  // Firestore: community_reports/{reportId}

  async function getCommunityReports(hours) {
    if (!hours) hours = 24;
    try {
      var cutoff = Date.now() - (hours * 60 * 60 * 1000);
      var snapshot = await firestore.collection('community_reports')
        .where('timestamp', '>=', cutoff)
        .get();
      var reports = [];
      snapshot.forEach(function (doc) {
        var r = doc.data();
        r.id = doc.id;
        reports.push(r);
      });
      return reports;
    } catch (e) {
      console.error('[DB.getCommunityReports]', e);
      return [];
    }
  }

  async function saveCommunityReport(report) {
    try {
      if (!report.id) {
        var ref = firestore.collection('community_reports').doc();
        report.id = ref.id;
      }
      report.timestamp = Date.now();
      report.authorId = _uid();
      await firestore.collection('community_reports').doc(report.id).set(report);
      return report;
    } catch (e) {
      console.error('[DB.saveCommunityReport]', e);
      throw e;
    }
  }

  // ── API PÚBLICA ─────────────────────────────────────────────────────────────

  return {
    init:             init,

    // Users
    getUser:          getUser,
    saveUser:         saveUser,
    updateUser:       updateUser,

    // Locations
    saveLocation:     saveLocation,
    getLocations:     getLocations,

    // Circles
    getCircles:       getCircles,
    saveCircle:       saveCircle,
    deleteCircle:     deleteCircle,

    // Places (Zonas Seguras)
    getPlaces:        getPlaces,
    savePlace:        savePlace,
    deletePlace:      deletePlace,

    // Community Reports
    getCommunityReports: getCommunityReports,
    saveCommunityReport: saveCommunityReport,

    // Messages
    getMessages:      getMessages,
    saveMessage:      saveMessage,

    // Alerts
    getAlerts:        getAlerts,
    saveAlert:        saveAlert,

    // Settings
    getSetting:       getSetting,
    saveSetting:      saveSetting,

    // Real-time location (NUEVO)
    onLocationUpdate:  onLocationUpdate,
    offLocationUpdate: offLocationUpdate,

    // Mantenimiento
    clearAll:         clearAll
  };
})();
window.DB = window.VidaSegura.DB;
