/**
 * VidaSegura - Módulo de Alertas Sísmicas
 * Monitoreo de actividad sísmica en la región de Venezuela vía USGS.
 */
window.VidaSegura = window.VidaSegura || {};
window.VidaSegura.Alerts = (function () {
    'use strict';

    const Utils = () => window.VidaSegura.Utils;
    const DB = () => window.VidaSegura.DB;
    const App = () => window.VidaSegura.App;
    const Map = () => window.VidaSegura.Map;

    let recentAlerts = [];
    let checkInterval = null;
    let alertsMap = null;

    const USGS_API_URL =
        'https://earthquake.usgs.gov/fdsnws/event/1/query?' +
        'format=geojson&minlatitude=0&maxlatitude=15&minlongitude=-75&maxlongitude=-58&limit=20&orderby=time';

    // ── Init ──────────────────────────────────────────────────────────────
    function init() {
        // Close protocol button
        var btnClose = document.getElementById('btn-close-protocol');
        if (btnClose) {
            btnClose.addEventListener('click', function () {
                var overlay = document.getElementById('alerts-protocol');
                if (overlay) overlay.classList.add('hidden');
            });
        }

        // Start monitoring if online
        if (navigator.onLine) {
            checkSeismicActivity();
            startMonitoring();
        } else {
            // Load cached data
            _loadCachedAlerts();
        }

        // Listen for online/offline changes
        window.addEventListener('online', function () {
            checkSeismicActivity();
            startMonitoring();
        });

        window.addEventListener('offline', function () {
            stopMonitoring();
        });
    }

    // ── Check Seismic Activity ───────────────────────────────────────────
    async function checkSeismicActivity() {
        try {
            var response = await fetch(USGS_API_URL);
            if (!response.ok) {
                throw new Error('HTTP ' + response.status);
            }

            var data = await response.json();
            var features = data.features || [];

            var oldIds = new Set(recentAlerts.map(a => a.id));
            var isFirstLoad = (recentAlerts.length === 0);
            var newAlertsToNotify = [];

            recentAlerts = features.map(function (feature) {
                var props = feature.properties;
                var coords = feature.geometry.coordinates;
                var a = {
                    id: feature.id,
                    magnitude: props.mag,
                    place: props.place || 'Ubicación desconocida',
                    lat: coords[1],
                    lng: coords[0],
                    depth: coords[2],
                    time: props.time,
                    url: props.url
                };
                
                if (!isFirstLoad && !oldIds.has(a.id) && a.magnitude >= 4.0) {
                    newAlertsToNotify.push(a);
                }
                
                return a;
            });
            
            if (newAlertsToNotify.length > 0 && window.VidaSegura.Notifications && typeof window.VidaSegura.Notifications.sendSeismicNotification === 'function') {
                newAlertsToNotify.forEach(function(a) {
                    window.VidaSegura.Notifications.sendSeismicNotification(a);
                });
            }

            // Cache to DB
            try {
                await DB().saveSetting('cachedAlerts', JSON.stringify(recentAlerts));
                await DB().saveSetting(
                    'alertsLastUpdate',
                    Date.now().toString()
                );
            } catch (_) {}

            renderAlerts();
            return recentAlerts;
        } catch (err) {
            console.warn('[Alerts] Error consultando USGS, usando caché:', err);
            await _loadCachedAlerts();
            return recentAlerts;
        }
    }

    // ── Get Alert Class ──────────────────────────────────────────────────
    function getAlertClass(magnitude) {
        if (magnitude < 3.0) return 'alert-green';
        if (magnitude < 5.0) return 'alert-yellow';
        if (magnitude < 7.0) return 'alert-orange';
        return 'alert-red';
    }

    // ── Render Alerts ────────────────────────────────────────────────────
    function renderAlerts() {
        var now = Date.now();
        var oneHourAgo = now - 3600000;

        // Active alerts: last hour, magnitude >= 3.0
        var activeAlerts = recentAlerts.filter(function (a) {
            return a.time >= oneHourAgo && a.magnitude >= 3.0;
        });

        // Render active alerts
        var activeList = document.getElementById('alerts-active-list');
        if (activeList) {
            if (activeAlerts.length === 0) {
                activeList.innerHTML =
                    '<div class="empty-state alert-empty">' +
                    '<p class="empty-icon">✅</p>' +
                    '<p>Sin alertas activas en este momento</p>' +
                    '</div>';
            } else {
                activeList.innerHTML = '';
                activeAlerts.forEach(function (alert) {
                    activeList.appendChild(_createAlertCard(alert, true));
                });
            }
        }

        // Render history
        var historyList = document.getElementById('alerts-history-list');
        if (historyList) {
            if (recentAlerts.length === 0) {
                historyList.innerHTML =
                    '<p class="empty-state">Sin actividad sísmica reciente</p>';
            } else {
                historyList.innerHTML = '';
                recentAlerts.forEach(function (alert) {
                    historyList.appendChild(_createAlertCard(alert, false));
                });
            }
        }

        // Update alerts map
        _renderAlertsMap();

        // Update status badge
        _updateStatusBadge(activeAlerts.length);

        // Update dashboard alerts
        _updateDashboardAlerts();
    }

    // ── Show Protocol ────────────────────────────────────────────────────
    async function showProtocol(type) {
        var protocolType = type || 'earthquake';
        var overlay = document.getElementById('alerts-protocol');
        var titleEl = document.getElementById('protocol-title');
        var bodyEl = document.getElementById('protocol-body');

        if (!overlay || !titleEl || !bodyEl) return;

        // Try to fetch protocol data
        var protocol = null;
        try {
            var response = await fetch('data/emergency-protocols.json');
            if (response.ok) {
                var protocols = await response.json();
                protocol = protocols.find(function (p) {
                    return p.type === protocolType;
                });
            }
        } catch (_) {}

        // Fallback to built-in protocols
        if (!protocol) {
            protocol = _getBuiltInProtocol(protocolType);
        }

        titleEl.textContent = protocol.title;

        var stepsHtml = '<ol class="protocol-steps">';
        protocol.steps.forEach(function (step) {
            stepsHtml +=
                '<li class="protocol-step">' + _escapeHtml(step) + '</li>';
        });
        stepsHtml += '</ol>';

        if (protocol.notes) {
            stepsHtml +=
                '<div class="protocol-notes"><strong>⚠️ Importante:</strong> ' +
                _escapeHtml(protocol.notes) +
                '</div>';
        }

        bodyEl.innerHTML = stepsHtml;
        overlay.classList.remove('hidden');
    }

    // ── Get Recent Alerts ────────────────────────────────────────────────
    function getRecentAlerts() {
        return recentAlerts;
    }

    // ── Start / Stop Monitoring ──────────────────────────────────────────
    function startMonitoring(intervalMs) {
        var interval = intervalMs || 300000; // 5 minutes default
        stopMonitoring();
        checkInterval = setInterval(checkSeismicActivity, interval);
    }

    function stopMonitoring() {
        if (checkInterval) {
            clearInterval(checkInterval);
            checkInterval = null;
        }
    }

    // ── Private: Create Alert Card ───────────────────────────────────────
    function _createAlertCard(alert, isActive) {
        var card = document.createElement('div');
        var alertClass = getAlertClass(alert.magnitude);
        card.className = 'alert-card ' + alertClass + (isActive ? ' alert-active' : '');

        var timeAgo = _timeAgo(alert.time);
        var magDisplay =
            alert.magnitude !== null && alert.magnitude !== undefined
                ? alert.magnitude.toFixed(1)
                : '?';

        card.innerHTML =
            '<div class="alert-card-content">' +
            '<div class="alert-magnitude">' +
            '<span class="alert-mag-number">' +
            magDisplay +
            '</span>' +
            '<span class="alert-mag-label">Mag.</span>' +
            '</div>' +
            '<div class="alert-info">' +
            '<p class="alert-place">' +
            _escapeHtml(alert.place) +
            '</p>' +
            '<p class="alert-meta">' +
            timeAgo +
            ' · Profundidad: ' +
            (alert.depth ? alert.depth.toFixed(1) + ' km' : 'N/D') +
            '</p>' +
            '</div>' +
            '</div>';

        // Click to show protocol for significant quakes
        if (alert.magnitude >= 4.0) {
            card.style.cursor = 'pointer';
            card.addEventListener('click', function () {
                showProtocol('earthquake');
            });
        }

        return card;
    }

    // ── Private: Render Alerts Map ───────────────────────────────────────
    function _renderAlertsMap() {
        var container = document.getElementById('alerts-map-container');
        if (!container) return;

        try {
            if (typeof L === 'undefined') return;

            // Clean up existing map
            if (alertsMap) {
                alertsMap.remove();
                alertsMap = null;
            }

            alertsMap = L.map(container, {
                center: [7.5, -66.0],
                zoom: 5,
                zoomControl: false,
                attributionControl: false
            });

            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 18
            }).addTo(alertsMap);

            // Add alert markers
            recentAlerts.forEach(function (alert) {
                if (alert.lat === undefined || alert.lng === undefined) return;

                var color = _getMarkerColor(alert.magnitude);
                var radius = Math.max(5, Math.min(20, alert.magnitude * 3));

                var marker = L.circleMarker([alert.lat, alert.lng], {
                    radius: radius,
                    fillColor: color,
                    color: '#fff',
                    weight: 1,
                    opacity: 0.9,
                    fillOpacity: 0.7
                }).addTo(alertsMap);

                var magStr =
                    alert.magnitude !== null
                        ? alert.magnitude.toFixed(1)
                        : '?';
                marker.bindPopup(
                    '<strong>Magnitud: ' +
                        magStr +
                        '</strong><br>' +
                        _escapeHtml(alert.place) +
                        '<br>' +
                        _timeAgo(alert.time) +
                        '<br>Profundidad: ' +
                        (alert.depth
                            ? alert.depth.toFixed(1) + ' km'
                            : 'N/D')
                );
            });

            setTimeout(function () {
                if (alertsMap) alertsMap.invalidateSize();
            }, 300);
        } catch (err) {
            console.warn('[Alerts] No se pudo inicializar el mapa:', err);
        }
    }

    // ── Private: Load Cached Alerts ──────────────────────────────────────
    async function _loadCachedAlerts() {
        try {
            var cached = await DB().getSetting('cachedAlerts');
            if (cached) {
                recentAlerts = JSON.parse(cached);
                renderAlerts();
            }
        } catch (err) {
            console.warn('[Alerts] Error cargando caché:', err);
        }
    }

    // ── Private: Update Status Badge ─────────────────────────────────────
    function _updateStatusBadge(activeCount) {
        var badge = document.getElementById('alerts-status');
        if (!badge) return;

        if (activeCount > 0) {
            badge.className = 'status-badge status-warning';
            badge.innerHTML =
                '<span class="status-dot"></span> ' +
                activeCount +
                ' alerta' +
                (activeCount > 1 ? 's' : '');
        } else {
            badge.className = 'status-badge status-active';
            badge.innerHTML =
                '<span class="status-dot"></span> Sin alertas';
        }
    }

    // ── Private: Update Dashboard Alerts ─────────────────────────────────
    function _updateDashboardAlerts() {
        var dashList = document.getElementById('dashboard-alerts-list');
        if (!dashList) return;

        var significant = recentAlerts.filter(function (a) {
            return a.magnitude >= 2.5;
        });

        if (significant.length === 0) {
            dashList.innerHTML =
                '<p class="empty-state">Sin alertas sísmicas recientes en tu zona</p>';
            return;
        }

        var html = '';
        significant.slice(0, 3).forEach(function (alert) {
            var alertClass = getAlertClass(alert.magnitude);
            var magStr =
                alert.magnitude !== null
                    ? alert.magnitude.toFixed(1)
                    : '?';
            html +=
                '<div class="alert-mini-card ' +
                alertClass +
                '">' +
                '<span class="alert-mini-mag">' +
                magStr +
                '</span>' +
                '<div class="alert-mini-info">' +
                '<span class="alert-mini-place">' +
                _escapeHtml(_truncate(alert.place, 35)) +
                '</span>' +
                '<span class="alert-mini-time">' +
                _timeAgo(alert.time) +
                '</span>' +
                '</div>' +
                '</div>';
        });
        dashList.innerHTML = html;
    }

    // ── Private: Built-in Protocol ───────────────────────────────────────
    function _getBuiltInProtocol(type) {
        var protocols = {
            earthquake: {
                title: '🔴 Protocolo de Seguridad - Sismo',
                steps: [
                    'Mantén la calma y busca protección.',
                    'Aléjate de ventanas, espejos y objetos que puedan caer.',
                    'Si estás dentro: colócate debajo de una mesa o escritorio resistente.',
                    'Si estás afuera: ve a un espacio abierto lejos de edificios y cables eléctricos.',
                    'Protege tu cabeza y cuello con los brazos.',
                    'NO uses ascensores durante o después del sismo.',
                    'Después del sismo: revisa si hay heridos y daños estructurales.',
                    'Prepárate para réplicas. Mantente informado.',
                    'Si hueles gas, cierra la llave principal y sal de la edificación.',
                    'Comunica tu estado a tus contactos de emergencia.'
                ],
                notes:
                    'Las réplicas pueden ocurrir minutos, horas o días después del sismo principal. Mantén un kit de emergencia accesible.'
            }
        };

        return (
            protocols[type] || {
                title: '⚠️ Protocolo General de Emergencia',
                steps: [
                    'Mantén la calma.',
                    'Evalúa la situación y busca un lugar seguro.',
                    'Comunica tu estado a tus familiares.',
                    'Sigue las instrucciones de las autoridades.',
                    'No propagues información no verificada.'
                ],
                notes: 'Mantén siempre tu kit de emergencia listo y actualizado.'
            }
        );
    }

    // ── Private: Helpers ─────────────────────────────────────────────────
    function _getMarkerColor(magnitude) {
        if (magnitude < 3.0) return '#22c55e';
        if (magnitude < 5.0) return '#f59e0b';
        if (magnitude < 7.0) return '#f97316';
        return '#ef4444';
    }

    function _timeAgo(timestamp) {
        if (!timestamp) return '';
        var seconds = Math.floor((Date.now() - timestamp) / 1000);

        if (seconds < 60) return 'Hace un momento';
        if (seconds < 3600)
            return 'Hace ' + Math.floor(seconds / 60) + ' min';
        if (seconds < 86400)
            return 'Hace ' + Math.floor(seconds / 3600) + ' h';
        return 'Hace ' + Math.floor(seconds / 86400) + ' día(s)';
    }

    function _truncate(str, max) {
        if (!str) return '';
        return str.length > max ? str.substring(0, max) + '...' : str;
    }

    function _escapeHtml(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ── Public API ───────────────────────────────────────────────────────
    return {
        init: init,
        checkSeismicActivity: checkSeismicActivity,
        getAlertClass: getAlertClass,
        renderAlerts: renderAlerts,
        showProtocol: showProtocol,
        getRecentAlerts: getRecentAlerts,
        startMonitoring: startMonitoring,
        stopMonitoring: stopMonitoring
    };
})();
