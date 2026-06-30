/**
 * VidaSegura - Módulo de Chat de Emergencia (Firebase)
 * Mensajería en tiempo real MULTI-USUARIO por círculos familiares con Firestore.
 *
 * Firestore:  circles/{circleId}/messages/{autoId}
 *             → { senderId, senderName, text, type, lat?, lng?, timestamp }
 *
 * Globals:    firestore, firebaseAuth  (from firebase-config.js)
 */
window.VidaSegura = window.VidaSegura || {};
window.VidaSegura.Chat = (function () {
    'use strict';

    // ── Lazy accessors for sibling modules ──────────────────────────────
    var App = function () { return window.VidaSegura.App; };
    var GPS = function () { return window.VidaSegura.GPS; };

    // ── Private state ───────────────────────────────────────────────────
    var currentCircleId = null;             // Círculo seleccionado actualmente
    var messagesUnsubscribe = null;         // Función para cancelar onSnapshot de mensajes
    var circlesUnsubscribe = null;          // Función para cancelar onSnapshot de círculos (selector)

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

    /** Escapa HTML para evitar XSS */
    function _escapeHtml(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    /** Formatea un timestamp (Firestore Timestamp o Date) a HH:MM */
    function _formatMessageTime(timestamp) {
        if (!timestamp) return '';

        try {
            // Firestore Timestamps tienen el método toDate()
            var date;
            if (timestamp && typeof timestamp.toDate === 'function') {
                date = timestamp.toDate();
            } else if (timestamp instanceof Date) {
                date = timestamp;
            } else {
                date = new Date(timestamp);
            }

            var hours = date.getHours().toString().padStart(2, '0');
            var minutes = date.getMinutes().toString().padStart(2, '0');
            return hours + ':' + minutes;
        } catch (_) {
            return '';
        }
    }

    // ── Init ────────────────────────────────────────────────────────────
    function init() {
        // Botón de enviar mensaje
        var btnSend = document.getElementById('btn-send-message');
        if (btnSend) {
            btnSend.addEventListener('click', function () {
                var input = document.getElementById('chat-input');
                if (input) {
                    sendMessage(input.value);
                }
            });
        }

        // Enter para enviar (sin shift)
        var chatInput = document.getElementById('chat-input');
        if (chatInput) {
            chatInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage(chatInput.value);
                }
            });
        }

        // Botones de mensaje rápido
        var quickContainer = document.getElementById('chat-quick-messages');
        if (quickContainer) {
            quickContainer.addEventListener('click', function (e) {
                var btn = e.target.closest('[data-msg]');
                if (btn) {
                    sendQuickMessage(btn.dataset.msg);
                }
            });
        }

        // Botón de enviar ubicación
        var btnLocation = document.getElementById('btn-send-location');
        if (btnLocation) {
            btnLocation.addEventListener('click', sendLocation);
        }

        // Escuchar cambios de autenticación
        firebaseAuth.onAuthStateChanged(function (user) {
            if (user) {
                _setupCircleSelector();
            } else {
                _stopAllListeners();
            }
        });
    }

    // ── Load Messages (real-time via onSnapshot) ────────────────────────
    /**
     * Inicia un listener en tiempo real para los mensajes de un círculo.
     * Cancela automáticamente el listener del círculo anterior.
     *
     * @param {string} circleId - ID del círculo en Firestore
     */
    function loadMessages(circleId) {
        // Cancelar listener anterior de mensajes
        _stopMessagesListener();

        currentCircleId = circleId;

        if (!circleId) {
            _renderEmptyMessages();
            return;
        }

        // Escuchar mensajes en tiempo real, ordenados por timestamp
        messagesUnsubscribe = firestore
            .collection('circles').doc(circleId)
            .collection('messages')
            .orderBy('timestamp', 'asc')
            .onSnapshot(function (snapshot) {
                var messages = [];
                snapshot.forEach(function (doc) {
                    messages.push(Object.assign({ id: doc.id }, doc.data()));
                });

                renderMessages(messages);
            }, function (err) {
                console.error('[Chat] Error en listener de mensajes:', err);
                _renderEmptyMessages();
            });
    }

    // ── Send Message ────────────────────────────────────────────────────
    /**
     * Envía un mensaje de texto al círculo actual.
     * @param {string} text - Contenido del mensaje
     */
    function sendMessage(text) {
        if (!currentCircleId) {
            App().showToast('Selecciona un círculo primero', 'warning');
            return;
        }

        if (!text || !text.trim()) return;

        var uid = _currentUid();
        if (!uid) {
            App().showToast('Debes iniciar sesión para enviar mensajes', 'error');
            return;
        }

        var messageData = {
            senderId: uid,
            senderName: _currentUserName(),
            text: text.trim(),
            type: 'text',
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        };

        firestore
            .collection('circles').doc(currentCircleId)
            .collection('messages')
            .add(messageData)
            .then(function () {
                // Limpiar input
                var input = document.getElementById('chat-input');
                if (input) {
                    input.value = '';
                    input.focus();
                }
                // El onSnapshot se encarga de renderizar el nuevo mensaje
            })
            .catch(function (err) {
                console.error('[Chat] Error enviando mensaje:', err);
                App().showToast('Error al enviar el mensaje', 'error');
            });
    }

    // ── Send Quick Message ──────────────────────────────────────────────
    /**
     * Envía un mensaje predefinido rápido.
     * @param {string} type - Tipo de mensaje rápido (safe, help, coming, shelter)
     */
    function sendQuickMessage(type) {
        var quickMessages = {
            safe: 'Estoy bien ✅',
            help: 'Necesito ayuda 🆘',
            coming: 'Estoy en camino 🚗',
            shelter: 'Estoy en un refugio ⛑️'
        };

        var text = quickMessages[type];
        if (text) {
            sendMessage(text);
        }
    }

    // ── Send Location ───────────────────────────────────────────────────
    /**
     * Obtiene la ubicación actual del usuario y la envía como mensaje de ubicación.
     */
    function sendLocation() {
        if (!currentCircleId) {
            App().showToast('Selecciona un círculo primero', 'warning');
            return;
        }

        var uid = _currentUid();
        if (!uid) {
            App().showToast('Debes iniciar sesión para compartir ubicación', 'error');
            return;
        }

        App().showToast('Obteniendo ubicación...', 'info');

        // Usar la API del navegador directamente como fallback si GPS module no está listo
        var gps = GPS();
        var getPos;

        if (gps && typeof gps.getCurrentPosition === 'function') {
            getPos = gps.getCurrentPosition();
        } else {
            getPos = new Promise(function (resolve, reject) {
                if (!navigator.geolocation) {
                    reject(new Error('Geolocalización no disponible'));
                    return;
                }
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 30000
                });
            });
        }

        getPos.then(function (position) {
            if (!position || !position.coords) {
                App().showToast('No se pudo obtener la ubicación', 'error');
                return;
            }

            var lat = parseFloat(position.coords.latitude.toFixed(6));
            var lng = parseFloat(position.coords.longitude.toFixed(6));
            var text = '📍 Mi ubicación: ' + lat + ', ' + lng;

            var messageData = {
                senderId: uid,
                senderName: _currentUserName(),
                text: text,
                type: 'location',
                lat: lat,
                lng: lng,
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            };

            return firestore
                .collection('circles').doc(currentCircleId)
                .collection('messages')
                .add(messageData)
                .then(function () {
                    App().showToast('Ubicación compartida', 'success');
                });
        }).catch(function (err) {
            console.error('[Chat] Error enviando ubicación:', err);
            App().showToast('Error al obtener la ubicación', 'error');
        });
    }

    // ── Render Messages ─────────────────────────────────────────────────
    /**
     * Renderiza los mensajes en la UI del chat.
     * Los mensajes propios aparecen a la derecha, los de otros a la izquierda.
     *
     * @param {Array} messages - Array de objetos de mensaje de Firestore
     */
    function renderMessages(messages) {
        var container = document.getElementById('chat-messages');
        if (!container) return;

        container.innerHTML = '';

        if (!messages || messages.length === 0) {
            _renderEmptyMessages();
            return;
        }

        var currentUid = _currentUid();

        messages.forEach(function (msg) {
            var bubble = document.createElement('div');
            var isSent = (msg.senderId === currentUid);

            bubble.className =
                'chat-bubble ' +
                (isSent ? 'chat-bubble-sent' : 'chat-bubble-received');

            var timeStr = _formatMessageTime(msg.timestamp);
            var content = _escapeHtml(msg.text);

            // Si es un mensaje de ubicación, agregar enlace clicable al mapa
            if (msg.type === 'location' && msg.lat != null && msg.lng != null) {
                content +=
                    '<br><a class="chat-location-link" href="https://www.google.com/maps?q=' +
                    msg.lat +
                    ',' +
                    msg.lng +
                    '" target="_blank" rel="noopener">Ver en mapa ↗</a>';
            }

            bubble.innerHTML =
                '<div class="chat-bubble-content">' +
                content +
                '</div>' +
                '<div class="chat-bubble-meta">' +
                (isSent
                    ? ''
                    : '<span class="chat-sender">' +
                      _escapeHtml(msg.senderName || 'Usuario') +
                      '</span>') +
                '<span class="chat-time">' +
                timeStr +
                '</span>' +
                '</div>';

            container.appendChild(bubble);
        });

        _scrollToBottom();
    }

    /** Renderiza el estado vacío de mensajes */
    function _renderEmptyMessages() {
        var container = document.getElementById('chat-messages');
        if (!container) return;

        container.innerHTML =
            '<div class="empty-state chat-empty">' +
            '<p class="empty-icon">💬</p>' +
            '<p>No hay mensajes en este círculo</p>' +
            '<p class="empty-hint">Envía un mensaje rápido o escribe uno personalizado</p>' +
            '</div>';
    }

    // ── Setup Circle Selector (real-time) ───────────────────────────────
    /**
     * Configura el selector de círculos con un listener en tiempo real.
     * Cuando se agregan/eliminan círculos, el selector se actualiza automáticamente.
     */
    function _setupCircleSelector() {
        var uid = _currentUid();
        if (!uid) return;

        var selector = document.getElementById('chat-circle-selector');
        if (!selector) return;

        // Cancelar listener anterior del selector
        if (circlesUnsubscribe) {
            circlesUnsubscribe();
            circlesUnsubscribe = null;
        }

        // Escuchar círculos en tiempo real
        circlesUnsubscribe = firestore.collection('circles')
            .where('members', 'array-contains', uid)
            .onSnapshot(function (snapshot) {
                var circles = [];
                snapshot.forEach(function (doc) {
                    circles.push(Object.assign({ id: doc.id }, doc.data()));
                });

                _renderCircleSelector(circles, selector);
            }, function (err) {
                console.error('[Chat] Error en listener de círculos:', err);
                selector.innerHTML =
                    '<span class="chat-selector-empty">Error cargando círculos</span>';
            });
    }

    /**
     * Renderiza los tabs/botones del selector de círculos.
     * @param {Array} circles - Array de objetos de círculo
     * @param {HTMLElement} selector - Contenedor del selector
     */
    function _renderCircleSelector(circles, selector) {
        selector.innerHTML = '';

        if (!circles || circles.length === 0) {
            selector.innerHTML =
                '<span class="chat-selector-empty">Crea un círculo familiar para chatear</span>';
            currentCircleId = null;
            _stopMessagesListener();
            _renderEmptyMessages();
            return;
        }

        // Verificar si el círculo actualmente seleccionado aún existe
        var currentStillExists = false;
        if (currentCircleId) {
            currentStillExists = circles.some(function (c) {
                return c.id === currentCircleId;
            });
        }

        // Si el círculo actual ya no existe, seleccionar el primero
        if (!currentStillExists) {
            currentCircleId = circles[0].id;
        }

        circles.forEach(function (circle) {
            var btn = document.createElement('button');
            btn.className = 'btn btn-sm chat-circle-tab';
            btn.textContent = circle.name;
            btn.dataset.circleId = circle.id;

            if (circle.id === currentCircleId) {
                btn.classList.add('active');
            }

            btn.addEventListener('click', function () {
                // Actualizar estado visual
                selector
                    .querySelectorAll('.chat-circle-tab')
                    .forEach(function (b) {
                        b.classList.remove('active');
                    });
                btn.classList.add('active');

                // Cargar mensajes del círculo seleccionado
                loadMessages(circle.id);
            });

            selector.appendChild(btn);
        });

        // Cargar mensajes del círculo seleccionado
        loadMessages(currentCircleId);
    }

    // ── Private: Listener Management ────────────────────────────────────

    /** Cancela el listener de onSnapshot de mensajes */
    function _stopMessagesListener() {
        if (messagesUnsubscribe) {
            messagesUnsubscribe();
            messagesUnsubscribe = null;
        }
    }

    /** Cancela todos los listeners activos */
    function _stopAllListeners() {
        _stopMessagesListener();

        if (circlesUnsubscribe) {
            circlesUnsubscribe();
            circlesUnsubscribe = null;
        }

        currentCircleId = null;
    }

    // ── Private: Scroll to Bottom ───────────────────────────────────────
    function _scrollToBottom() {
        var container = document.getElementById('chat-messages');
        if (container) {
            requestAnimationFrame(function () {
                container.scrollTop = container.scrollHeight;
            });
        }
    }

    // ── Public API ──────────────────────────────────────────────────────
    return {
        init: init,
        loadMessages: loadMessages,
        sendMessage: sendMessage,
        sendQuickMessage: sendQuickMessage,
        sendLocation: sendLocation,
        renderMessages: renderMessages
    };
})();
