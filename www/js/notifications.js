/**
 * VidaSegura - Módulo de Notificaciones
 * Gestión de permisos y envío de notificaciones (Web y Capacitor LocalNotifications).
 */
window.VidaSegura = window.VidaSegura || {};
window.VidaSegura.Notifications = (function () {
    'use strict';

    const App = () => window.VidaSegura.App;

    let isWebAvailable = false;
    let isCapacitor = false;

    // 🚀 Init 🚀
    async function init() {
        isWebAvailable = typeof Notification !== 'undefined' && 'Notification' in window;
        isCapacitor = !!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications);

        if (!isWebAvailable && !isCapacitor) {
            console.warn('[Notifications] API de Notificaciones no disponible en este dispositivo.');
        }
    }

    // 🔑 Request Permission 🔑
    async function requestPermission() {
        if (isCapacitor) {
            try {
                var check = await window.Capacitor.Plugins.LocalNotifications.checkPermissions();
                if (check.display === 'granted') {
                    return true; // Already granted, no toast needed
                }
                var perm = await window.Capacitor.Plugins.LocalNotifications.requestPermissions();
                if (perm.display === 'granted') {
                    try { App().showToast('Notificaciones activadas', 'success'); } catch (_) {}
                    return true;
                } else {
                    try { App().showToast('Permiso de notificaciones denegado', 'warning'); } catch (_) {}
                    return false;
                }
            } catch (err) {
                console.error('[Notifications] Error Capacitor requestPermissions:', err);
                return false;
            }
        } else if (isWebAvailable) {
            if (Notification.permission === 'granted') return true;
            if (Notification.permission === 'denied') {
                try { App().showToast('Notificaciones bloqueadas en tu navegador.', 'warning'); } catch (_) {}
                return false;
            }
            try {
                var result = await Notification.requestPermission();
                if (result === 'granted') {
                    try { App().showToast('Notificaciones activadas', 'success'); } catch (_) {}
                    return true;
                }
                return false;
            } catch (err) {
                return false;
            }
        }
        return false;
    }

    // 🔔 Send Local Notification 🔔
    function sendLocalNotification(title, body, options) {
        var opts = options || {};

        if (isCapacitor) {
            var notifId = Math.floor(Math.random() * 2000000000); // Int32
            try {
                window.Capacitor.Plugins.LocalNotifications.schedule({
                    notifications: [
                        {
                            title: title,
                            body: body,
                            id: notifId,
                            schedule: { at: new Date(Date.now() + 100) },
                            actionTypeId: '',
                            extra: opts.data || null
                        }
                    ]
                });
                return notifId;
            } catch (e) {
                console.error('[Notifications] Error Capacitor schedule:', e);
                return null;
            }
        } else if (isWebAvailable && Notification.permission === 'granted') {
            try {
                var notification = new Notification(title, {
                    body: body,
                    icon: opts.icon || 'assets/icon.svg',
                    vibrate: opts.vibrate || [200, 100, 200],
                    tag: opts.tag || 'vidasegura',
                    requireInteraction: opts.requireInteraction || false
                });
                if (!opts.requireInteraction) {
                    setTimeout(function () { notification.close(); }, 10000);
                }
                notification.onclick = function () { window.focus(); notification.close(); };
                return notification;
            } catch (err) {
                console.error('[Notifications] Error creando notificación web:', err);
                return null;
            }
        }
        return null;
    }

    // ✅ Is Permission Granted ✅
    async function isPermissionGranted() {
        if (isCapacitor) {
            try {
                var status = await window.Capacitor.Plugins.LocalNotifications.checkPermissions();
                return status.display === 'granted';
            } catch (e) {
                return false;
            }
        } else if (isWebAvailable) {
            return Notification.permission === 'granted';
        }
        return false;
    }

    // 🚨 Send Emergency Notification 🚨
    function sendEmergencyNotification(userName, location) {
        var body = (userName || 'Un usuario') + ' ha activado una alerta de emergencia.';
        if (location && location.lat && location.lng) {
            body += ' Ubicación: ' + location.lat.toFixed(6) + ', ' + location.lng.toFixed(6);
        }
        return sendLocalNotification('🆘 EMERGENCIA', body, {
            tag: 'sos-alert',
            requireInteraction: true,
            vibrate: [500, 200, 500, 200, 500]
        });
    }

    // 🌍 Send Seismic Notification 🌍
    function sendSeismicNotification(alert) {
        if (!alert) return null;
        var magnitude = alert.magnitude !== null && alert.magnitude !== undefined ? alert.magnitude.toFixed(1) : '?';
        var body = 'Sismo de magnitud ' + magnitude + ' detectado cerca de ' + (alert.place || 'ubicación desconocida') + '.';
        return sendLocalNotification('⚠️ Alerta Sísmica', body, {
            tag: 'seismic-' + (alert.id || Date.now()),
            vibrate: [300, 100, 300, 100, 300]
        });
    }

    // 🌀 Background SOS Listeners 🌀
    let sosListeners = {};

    async function startBackgroundListeners(uid) {
        if (!uid) return;
        var DB = window.VidaSegura.DB;
        if (!DB) return;

        try {
            var circles = await DB.getCircles();
            var memberIds = new Set();
            circles.forEach(function(c) {
                if (c.members) c.members.forEach(function(m) { memberIds.add(m); });
            });
            memberIds.delete(uid); // No escucharnos a nosotros mismos

            memberIds.forEach(function(memberId) {
                if (!sosListeners[memberId]) {
                    var ref = window.realtimeDb.ref('users/' + memberId + '/sosActive');
                    sosListeners[memberId] = ref;
                    
                    ref.on('value', async function(snapshot) {
                        var isActive = snapshot.val();
                        if (isActive) {
                            var name = 'Familiar';
                            circles.forEach(function(c) {
                                if (c.memberNames && c.memberNames[memberId]) name = c.memberNames[memberId];
                            });
                            
                            var locSnapshot = await window.realtimeDb.ref('users/' + memberId + '/location').once('value');
                            var loc = locSnapshot.exists() ? locSnapshot.val() : null;
                            
                            sendEmergencyNotification(name, loc);
                        }
                    });
                }
            });
        } catch(e) { 
            console.warn('[Notifications] Error en listener SOS:', e); 
        }
    }

    // 📡 Public API 📡
    return {
        init: init,
        requestPermission: requestPermission,
        sendLocalNotification: sendLocalNotification,
        isPermissionGranted: isPermissionGranted,
        sendEmergencyNotification: sendEmergencyNotification,
        sendSeismicNotification: sendSeismicNotification,
        startBackgroundListeners: startBackgroundListeners
    };
})();
