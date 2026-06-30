/**
 * VidaSegura — Map Module
 * Manages Leaflet map instances across multiple containers, markers,
 * user-location display, and emergency-resource overlays.
 */
window.VidaSegura = window.VidaSegura || {};
window.VidaSegura.Map = (function () {
  'use strict';

  // ──────────────────────────────────────────────
  // Private state
  // ──────────────────────────────────────────────
  var maps    = {};   // keyed by containerId
  var markers = {};   // keyed by markerId

  // Default center: Venezuela
  var DEFAULT_CENTER = [8.0, -66.0];
  var DEFAULT_ZOOM   = 7;

  var TILE_URL    = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  var TILE_ATTR   = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

  // Resource icon mapping
  var RESOURCE_ICONS = {
    hospital: '🏥',
    fire:     '🚒',
    shelter:  '⛑️',
    water:    '💧',
  };

  function $(id) {
    return document.getElementById(id);
  }

  // ──────────────────────────────────────────────
  async function showSelfHistory(uid) {
    try {
      var map = maps['map-container'];
      if (!map) return;
      var locs = await window.VidaSegura.DB.getLocations(24, uid);
      if (!locs || locs.length < 2) {
        if (window.VidaSegura.App && window.VidaSegura.App.showToast) {
          window.VidaSegura.App.showToast('No hay suficiente historial para mostrar.', 'warning');
        }
        return;
      }
      
      var latlngs = locs.map(function(l) { return [l.lat, l.lng]; });
      if (markers['self-history-line']) {
        try { map.removeLayer(markers['self-history-line']); } catch(e){}
      }
      var polyline = L.polyline(latlngs, {color: '#1a56db', weight: 4, opacity: 0.7}).addTo(map);
      
      markers['self-history-line'] = polyline;
      map.fitBounds(polyline.getBounds());
      
      if (window.VidaSegura.App && window.VidaSegura.App.showToast) {
        window.VidaSegura.App.showToast('Mostrando tu historial de las últimas 24 horas.', 'info');
      }
    } catch(e) {
      console.error('[Map] Error showSelfHistory:', e);
      if (window.VidaSegura.App && window.VidaSegura.App.showToast) {
        window.VidaSegura.App.showToast('Error al obtener el historial.', 'error');
      }
    }
  }

  //  Public API 
  // ──────────────────────────────────────────────

  /**
   * Initialise (or re-initialise) a Leaflet map inside the given container.
   * @param {string} containerId  DOM id of the map container.
   * @param {object} options      Optional {center:[lat,lng], zoom:number}.
   * @returns {L.Map|null}
   */
  function init(containerId, options) {
    try {
      containerId = containerId || 'map-container';
      options     = options     || {};

      // Guard: Leaflet must be loaded
      if (typeof L === 'undefined') {
        console.error('[Map] Leaflet (L) no está cargado');
        if (window.VidaSegura.App && window.VidaSegura.App.showToast) {
          window.VidaSegura.App.showToast('Error: librería de mapas no disponible', 'error');
        }
        return null;
      }

      // Destroy existing map for this container
      if (maps[containerId]) {
        destroy(containerId);
      }

      var containerEl = $(containerId);
      if (!containerEl) {
        console.error('[Map] Contenedor no encontrado: #' + containerId);
        return null;
      }

      var center = options.center || DEFAULT_CENTER;
      var zoom   = options.zoom   || DEFAULT_ZOOM;

      var map = L.map(containerId, {
        center:          center,
        zoom:            zoom,
        zoomControl:     true,
        attributionControl: true,
      });

      L.tileLayer(TILE_URL, {
        attribution: TILE_ATTR,
        maxZoom:     19,
      }).addTo(map);

      maps[containerId] = map;

      // Fix tile rendering when the container was hidden
      setTimeout(function () {
        map.invalidateSize();
      }, 200);

      if (containerId === 'map-container') {
        _bindMapControls();
        _renderCommunityReports();
      }

      console.log('[Map] Mapa inicializado en #' + containerId);
      return map;
    } catch (err) {
      console.error('[Map] Error inicializando mapa:', err);
      return null;
    }
  }

  /**
   * Retrieve an existing map instance.
   */
  function getMap(containerId) {
    return maps[containerId] || null;
  }

  /**
   * Re-centre a map.
   */
  function setCenter(containerId, lat, lng, zoom) {
    try {
      var map = maps[containerId];
      if (!map) {
        console.warn('[Map] Mapa no encontrado para #' + containerId);
        return;
      }
      map.setView([lat, lng], zoom || map.getZoom());
    } catch (err) {
      console.error('[Map] Error al centrar mapa:', err);
    }
  }

  /**
   * Add (or replace) a marker on a map.
   * @param {string} containerId
   * @param {string} id           Unique marker id.
   * @param {number} lat
   * @param {number} lng
   * @param {object} options      {icon, popup, color}
   * @returns {L.Marker|L.CircleMarker|null}
   */
  function addMarker(containerId, id, lat, lng, options) {
    try {
      var map = maps[containerId];
      if (!map) {
        console.warn('[Map] Mapa no encontrado para #' + containerId);
        return null;
      }

      options = options || {};

      // Remove existing marker with same id
      if (markers[id]) {
        try { map.removeLayer(markers[id]); } catch (_) {}
        delete markers[id];
      }

      var marker;

      if (options.color) {
        // Circle marker
        marker = L.circleMarker([lat, lng], {
          radius:      8,
          color:       options.color,
          fillColor:   options.color,
          fillOpacity: 0.7,
          weight:      2,
        }).addTo(map);
      } else if (options.icon) {
        // Custom divIcon
        var divIcon = L.divIcon({
          html:      options.icon,
          className: 'custom-map-icon',
          iconSize:  [30, 30],
          iconAnchor:[15, 15],
        });
        marker = L.marker([lat, lng], { icon: divIcon }).addTo(map);
      } else {
        // Default marker
        marker = L.marker([lat, lng]).addTo(map);
      }

      if (options.popup) {
        marker.bindPopup(options.popup);
      }

      markers[id] = marker;
      return marker;
    } catch (err) {
      console.error('[Map] Error agregando marcador:', err);
      return null;
    }
  }

  // ── CONTROLES Y REPORTES COMUNITARIOS ──────────────────────────────────────

  function _bindMapControls() {
    var btnCenter = document.getElementById('btn-map-center');
    if (btnCenter) {
      btnCenter.onclick = function() {
        showUserLocation('map-container');
        if (window.VidaSegura.GPS) {
          window.VidaSegura.GPS.getCurrentPosition(true).then(function(pos) {
            setCenter('map-container', pos.lat, pos.lng, 16);
          });
        }
      };
    }

    var btnReport = document.getElementById('btn-map-report');
    if (btnReport) {
      btnReport.onclick = function() {
        var modal = document.getElementById('modal-report');
        if (modal) modal.classList.remove('hidden');
      };
    }

    var btnCancel = document.getElementById('btn-cancel-report');
    if (btnCancel) {
      btnCancel.onclick = function() {
        var modal = document.getElementById('modal-report');
        if (modal) modal.classList.add('hidden');
      };
    }

    var btnConfirm = document.getElementById('btn-confirm-report');
    if (btnConfirm) {
      btnConfirm.onclick = async function() {
        var type = document.getElementById('report-type').value;
        var desc = document.getElementById('report-desc').value;
        
        try {
          var btn = this;
          btn.disabled = true;
          btn.textContent = 'Enviando...';

          var pos = await window.VidaSegura.GPS.getCurrentPosition(false);
          await window.VidaSegura.DB.saveCommunityReport({
            type: type,
            desc: desc,
            lat: pos.lat,
            lng: pos.lng
          });

          var modal = document.getElementById('modal-report');
          if (modal) modal.classList.add('hidden');
          
          if (window.VidaSegura.App && window.VidaSegura.App.showToast) {
            window.VidaSegura.App.showToast('Reporte comunitario publicado', 'success');
          }
          
          _renderCommunityReports();

        } catch (e) {
          console.error('[Map] Error enviando reporte:', e);
          if (window.VidaSegura.App && window.VidaSegura.App.showToast) {
            window.VidaSegura.App.showToast('No se pudo enviar el reporte. Verifica tu conexión.', 'error');
          }
        } finally {
          var btn2 = document.getElementById('btn-confirm-report');
          if (btn2) {
            btn2.disabled = false;
            btn2.textContent = 'Publicar Reporte';
          }
        }
      };
    }
  }

  async function _renderCommunityReports() {
    var map = maps['map-container'];
    if (!map) return;

    try {
      var reports = await window.VidaSegura.DB.getCommunityReports(24);
      reports.forEach(function(r) {
        var iconStr = '⚠️';
        if (r.type === 'robo') iconStr = '🚨';
        if (r.type === 'sospechoso') iconStr = '👀';
        if (r.type === 'accidente') iconStr = '💥';
        if (r.type === 'obra') iconStr = '🚧';
        if (r.type === 'sin_luz') iconStr = '🌑';

        var divIcon = L.divIcon({
          html: '<div style="font-size: 24px; background: white; border-radius: 50%; padding: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">' + iconStr + '</div>',
          className: 'community-report-icon',
          iconSize: [36, 36],
          iconAnchor: [18, 18]
        });

        var timeStr = new Date(r.timestamp).toLocaleTimeString();
        var navBtn = '<div style="margin-top:5px;"><button class="btn btn-sm btn-primary" style="padding:2px 8px; font-size:12px;" onclick="window.open(\'https://www.google.com/maps/dir/?api=1&destination=' + r.lat + ',' + r.lng + '\', \'_system\')">Navegar hacia allá</button></div>';
        var popupHTML = '<strong>' + r.type.toUpperCase() + '</strong><br>' +
                        '<small>' + timeStr + '</small><br>' +
                        (r.desc ? '<p>' + _escapeHtml(r.desc) + '</p>' : '') + navBtn;

        L.marker([r.lat, r.lng], { icon: divIcon })
         .addTo(map)
         .bindPopup(popupHTML);
      });
    } catch (e) {
      console.error('[Map] Error rendering reports:', e);
    }
  }

  function _escapeHtml(text) {
    if (!text) return '';
    var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(text).replace(/[&<>"']/g, function(m) { return map[m]; });
  }

  /**
   * Remove a marker by id.
   */
  function removeMarker(id) {
    try {
      if (!markers[id]) return;
      // Find which map it belongs to and remove
      Object.keys(maps).forEach(function (cid) {
        try { maps[cid].removeLayer(markers[id]); } catch (_) {}
      });
      delete markers[id];
    } catch (err) {
      console.error('[Map] Error eliminando marcador:', err);
    }
  }

  /**
   * Update a marker's position.
   */
  function updateMarker(id, lat, lng) {
    try {
      if (!markers[id]) return;
      markers[id].setLatLng([lat, lng]);
    } catch (err) {
      console.error('[Map] Error actualizando marcador:', err);
    }
  }

  /**
   * Show the user's current location on the map with a pulsing blue dot.
   */
  async function showUserLocation(containerId) {
    try {
      var GPS = window.VidaSegura.GPS;
      if (!GPS) {
        console.warn('[Map] Módulo GPS no disponible');
        return;
      }

      var pos = await GPS.getCurrentPosition();
      if (!pos) return;

      setCenter(containerId, pos.lat, pos.lng, 15);

      // Pulsing blue dot via divIcon with CSS class
      var pulsingIcon = L.divIcon({
        html:      '<div class="user-location-dot"><div class="user-location-pulse"></div></div>',
        className: 'user-location-icon',
        iconSize:  [20, 20],
        iconAnchor:[10, 10],
      });

      var map = maps[containerId];
      if (!map) return;

      // Remove previous user marker
      if (markers['user-location']) {
        try { map.removeLayer(markers['user-location']); } catch (_) {}
      }

      var userMarker = L.marker([pos.lat, pos.lng], { icon: pulsingIcon }).addTo(map);
      var historyBtnHtml = '';
      if (typeof firebaseAuth !== 'undefined' && firebaseAuth.currentUser) {
        historyBtnHtml = '<br><br><button class="btn btn-sm btn-primary" style="width:100%; margin-top:5px; padding: 4px;" onclick="window.VidaSegura.Map.showSelfHistory(\'' + firebaseAuth.currentUser.uid + '\')">Ver mi historial</button>';
      }
      userMarker.bindPopup('<div style="text-align:center;"><strong>Tu ubicación actual</strong>' + historyBtnHtml + '</div>');
      markers['user-location'] = userMarker;

      // Accuracy circle
      if (markers['user-accuracy']) {
        try { map.removeLayer(markers['user-accuracy']); } catch (_) {}
      }

      if (pos.accuracy) {
        var accuracyCircle = L.circle([pos.lat, pos.lng], {
          radius:      pos.accuracy,
          color:       '#3B82F6',
          fillColor:   '#3B82F6',
          fillOpacity: 0.08,
          weight:      1,
        }).addTo(map);
        markers['user-accuracy'] = accuracyCircle;
      }

      // Actualizar el texto del dashboard si es ese mapa
      if (containerId === 'dashboard-map-preview') {
        var el = document.getElementById(containerId);
        if (el) {
          var span = el.querySelector('.map-preview-text');
          if (span) {
            fetch('https://nominatim.openstreetmap.org/reverse?format=json&lat=' + pos.lat + '&lon=' + pos.lng + '&zoom=18&addressdetails=1')
              .then(function(res) { return res.json(); })
              .then(function(data) {
                if (data && data.address) {
                  var road = data.address.road || data.address.pedestrian || data.address.suburb || 'Ubicaci\u00f3n Actual';
                  var city = data.address.city || data.address.town || data.address.village || '';
                  var locationText = road + (city ? ', ' + city : '');
                  span.innerHTML = '\ud83d\udccd ' + locationText;
                }
              })
              .catch(function(err) { console.error('[Map] Error en geocoding:', err); });
          }
        }
      }

      console.log('[Map] Ubicación del usuario mostrada');
    } catch (err) {
      console.error('[Map] Error mostrando ubicación del usuario:', err);
    }
  }

  /**
   * Add resource markers (hospitals, fire stations, shelters, water points).
   * @param {string}   containerId
   * @param {Array}    resources   Array of {id, type, name, address, phone, lat, lng}
   * @param {string}   [filter]   Optional type filter ('hospital','fire','shelter','water')
   */
  function addResourceMarkers(containerId, resources, filter) {
    try {
      var map = maps[containerId];
      if (!map || !resources) return;

      // Remove existing resource markers
      Object.keys(markers).forEach(function (id) {
        if (id.startsWith('resource-')) {
          try { map.removeLayer(markers[id]); } catch (_) {}
          delete markers[id];
        }
      });

      resources.forEach(function (res) {
        if (filter && res.type !== filter) return;
        if (!res.lat || !res.lng) return;

        var emoji = RESOURCE_ICONS[res.type] || '📍';

        var popupContent =
          '<strong>' + (res.name || 'Recurso') + '</strong>' +
          (res.address ? '<br>' + res.address : '') +
          (res.phone   ? '<br><a href="tel:' + res.phone + '">📞 ' + res.phone + '</a>' : '');

        addMarker(containerId, 'resource-' + (res.id || Math.random()), res.lat, res.lng, {
          icon:  emoji,
          popup: popupContent,
        });
      });

      console.log('[Map] Marcadores de recursos agregados');
    } catch (err) {
      console.error('[Map] Error agregando marcadores de recursos:', err);
    }
  }

  /**
   * Destroy a map instance and free resources.
   */
  function destroy(containerId) {
    try {
      var map = maps[containerId];
      if (!map) return;

      // Remove markers that belong to this map
      Object.keys(markers).forEach(function (id) {
        try { map.removeLayer(markers[id]); } catch (_) {}
      });

      map.remove();
      delete maps[containerId];
      console.log('[Map] Mapa destruido: #' + containerId);
    } catch (err) {
      console.error('[Map] Error destruyendo mapa:', err);
    }
  }

  /**
   * Call invalidateSize() on a map — needed when its container is shown
   * after being hidden (e.g. tab switch).
   */
  function invalidateSize(containerId) {
    try {
      var map = maps[containerId];
      if (map) map.invalidateSize();
    } catch (err) {
      console.error('[Map] Error invalidando tamaño:', err);
    }
  }

  /**
   * Inicializa un mapa estático de solo lectura para el dashboard
   */
  function initDashboardPreview() {
    try {
      var containerId = 'dashboard-map-preview';
      var el = document.getElementById(containerId);
      if (!el) return;

      if (maps[containerId]) {
         invalidateSize(containerId);
         return;
      }

      var map = L.map(containerId, {
        center: DEFAULT_CENTER,
        zoom: 15,
        zoomControl: false,
        dragging: false,
        touchZoom: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
        attributionControl: false
      });

      L.tileLayer(TILE_URL, {
        attribution: TILE_ATTR,
        maxZoom: 19,
      }).addTo(map);

      maps[containerId] = map;

      setTimeout(function () {
        map.invalidateSize();
        showUserLocation(containerId);
      }, 500);

      // Listen for GPS updates to update the dashboard map automatically
      if (window.VidaSegura.GPS && typeof window.VidaSegura.GPS.onPositionUpdate === 'function') {
        window.VidaSegura.GPS.onPositionUpdate(function() {
          showUserLocation(containerId);
        });
      }
      console.log('[Map] Dashboard preview inicializado');
    } catch(err) {
      console.error('[Map] Error en initDashboardPreview:', err);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  return {
    init:               init,
    getMap:             getMap,
    setCenter:          setCenter,
    addMarker:          addMarker,
    removeMarker:       removeMarker,
    updateMarker:       updateMarker,
    showUserLocation:   showUserLocation,
    addResourceMarkers: addResourceMarkers,
    destroy:            destroy,
    invalidateSize:     invalidateSize,
    initDashboardPreview: initDashboardPreview,
    showSelfHistory:    showSelfHistory
  };
})();
