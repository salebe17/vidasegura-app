/**
 * VidaSegura - Motor de Geofencing
 * Monitorea la posición del usuario contra Zonas Seguras de sus Círculos Familiares.
 */
window.VidaSegura = window.VidaSegura || {};
window.VidaSegura.Geofence = (function (DB, GPS) {
  'use strict';

  var _places = []; // [{ id, lat, lng, radius, name, circleId }]
  var _insideState = {}; // { placeId: true/false }
  var _active = false;

  function init() {
    if (_active) return;
    _active = true;
    GPS.onPositionUpdate(_checkPosition);
    _loadPlaces();
  }

  async function _loadPlaces() {
    try {
      var circles = await DB.getCircles();
      _places = [];
      for (var i = 0; i < circles.length; i++) {
        var circlePlaces = await DB.getPlaces(circles[i].id);
        circlePlaces.forEach(function (p) {
          p.circleId = circles[i].id;
          p.circleName = circles[i].name;
          _places.push(p);
        });
      }
      console.log('[Geofence] Lugares seguros cargados:', _places.length);
    } catch (e) {
      console.error('[Geofence] Error cargando lugares:', e);
    }
  }

  function _checkPosition(posObj) {
    if (!_places.length) return;

    var lat = posObj.lat;
    var lng = posObj.lng;

    _places.forEach(function (place) {
      var dist = _calculateDistance(lat, lng, place.lat, place.lng);
      var isInside = dist <= (place.radius || 100);

      var wasInside = _insideState[place.id] || false;

      if (isInside && !wasInside) {
        _onEnterPlace(place);
      } else if (!isInside && wasInside) {
        _onExitPlace(place);
      }

      _insideState[place.id] = isInside;
    });
  }

  function _onEnterPlace(place) {
    console.log('[Geofence] Entrando a lugar seguro:', place.name);
    _createAlert(place, 'entra');
  }

  function _onExitPlace(place) {
    console.log('[Geofence] Saliendo de lugar seguro:', place.name);
    _createAlert(place, 'sale');
  }

  async function _createAlert(place, action) {
    try {
      var user = await DB.getUser();
      var userName = user ? user.name : 'Un miembro';
      
      var alertData = {
        type: 'geofence',
        title: action === 'entra' ? 'Llegada a Lugar Seguro' : 'Salida de Lugar Seguro',
        message: userName + (action === 'entra' ? ' acaba de llegar a ' : ' acaba de salir de ') + place.name + ' (' + place.circleName + ').',
        userId: firebaseAuth.currentUser.uid,
        userName: userName,
        timestamp: Date.now(),
        lat: place.lat,
        lng: place.lng
      };

      // Guardar alerta en DB para que todos los miembros del círculo la vean
      await DB.saveAlert(alertData);
      
      // Mostrar notificación local si la app está abierta
      if (window.VidaSegura.App && window.VidaSegura.App.showToast) {
        window.VidaSegura.App.showToast(alertData.message);
      }
    } catch (e) {
      console.error('[Geofence] Error creando alerta:', e);
    }
  }

  // Haversine formula
  function _calculateDistance(lat1, lon1, lat2, lon2) {
    var R = 6371e3; // Metros
    var φ1 = lat1 * Math.PI/180;
    var φ2 = lat2 * Math.PI/180;
    var Δφ = (lat2-lat1) * Math.PI/180;
    var Δλ = (lon2-lon1) * Math.PI/180;

    var a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
  }

  return {
    init: init,
    reload: _loadPlaces
  };

})(window.VidaSegura.DB, window.VidaSegura.GPS);
