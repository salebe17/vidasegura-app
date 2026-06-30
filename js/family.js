/**
 * VidaSegura - Módulo de Círculos Familiares (Firebase)
 * Gestión de círculos familiares MULTI-USUARIO con Firestore y Realtime Database.
 *
 * Firestore:  circles/{circleId}  → { name, code, ownerId, members[], memberNames{}, createdAt }
 * RTDB:       users/{uid}/location → { lat, lng, accuracy, timestamp }
 *
 * Globals:    firestore, firebaseAuth, realtimeDb  (from firebase-config.js)
 */
window.VidaSegura = window.VidaSegura || {};
window.VidaSegura.Family = (function () {
    'use strict';

    // ── Lazy accessors for sibling modules ──────────────────────────────
    var App = function () { return window.VidaSegura.App; };

    // ── Private state ───────────────────────────────────────────────────
    var familyMap = null;               // Leaflet map instance
    var memberMarkers = {};             // { uid: L.marker }
    var locationListeners = [];         // RTDB refs we need to .off() later
    var circlesUnsubscribe = null;      // Firestore onSnapshot unsub function
    var currentDetailCircleId = null;   // Circle currently shown in detail view

    // ── Helpers ─────────────────────────────────────────────────────────

    /** Devuelve el UID del usuario autenticado o null */
    function _currentUid() {
        var u = firebaseAuth.currentUser;
        return u ? u.uid : null;
    }

    /** Devuelve el displayName del usuario autenticado */
    function _currentUserName() {
        var u = firebaseAuth.currentUser;
        return u ? (u.displayName || u.email || 'Usuario') : 'Usuario';
    }

    /** Genera un código aleatorio de 6 caracteres alfanuméricos (mayúsculas) */
    function _generateCode(len) {
        len = len || 6;
        var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin I,O,0,1 para evitar confusiones
        var code = '';
        for (var i = 0; i < len; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    }

    /** Escapa HTML para evitar XSS */
    function _escapeHtml(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    /** Devuelve las iniciales (máx. 2 letras) de un nombre */
    function _getInitials(name) {
        if (!name) return 'U';
        var parts = name.trim().split(/\s+/);
        if (parts.length >= 2) {
            return (parts[0][0] + parts[1][0]).toUpperCase();
        }
        return parts[0].substring(0, 2).toUpperCase();
    }

    // ── Init ────────────────────────────────────────────────────────────
    function init() {
        var btnCreate = document.getElementById('btn-create-circle');
        var btnJoin   = document.getElementById('btn-join-circle');
        var btnLeave  = document.getElementById('btn-leave-circle');
        var btnCopy   = document.getElementById('btn-copy-circle-code');

        if (btnCreate) {
            btnCreate.addEventListener('click', _showCreateModal);
        }
        if (btnJoin) {
            btnJoin.addEventListener('click', _showJoinModal);
        }
        if (btnLeave) {
            btnLeave.addEventListener('click', function () {
                var circleId = btnLeave.dataset.circleId;
                if (circleId) leaveCircle(circleId);
            });
        }
        if (btnCopy) {
            btnCopy.addEventListener('click', _copyCircleCode);
        }

        // Escuchar cambios de auth para recargar círculos
        firebaseAuth.onAuthStateChanged(function (user) {
            if (user) {
                renderCircles();
            } else {
                _stopCirclesListener();
            }
        });
    }

    // ── Create Circle ───────────────────────────────────────────────────
    /**
     * Crea un nuevo círculo familiar en Firestore.
     * @param {string} name - Nombre del círculo
     * @returns {Promise<Object|null>} El círculo creado o null en caso de error
     */
    function createCircle(name) {
        if (!name || !name.trim()) {
            App().showToast('Ingresa un nombre para el círculo', 'warning');
            return Promise.resolve(null);
        }

        var uid = _currentUid();
        if (!uid) {
            App().showToast('Debes iniciar sesión para crear un círculo', 'error');
            return Promise.resolve(null);
        }

        var userName = _currentUserName();
        var memberNames = {};
        memberNames[uid] = userName;

        var circleData = {
            name: name.trim(),
            code: _generateCode(6),
            ownerId: uid,
            members: [uid],
            memberNames: memberNames,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        return firestore.collection('circles').add(circleData)
            .then(function (docRef) {
                console.log('[Family] Círculo creado:', docRef.id);
                App().showToast('Círculo creado exitosamente', 'success');
                // Mostrar detalle del círculo recién creado
                var circleWithId = Object.assign({}, circleData, { id: docRef.id });
                // El serverTimestamp se resuelve después, usar un fallback local
                circleWithId.createdAt = new Date();
                showCircleDetail(circleWithId);
                return circleWithId;
            })
            .catch(function (err) {
                console.error('[Family] Error creando círculo:', err);
                App().showToast('Error al crear el círculo', 'error');
                return null;
            });
    }

    // ── Join Circle ─────────────────────────────────────────────────────
    /**
     * Busca un círculo por código de invitación y agrega al usuario como miembro.
     * @param {string} code - Código de 6 caracteres
     * @returns {Promise<boolean>}
     */
    function joinCircle(code) {
        if (!code || !code.trim()) {
            App().showToast('Ingresa un código de invitación', 'warning');
            return Promise.resolve(false);
        }

        var uid = _currentUid();
        if (!uid) {
            App().showToast('Debes iniciar sesión para unirte a un círculo', 'error');
            return Promise.resolve(false);
        }

        var normalizedCode = code.trim().toUpperCase();
        var userName = _currentUserName();

        // Buscar el círculo por código
        return firestore.collection('circles')
            .where('code', '==', normalizedCode)
            .limit(1)
            .get()
            .then(function (snapshot) {
                if (snapshot.empty) {
                    App().showToast('Código no válido. Verifica e intenta de nuevo.', 'error');
                    return false;
                }

                var doc = snapshot.docs[0];
                var data = doc.data();

                // Verificar si el usuario ya es miembro
                if (data.members && data.members.indexOf(uid) !== -1) {
                    App().showToast('Ya perteneces a este círculo', 'warning');
                    return false;
                }

                // Agregar al usuario como miembro con arrayUnion y actualizar memberNames
                var nameUpdate = {};
                nameUpdate['memberNames.' + uid] = userName;

                return doc.ref.update(Object.assign({
                    members: firebase.firestore.FieldValue.arrayUnion(uid)
                }, nameUpdate)).then(function () {
                    console.log('[Family] Usuario unido al círculo:', doc.id);
                    App().showToast('Te uniste al círculo "' + _escapeHtml(data.name) + '"', 'success');
                    return true;
                });
            })
            .catch(function (err) {
                console.error('[Family] Error uniéndose al círculo:', err);
                App().showToast('Error al unirse al círculo', 'error');
                return false;
            });
    }

    // ── Leave Circle ────────────────────────────────────────────────────
    /**
     * Abandona un círculo familiar. Si es el último miembro, elimina el círculo.
     * @param {string} circleId - ID del documento Firestore
     * @returns {Promise<boolean>}
     */
    function leaveCircle(circleId) {
        return _confirmLeave().then(function (confirmed) {
            if (!confirmed) return false;

            var uid = _currentUid();
            if (!uid) return false;

            var circleRef = firestore.collection('circles').doc(circleId);

            return circleRef.get().then(function (doc) {
                if (!doc.exists) {
                    App().showToast('El círculo ya no existe', 'warning');
                    return false;
                }

                var data = doc.data();
                var remainingMembers = (data.members || []).filter(function (m) {
                    return m !== uid;
                });

                if (remainingMembers.length === 0) {
                    // Último miembro: eliminar el círculo completamente
                    return circleRef.delete().then(function () {
                        console.log('[Family] Círculo eliminado (último miembro):', circleId);
                        _hideDetail();
                        _cleanupLocationListeners();
                        App().showToast('Círculo eliminado (eras el último miembro)', 'success');
                        return true;
                    });
                } else {
                    // Remover al usuario del arreglo de miembros y del mapa de nombres
                    var nameRemove = {};
                    nameRemove['memberNames.' + uid] = firebase.firestore.FieldValue.delete();

                    return circleRef.update(Object.assign({
                        members: firebase.firestore.FieldValue.arrayRemove(uid)
                    }, nameRemove)).then(function () {
                        console.log('[Family] Usuario abandonó el círculo:', circleId);
                        _hideDetail();
                        _cleanupLocationListeners();
                        App().showToast('Has abandonado el círculo', 'success');
                        return true;
                    });
                }
            });
        }).catch(function (err) {
            console.error('[Family] Error abandonando círculo:', err);
            App().showToast('Error al abandonar el círculo', 'error');
            return false;
        });
    }

    // ── Render Circles (real-time with onSnapshot) ──────────────────────
    /**
     * Configura un listener de Firestore en tiempo real para los círculos del usuario.
     * Cada cambio re-renderiza la lista automáticamente.
     */
    function renderCircles() {
        var uid = _currentUid();
        if (!uid) {
            _renderEmptyCirclesList();
            return;
        }

        // Cancelar listener anterior si existe
        _stopCirclesListener();

        // Escuchar en tiempo real todos los círculos donde el usuario es miembro
        circlesUnsubscribe = firestore.collection('circles')
            .where('members', 'array-contains', uid)
            .onSnapshot(function (snapshot) {
                var circles = [];
                snapshot.forEach(function (doc) {
                    circles.push(Object.assign({ id: doc.id }, doc.data()));
                });

                _renderCirclesList(circles);
                _updateDashboardFamily(circles);

                console.log('[Family] Círculos actualizados:', circles.length);
            }, function (err) {
                console.error('[Family] Error en listener de círculos:', err);
                _renderEmptyCirclesList();
            });
    }

    /** Para el listener de onSnapshot de círculos */
    function _stopCirclesListener() {
        if (circlesUnsubscribe) {
            circlesUnsubscribe();
            circlesUnsubscribe = null;
        }
    }

    /** Renderiza la lista vacía de círculos */
    function _renderEmptyCirclesList() {
        var list = document.getElementById('family-circles-list');
        if (!list) return;
        list.innerHTML =
            '<div class="empty-state">' +
            '<p class="empty-icon">👨‍👩‍👧‍👦</p>' +
            '<p>No tienes círculos familiares</p>' +
            '<p class="empty-hint">Crea uno o únete con un código de invitación</p>' +
            '</div>';
    }

    /** Renderiza las tarjetas de círculos a partir de los datos */
    function _renderCirclesList(circles) {
        var list = document.getElementById('family-circles-list');
        if (!list) return;

        list.innerHTML = '';

        if (!circles || circles.length === 0) {
            _renderEmptyCirclesList();
            return;
        }

        circles.forEach(function (circle) {
            var card = document.createElement('div');
            card.className = 'card glass-card family-circle-card';
            card.setAttribute('role', 'button');
            card.setAttribute('tabindex', '0');

            var memberCount = circle.members ? circle.members.length : 0;
            var codeDisplay = circle.code
                ? circle.code.substring(0, 3) + '***'
                : '---';

            card.innerHTML =
                '<div class="circle-card-content">' +
                '<div class="circle-card-icon">👨‍👩‍👧‍👦</div>' +
                '<div class="circle-card-info">' +
                '<h4 class="circle-card-name">' +
                _escapeHtml(circle.name) +
                '</h4>' +
                '<p class="circle-card-meta">' +
                memberCount +
                (memberCount === 1 ? ' miembro' : ' miembros') +
                ' · Código: ' +
                codeDisplay +
                '</p>' +
                '</div>' +
                '<span class="circle-card-arrow">›</span>' +
                '</div>';

            card.addEventListener('click', function () {
                showCircleDetail(circle);
            });
            card.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    showCircleDetail(circle);
                }
            });

            list.appendChild(card);
        });
    }

    // ── Show Circle Detail ──────────────────────────────────────────────
    /**
     * Muestra la vista de detalle de un círculo con miembros y mapa en tiempo real.
     * @param {Object} circle - Objeto del círculo con id, name, code, members, memberNames
     */
    function showCircleDetail(circle) {
        var detail = document.getElementById('family-circle-detail');
        if (!detail) return;

        // Limpiar listeners de ubicación del círculo anterior
        _cleanupLocationListeners();
        currentDetailCircleId = circle.id;

        detail.classList.remove('hidden');

        // Nombre del círculo
        var nameEl = document.getElementById('family-circle-name');
        if (nameEl) nameEl.textContent = circle.name;

        // Código del círculo
        var codeEl = document.getElementById('family-circle-code');
        if (codeEl) {
            codeEl.textContent = circle.code || '------';
            codeEl.dataset.code = circle.code || '';
        }

        // Botón abandonar: guardar circleId
        var btnLeave = document.getElementById('btn-leave-circle');
        if (btnLeave) btnLeave.dataset.circleId = circle.id;

        // Renderizar miembros con sus nombres
        _renderMembers(circle.members || [], circle.memberNames || {});
        _renderPlaces(circle.id);

        // Inicializar mapa y escuchar ubicaciones en tiempo real
        _initFamilyMap();
        _listenMemberLocations(circle.members || [], circle.memberNames || {});

        var btnAddPlace = document.getElementById('btn-add-place');
        if (btnAddPlace) {
            btnAddPlace.onclick = function() {
                _showAddPlaceModal(circle.id);
            };
        }

        // Scroll al detalle
        detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // ── Private: Render Members ─────────────────────────────────────────
    /**
     * Renderiza la lista de miembros del círculo.
     * @param {string[]} memberUids - Array de UIDs
     * @param {Object} memberNames - Mapa { uid: displayName }
     */
    function _renderMembers(memberUids, memberNames) {
        var list = document.getElementById('family-members-list');
        if (!list) return;

        list.innerHTML = '';
        var currentUid = _currentUid();

        if (!memberUids || memberUids.length === 0) {
            list.innerHTML = '<p class="empty-state">Sin miembros</p>';
            return;
        }

        memberUids.forEach(function (uid) {
            var name = (memberNames && memberNames[uid]) ? memberNames[uid] : 'Usuario';
            var isCurrentUser = (uid === currentUid);

            var item = document.createElement('div');
            item.className = 'member-item';

            var initials = _getInitials(name);
            var roleBadge = isCurrentUser
                ? '<span class="badge badge-member">Tú</span>'
                : '<span class="badge badge-member">Miembro</span>';

            item.innerHTML =
                '<div class="member-avatar">' +
                initials +
                '</div>' +
                '<div class="member-info">' +
                '<span class="member-name">' +
                _escapeHtml(name) +
                '</span>' +
                roleBadge +
                '<div id="member-info-' + uid + '" style="margin-top:2px; color:var(--text-secondary);"></div>' +
                '</div>';

            list.appendChild(item);
        });
    }

    // ── Private: Listen to Member Locations via Realtime Database ───────
    /**
     * Escucha la ubicación en tiempo real de cada miembro del círculo
     * usando Realtime Database y actualiza los marcadores del mapa.
     *
     * @param {string[]} memberUids - Array de UIDs de miembros
     * @param {Object} memberNames - Mapa { uid: displayName }
     */
    function _listenMemberLocations(memberUids, memberNames) {
        if (!memberUids || memberUids.length === 0) return;
        if (typeof L === 'undefined' || !familyMap) return;

        var bounds = [];

        memberUids.forEach(function (uid) {
            var locRef = realtimeDb.ref('users/' + uid + '/location');

            // Escuchar cambios en tiempo real
            locRef.on('value', function (snapshot) {
                var loc = snapshot.val();
                if (!loc || loc.lat == null || loc.lng == null) return;

                var name = (memberNames && memberNames[uid]) ? memberNames[uid] : 'Usuario';
                var latLng = [loc.lat, loc.lng];
                
                var batteryHtml = '';
                if (loc.battery != null) {
                    var batIcon = loc.charging ? '⚡' : '🔋';
                    batteryHtml = ' | ' + batIcon + ' ' + loc.battery + '%';
                }

                var popupContent = '<strong>' + _escapeHtml(name) + '</strong>' + batteryHtml + '<br>' +
                                   '<small>Últ. actualización: ' + _formatTimestamp(loc.timestamp) + '</small>' +
                                   '<br><div style="display:flex; gap:5px; margin-top:5px;">' +
                                   '<button class="btn btn-sm" style="flex:1; padding:2px 8px; font-size:12px;" onclick="window.VidaSegura.Family.showHistory(\'' + uid + '\')">Ver Historial</button>' +
                                   '<button class="btn btn-sm btn-primary" style="flex:1; padding:2px 8px; font-size:12px;" onclick="window.open(\'https://www.google.com/maps/dir/?api=1&destination=' + loc.lat + ',' + loc.lng + '\', \'_system\')">Navegar</button>' +
                                   '</div>';

                // Actualizar info en la lista de miembros si existe
                var memberInfoEl = document.getElementById('member-info-' + uid);
                if (memberInfoEl) {
                    memberInfoEl.innerHTML = batteryHtml ? '<small>' + batteryHtml.substring(3) + '</small>' : '';
                }

                // Actualizar o crear marcador
                if (memberMarkers[uid]) {
                    memberMarkers[uid].setLatLng(latLng);
                    memberMarkers[uid].getPopup().setContent(popupContent);
                } else {
                    var marker = L.marker(latLng, {
                        title: name
                    }).addTo(familyMap);

                    marker.bindPopup(popupContent);

                    // Agregar etiqueta (tooltip permanente)
                    marker.bindTooltip(_escapeHtml(name), {
                        permanent: true,
                        direction: 'top',
                        offset: [0, -20],
                        className: 'member-label-tooltip'
                    });

                    memberMarkers[uid] = marker;
                }

                bounds.push(latLng);

                // Ajustar vista del mapa para incluir todos los marcadores
                if (bounds.length > 0 && familyMap) {
                    try {
                        familyMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
                    } catch (_) { /* ignorar si el mapa aún no tiene tamaño */ }
                }
            });

            // Guardar referencia para limpiar después
            locationListeners.push({ ref: locRef, uid: uid });
        });
    }

    /** Limpia todos los listeners de ubicación de Realtime Database */
    function _cleanupLocationListeners() {
        locationListeners.forEach(function (item) {
            try {
                item.ref.off('value');
            } catch (_) {}
        });
        locationListeners = [];

        // Limpiar marcadores del mapa
        Object.keys(memberMarkers).forEach(function (uid) {
            try {
                if (familyMap && memberMarkers[uid]) {
                    familyMap.removeLayer(memberMarkers[uid]);
                }
            } catch (_) {}
        });
        memberMarkers = {};
    }

    /** Formatea un timestamp para mostrar la hora */
    function _formatTimestamp(timestamp) {
        if (!timestamp) return '—';
        try {
            var date = new Date(timestamp);
            var hours = date.getHours().toString().padStart(2, '0');
            var minutes = date.getMinutes().toString().padStart(2, '0');
            return hours + ':' + minutes;
        } catch (_) {
            return '—';
        }
    }

    // ── Private: Init Family Map ────────────────────────────────────────
    function _initFamilyMap() {
        var container = document.getElementById('family-map-container');
        if (!container) return;

        try {
            if (typeof L === 'undefined') return;

            // Limpiar mapa existente
            if (familyMap) {
                familyMap.remove();
                familyMap = null;
            }

            // Centro en Venezuela: ~7.5, -66.0
            familyMap = L.map(container, {
                center: [7.5, -66.0],
                zoom: 6,
                zoomControl: false,
                attributionControl: false
            });

            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 18
            }).addTo(familyMap);

            // Forzar resize después del render
            setTimeout(function () {
                if (familyMap) familyMap.invalidateSize();
            }, 300);
        } catch (err) {
            console.warn('[Family] No se pudo inicializar el mapa:', err);
        }
    }

    // ── Private: Hide Detail View ───────────────────────────────────────
    function _hideDetail() {
        var detail = document.getElementById('family-circle-detail');
        if (detail) detail.classList.add('hidden');
        currentDetailCircleId = null;
    }

    // ── Private: Show Create Modal ──────────────────────────────────────
    function _showCreateModal() {
        App().showModal(
            'Crear Círculo Familiar',
            '<div class="form-group">' +
                '<label class="form-label" for="modal-circle-name">Nombre del círculo</label>' +
                '<input class="form-input" type="text" id="modal-circle-name" placeholder="Ej: Familia García" autofocus>' +
                '</div>',
            [
                {
                    text: 'Cancelar',
                    class: 'btn btn-ghost',
                    onClick: function () {
                        App().hideModal();
                    }
                },
                {
                    text: 'Crear',
                    class: 'btn btn-primary',
                    onClick: function () {
                        var input = document.getElementById('modal-circle-name');
                        var name = input ? input.value : '';
                        App().hideModal();
                        createCircle(name);
                    }
                }
            ]
        );

        // Enfocar input después de abrir el modal
        setTimeout(function () {
            var input = document.getElementById('modal-circle-name');
            if (input) input.focus();
        }, 100);
    }

    // ── Private: Show Join Modal ────────────────────────────────────────
    function _showJoinModal() {
        App().showModal(
            'Unirme a un Círculo',
            '<div class="form-group">' +
                '<label class="form-label" for="modal-circle-code">Código de invitación</label>' +
                '<input class="form-input" type="text" id="modal-circle-code" placeholder="Ej: ABC123" maxlength="6" style="text-transform:uppercase; letter-spacing:0.15em; font-size:1.25rem; text-align:center;" autofocus>' +
                '</div>' +
                '<p class="form-hint" style="margin-top:0.5rem;">Pide el código al creador del círculo</p>',
            [
                {
                    text: 'Cancelar',
                    class: 'btn btn-ghost',
                    onClick: function () {
                        App().hideModal();
                    }
                },
                {
                    text: 'Unirme',
                    class: 'btn btn-primary',
                    onClick: function () {
                        var input = document.getElementById('modal-circle-code');
                        var code = input ? input.value : '';
                        App().hideModal();
                        joinCircle(code);
                    }
                }
            ]
        );

        setTimeout(function () {
            var input = document.getElementById('modal-circle-code');
            if (input) input.focus();
        }, 100);
    }

    // ── Private: Confirm Leave ──────────────────────────────────────────
    function _confirmLeave() {
        return new Promise(function (resolve) {
            App().showModal(
                'Abandonar Círculo',
                '<p>¿Estás seguro de que deseas abandonar este círculo familiar? Esta acción no se puede deshacer.</p>',
                [
                    {
                        text: 'Cancelar',
                        class: 'btn btn-ghost',
                        onClick: function () {
                            App().hideModal();
                            resolve(false);
                        }
                    },
                    {
                        text: 'Abandonar',
                        class: 'btn btn-danger',
                        onClick: function () {
                            App().hideModal();
                            resolve(true);
                        }
                    }
                ]
            );
        });
    }

    // ── Private: Copy Circle Code ───────────────────────────────────────
    function _copyCircleCode() {
        var codeEl = document.getElementById('family-circle-code');
        if (!codeEl) return;

        var code = codeEl.dataset.code || codeEl.textContent;
        if (!code || code === '------') {
            App().showToast('No hay código para copiar', 'warning');
            return;
        }

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard
                .writeText(code)
                .then(function () {
                    App().showToast('Código copiado al portapapeles', 'success');
                })
                .catch(function () {
                    _fallbackCopy(code);
                });
        } else {
            _fallbackCopy(code);
        }
    }

    function _fallbackCopy(text) {
        try {
            var textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            App().showToast('Código copiado', 'success');
        } catch (_) {
            App().showToast('No se pudo copiar. Código: ' + text, 'info');
        }
    }

    // ── Private: Update Dashboard Family Section ────────────────────────
    function _updateDashboardFamily(circles) {
        var dashList = document.getElementById('dashboard-family-list');
        if (!dashList) return;

        if (!circles || circles.length === 0) {
            dashList.innerHTML =
                '<p class="empty-state">Crea un círculo familiar para conectar con tus seres queridos</p>';
            return;
        }

        var html = '';
        circles.slice(0, 3).forEach(function (c) {
            var count = c.members ? c.members.length : 0;
            html +=
                '<div class="family-mini-card">' +
                '<span class="family-mini-icon">👨‍👩‍👧‍👦</span>' +
                '<span class="family-mini-name">' +
                _escapeHtml(c.name) +
                '</span>' +
                '<span class="family-mini-count">' +
                count +
                '</span>' +
                '</div>';
        });
        dashList.innerHTML = html;
    }

    // ── Zonas Seguras ────────────────────────────────────────────────────────────

    async function _renderPlaces(circleId) {
        var list = document.getElementById('family-places-list');
        if (!list) return;

        try {
            var places = await window.VidaSegura.DB.getPlaces(circleId);
            if (!places || places.length === 0) {
                list.innerHTML = '<p class="empty-state">No hay lugares seguros</p>';
                return;
            }
            
            var html = '';
            places.forEach(function(p) {
                html += '<div class="member-item" style="justify-content: space-between;">' +
                        '<div>' +
                        '<span class="member-name">' + _escapeHtml(p.name) + '</span><br>' +
                        '<small>' + p.radius + 'm de radio</small>' +
                        '</div>' +
                        '<button class="btn btn-icon btn-sm btn-danger" onclick="window.VidaSegura.Family.deletePlace(\'' + circleId + '\', \'' + p.id + '\')">✕</button>' +
                        '</div>';
            });
            list.innerHTML = html;

            // Render on map
            setTimeout(function() {
                if (familyMap) {
                    places.forEach(function(p) {
                        L.circle([p.lat, p.lng], {
                            color: '#e74c3c',
                            fillColor: '#e74c3c',
                            fillOpacity: 0.2,
                            radius: p.radius
                        }).addTo(familyMap).bindPopup('Zona: ' + _escapeHtml(p.name));
                    });
                }
            }, 500);
        } catch (e) {
            console.error('[Family] Error rendering places:', e);
        }
    }

    function _showAddPlaceModal(circleId) {
        var modal = document.getElementById('modal-place');
        if (!modal) return;
        
        modal.classList.remove('hidden');
        var nameInput = document.getElementById('place-name');
        nameInput.value = '';
        nameInput.focus();

        document.getElementById('btn-cancel-place').onclick = function() {
            modal.classList.add('hidden');
        };
        
        document.getElementById('btn-confirm-place').onclick = async function() {
            var name = nameInput.value.trim();
            if (!name) return;
            
            try {
                var btn = this;
                btn.disabled = true;
                btn.textContent = 'Guardando...';

                // Usamos la posición actual
                var pos = await window.VidaSegura.GPS.getCurrentPosition(false);
                await window.VidaSegura.DB.savePlace(circleId, {
                    name: name,
                    lat: pos.lat,
                    lng: pos.lng,
                    radius: 100 // default
                });

                modal.classList.add('hidden');
                _renderPlaces(circleId);
                if (window.VidaSegura.Geofence) window.VidaSegura.Geofence.reload();

            } catch (e) {
                console.error('[Family] Error al guardar lugar:', e);
                alert('No se pudo guardar la ubicación. Asegúrate de tener GPS activo.');
            } finally {
                var btn2 = document.getElementById('btn-confirm-place');
                if(btn2) {
                    btn2.disabled = false;
                    btn2.textContent = 'Guardar Zona';
                }
            }
        };
    }

    async function deletePlace(circleId, placeId) {
        if (!confirm('¿Eliminar esta zona segura?')) return;
        try {
            await window.VidaSegura.DB.deletePlace(circleId, placeId);
            _renderPlaces(circleId);
            if (window.VidaSegura.Geofence) window.VidaSegura.Geofence.reload();
        } catch(e) {
            console.error('Error deletePlace:', e);
        }
    }

    // ── Historial de Rutas ────────────────────────────────────────────────────────

    async function showHistory(uid) {
        try {
            var locs = await window.VidaSegura.DB.getLocations(24, uid);
            if (!locs || locs.length < 2) {
                alert('No hay suficiente historial para este usuario.');
                return;
            }

            var latlngs = locs.map(function(l) { return [l.lat, l.lng]; });
            var polyline = L.polyline(latlngs, {color: '#3498db', weight: 4, dashArray: '5, 5'}).addTo(familyMap);
            familyMap.fitBounds(polyline.getBounds());
            
            alert('Mostrando historial de las últimas 24 horas.');
            
            // To clear the polyline later, we could store it, but for simplicity we just render it.
        } catch (e) {
            console.error('[Family] Error showHistory:', e);
        }
    }

    // ── Public API ──────────────────────────────────────────────────────
    return {
        init: init,
        createCircle: createCircle,
        joinCircle: joinCircle,
        leaveCircle: leaveCircle,
        renderCircles: renderCircles,
        showCircleDetail: showCircleDetail,
        showHistory: showHistory,
        deletePlace: deletePlace
    };
})();
