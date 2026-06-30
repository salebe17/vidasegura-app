/**
 * VidaSegura - Módulo de Recursos de Emergencia
 * Hospitales, bomberos, refugios, agua y puntos de energía en Venezuela.
 */
window.VidaSegura = window.VidaSegura || {};
window.VidaSegura.Resources = (function () {
    'use strict';

    const Utils = () => window.VidaSegura.Utils;
    const DB = () => window.VidaSegura.DB;
    const App = () => window.VidaSegura.App;
    const GPS = () => window.VidaSegura.GPS;
    const MapMod = () => window.VidaSegura.Map;

    let resourcesData = [];
    let currentFilter = 'all';
    let resourcesMap = null;

    const TYPE_ICONS = {
        hospital: '🏥',
        fire: '🚒',
        shelter: '⛑️',
        water: '💧',
        power: '⚡'
    };

    const TYPE_LABELS = {
        hospital: 'Hospital',
        fire: 'Bomberos',
        shelter: 'Refugio',
        water: 'Punto de agua',
        power: 'Energía'
    };

    // ── Init ──────────────────────────────────────────────────────────────
    function init() {
        // Filter buttons
        var filtersContainer = document.getElementById('resources-filters');
        if (filtersContainer) {
            filtersContainer.addEventListener('click', function (e) {
                var btn = e.target.closest('[data-filter]');
                if (!btn) return;

                var filter = btn.dataset.filter;

                // Update active state
                filtersContainer
                    .querySelectorAll('.btn-filter')
                    .forEach(function (b) {
                        b.classList.remove('active');
                    });
                btn.classList.add('active');

                currentFilter = filter;
                renderResources(filter);
            });
        }

        // Report resource button
        var btnReport = document.getElementById('btn-report-resource');
        if (btnReport) {
            btnReport.addEventListener('click', reportResource);
        }

        // Load initial resources
        loadResources();
    }

    // ── Load Resources ───────────────────────────────────────────────────
    async function loadResources(filter) {
        try {
            var response = await fetch('data/hospitals-vzla.json');
            if (!response.ok) {
                throw new Error('HTTP ' + response.status);
            }

            var data = await response.json();
            resourcesData = Array.isArray(data) ? data : [];
        } catch (err) {
            console.warn(
                '[Resources] No se pudo cargar recursos, usando datos vacíos:',
                err
            );
            resourcesData = _getDefaultResources();
        }

        currentFilter = filter || 'all';
        renderResources(currentFilter);
        return resourcesData;
    }

    // ── Render Resources ─────────────────────────────────────────────────
    async function renderResources(filter) {
        var activeFilter = filter || currentFilter || 'all';
        var filtered =
            activeFilter === 'all'
                ? resourcesData
                : resourcesData.filter(function (r) {
                      return r.type === activeFilter;
                  });

        // Get user position for distance calculation
        var userPos = null;
        try {
            if (GPS() && typeof GPS().getLastPosition === 'function') {
                userPos = GPS().getLastPosition();
            }
        } catch (_) {}

        // Calculate distances
        if (userPos && userPos.lat && userPos.lng) {
            filtered = filtered.map(function (r) {
                if (r.lat && r.lng) {
                    r._distance = _haversineDistance(
                        userPos.lat,
                        userPos.lng,
                        r.lat,
                        r.lng
                    );
                }
                return r;
            });

            // Sort by distance
            filtered.sort(function (a, b) {
                return (a._distance || 9999) - (b._distance || 9999);
            });
        }

        // Render list
        var list = document.getElementById('resources-list');
        if (list) {
            list.innerHTML = '';

            if (filtered.length === 0) {
                list.innerHTML =
                    '<div class="empty-state">' +
                    '<p class="empty-icon">📍</p>' +
                    '<p>No se encontraron recursos' +
                    (activeFilter !== 'all'
                        ? ' de tipo "' + (TYPE_LABELS[activeFilter] || activeFilter) + '"'
                        : '') +
                    '</p>' +
                    '</div>';
            } else {
                filtered.forEach(function (resource) {
                    list.appendChild(_createResourceItem(resource));
                });
            }
        }

        // Render map
        _renderResourcesMap(filtered);

        // Update filter button active states
        _updateFilterButtons(activeFilter);
    }

    // ── Report Resource ──────────────────────────────────────────────────
    function reportResource() {
        var formHtml =
            '<div class="form-group">' +
            '<label class="form-label" for="modal-resource-type">Tipo de recurso</label>' +
            '<select class="form-select" id="modal-resource-type">' +
            '<option value="hospital">🏥 Hospital / Centro de salud</option>' +
            '<option value="fire">🚒 Estación de bomberos</option>' +
            '<option value="shelter">⛑️ Refugio</option>' +
            '<option value="water">💧 Punto de agua potable</option>' +
            '<option value="power">⚡ Punto de energía</option>' +
            '</select>' +
            '</div>' +
            '<div class="form-group">' +
            '<label class="form-label" for="modal-resource-name">Nombre *</label>' +
            '<input class="form-input" type="text" id="modal-resource-name" placeholder="Ej: Hospital Central" required>' +
            '</div>' +
            '<div class="form-group">' +
            '<label class="form-label" for="modal-resource-desc">Descripción</label>' +
            '<textarea class="form-textarea" id="modal-resource-desc" rows="2" placeholder="Detalles adicionales del recurso"></textarea>' +
            '</div>' +
            '<p class="form-hint">📍 Se usará tu ubicación actual para marcar el recurso</p>';

        App().showModal(
            '📢 Reportar Recurso',
            formHtml,
            [
                {
                    text: 'Cancelar',
                    class: 'btn btn-ghost',
                    onClick: function () {
                        App().hideModal();
                    }
                },
                {
                    text: 'Reportar',
                    class: 'btn btn-primary',
                    action: async function () {
                        await _submitResourceReport();
                    }
                }
            ]
        );
    }

    // ── Get Nearby ───────────────────────────────────────────────────────
    async function getNearby(type, maxDistance) {
        var maxDist = maxDistance || 10; // 10 km default
        var userPos = null;

        try {
            if (GPS() && typeof GPS().getLastPosition === 'function') {
                userPos = GPS().getLastPosition();
            }
            if (!userPos) {
                var pos = await GPS().getCurrentPosition();
                if (pos && pos.coords) {
                    userPos = {
                        lat: pos.coords.latitude,
                        lng: pos.coords.longitude
                    };
                }
            }
        } catch (_) {}

        if (!userPos || !userPos.lat || !userPos.lng) return [];

        return resourcesData.filter(function (r) {
            if (type && r.type !== type) return false;
            if (!r.lat || !r.lng) return false;

            var dist = _haversineDistance(
                userPos.lat,
                userPos.lng,
                r.lat,
                r.lng
            );
            return dist <= maxDist;
        });
    }

    // ── Private: Create Resource Item ────────────────────────────────────
    function _createResourceItem(resource) {
        var item = document.createElement('div');
        item.className = 'resource-item';

        var icon = TYPE_ICONS[resource.type] || '📍';
        var distText = '';
        if (resource._distance !== undefined) {
            distText =
                resource._distance < 1
                    ? (resource._distance * 1000).toFixed(0) + ' m'
                    : resource._distance.toFixed(1) + ' km';
        }

        var phoneHtml = '';
        if (resource.phone) {
            phoneHtml =
                '<a class="resource-phone" href="tel:' +
                _escapeHtml(resource.phone) +
                '">📞 ' +
                _escapeHtml(resource.phone) +
                '</a>';
        }

        item.innerHTML =
            '<div class="resource-icon">' +
            icon +
            '</div>' +
            '<div class="resource-info">' +
            '<h4 class="resource-name">' +
            _escapeHtml(resource.name) +
            '</h4>' +
            '<p class="resource-location">' +
            _escapeHtml(resource.city || '') +
            (resource.state ? ', ' + _escapeHtml(resource.state) : '') +
            '</p>' +
            (distText
                ? '<span class="resource-distance">📍 ' + distText + '</span>'
                : '') +
            phoneHtml +
            '</div>';

        return item;
    }

    // ── Private: Render Resources Map ────────────────────────────────────
    function _renderResourcesMap(resources) {
        var container = document.getElementById('resources-map-container');
        if (!container) return;

        try {
            if (typeof L === 'undefined') return;

            // Clean up existing map
            if (resourcesMap) {
                resourcesMap.remove();
                resourcesMap = null;
            }

            resourcesMap = L.map(container, {
                center: [7.5, -66.0],
                zoom: 6,
                zoomControl: false,
                attributionControl: false
            });

            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 18
            }).addTo(resourcesMap);

            // Add resource markers
            var bounds = [];
            resources.forEach(function (resource) {
                if (!resource.lat || !resource.lng) return;

                var icon = TYPE_ICONS[resource.type] || '📍';
                var divIcon = L.divIcon({
                    html: '<span class="resource-marker-icon">' + icon + '</span>',
                    className: 'resource-marker',
                    iconSize: [32, 32],
                    iconAnchor: [16, 16]
                });

                var marker = L.marker([resource.lat, resource.lng], {
                    icon: divIcon
                }).addTo(resourcesMap);

                marker.bindPopup(
                    '<strong>' +
                        _escapeHtml(resource.name) +
                        '</strong><br>' +
                        _escapeHtml(resource.city || '') +
                        (resource.phone
                            ? '<br>📞 ' + _escapeHtml(resource.phone)
                            : '')
                );

                bounds.push([resource.lat, resource.lng]);
            });

            // Fit bounds if markers exist
            if (bounds.length > 1) {
                resourcesMap.fitBounds(bounds, { padding: [30, 30] });
            }

            setTimeout(function () {
                if (resourcesMap) resourcesMap.invalidateSize();
            }, 300);
        } catch (err) {
            console.warn('[Resources] No se pudo inicializar el mapa:', err);
        }
    }

    // ── Private: Submit Resource Report ──────────────────────────────────
    async function _submitResourceReport() {
        var typeEl = document.getElementById('modal-resource-type');
        var nameEl = document.getElementById('modal-resource-name');
        var descEl = document.getElementById('modal-resource-desc');

        var name = nameEl ? nameEl.value.trim() : '';
        if (!name) {
            App().showToast('Ingresa un nombre para el recurso', 'warning');
            return;
        }

        var resourceType = typeEl ? typeEl.value : 'hospital';
        var description = descEl ? descEl.value.trim() : '';

        // Get current position
        var lat = null;
        var lng = null;
        try {
            var pos = await GPS().getCurrentPosition();
            if (pos && pos.coords) {
                lat = pos.coords.latitude;
                lng = pos.coords.longitude;
            }
        } catch (_) {}

        var resource = {
            id: Utils().generateId(),
            type: resourceType,
            name: name,
            description: description,
            lat: lat,
            lng: lng,
            city: 'Reportado por usuario',
            state: '',
            phone: '',
            reportedAt: Date.now(),
            userReported: true
        };

        resourcesData.push(resource);
        App().hideModal();
        renderResources(currentFilter);
        App().showToast('Recurso reportado. ¡Gracias por tu ayuda!', 'success');
    }

    // ── Private: Update Filter Buttons ───────────────────────────────────
    function _updateFilterButtons(activeFilter) {
        var container = document.getElementById('resources-filters');
        if (!container) return;

        container.querySelectorAll('.btn-filter').forEach(function (btn) {
            if (btn.dataset.filter === activeFilter) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    // ── Private: Haversine Distance ──────────────────────────────────────
    function _haversineDistance(lat1, lng1, lat2, lng2) {
        // Use Utils if available
        try {
            if (
                Utils() &&
                typeof Utils().haversineDistance === 'function'
            ) {
                return Utils().haversineDistance(lat1, lng1, lat2, lng2);
            }
        } catch (_) {}

        // Fallback calculation
        var R = 6371; // km
        var dLat = _toRad(lat2 - lat1);
        var dLng = _toRad(lng2 - lng1);
        var a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(_toRad(lat1)) *
                Math.cos(_toRad(lat2)) *
                Math.sin(dLng / 2) *
                Math.sin(dLng / 2);
        var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    function _toRad(deg) {
        return (deg * Math.PI) / 180;
    }

    // ── Private: Default Resources ───────────────────────────────────────
    function _getDefaultResources() {
        return [
            {
                id: 'h1',
                type: 'hospital',
                name: 'Hospital Universitario de Caracas',
                city: 'Caracas',
                state: 'Distrito Capital',
                lat: 10.4928,
                lng: -66.8461,
                phone: '0212-6063111'
            },
            {
                id: 'h2',
                type: 'hospital',
                name: 'Hospital de Clínicas Caracas',
                city: 'Caracas',
                state: 'Distrito Capital',
                lat: 10.4934,
                lng: -66.8576,
                phone: '0212-5081111'
            },
            {
                id: 'h3',
                type: 'hospital',
                name: 'Hospital Central de Maracay',
                city: 'Maracay',
                state: 'Aragua',
                lat: 10.2437,
                lng: -67.5952,
                phone: '0243-2463811'
            },
            {
                id: 'f1',
                type: 'fire',
                name: 'Cuerpo de Bomberos del Distrito Capital',
                city: 'Caracas',
                state: 'Distrito Capital',
                lat: 10.502,
                lng: -66.8951,
                phone: '171'
            },
            {
                id: 's1',
                type: 'shelter',
                name: 'Refugio Protección Civil - Caracas',
                city: 'Caracas',
                state: 'Distrito Capital',
                lat: 10.488,
                lng: -66.87,
                phone: '0800-PROTECCION'
            },
            {
                id: 'w1',
                type: 'water',
                name: 'Punto de distribución de agua - Plaza Bolívar',
                city: 'Caracas',
                state: 'Distrito Capital',
                lat: 10.506,
                lng: -66.914,
                phone: ''
            }
        ];
    }

    // ── Private: Escape HTML ─────────────────────────────────────────────
    function _escapeHtml(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ── Public API ───────────────────────────────────────────────────────
    return {
        init: init,
        loadResources: loadResources,
        renderResources: renderResources,
        reportResource: reportResource,
        getNearby: getNearby
    };
})();
