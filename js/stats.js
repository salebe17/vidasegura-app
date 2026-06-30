/**
 * VidaSegura - Módulo de Estadísticas de Preparación
 * Puntaje de preparación, desglose por criterios, consejos y simulacros.
 */
window.VidaSegura = window.VidaSegura || {};
window.VidaSegura.Stats = (function () {
    'use strict';

    const Utils = () => window.VidaSegura.Utils;
    const DB = () => window.VidaSegura.DB;
    const App = () => window.VidaSegura.App;
    const GPS = () => window.VidaSegura.GPS;

    let score = 0;
    let var newBreakdown = [];

    // ── Init ──────────────────────────────────────────────────────────────
    function init() {
        var btnSimulacro = document.getElementById('stats-simulacro-btn');
        if (btnSimulacro) {
            btnSimulacro.addEventListener('click', runSimulacro);
        }
    }

    // ── Calculate Score ──────────────────────────────────────────────────
    async function calculateScore() {
        try {
            var user = await DB().getUser();
            if (!user) user = {};

            score = 0;
            var newBreakdown = [];

            // 1. Perfil completo (20 pts)
            var profileComplete =
                !!user.name &&
                !!user.cedula &&
                !!user.bloodType &&
                !!user.birthdate;
            var profilePts = profileComplete ? 20 : 0;
            newBreakdown.push({
                label: 'Perfil completo',
                points: profilePts,
                maxPoints: 20,
                completed: profileComplete,
                icon: '👤'
            });

            // 2. Foto de perfil (10 pts)
            var hasPhoto = !!user.photo;
            var photoPts = hasPhoto ? 10 : 0;
            newBreakdown.push({
                label: 'Foto de perfil',
                points: photoPts,
                maxPoints: 10,
                completed: hasPhoto,
                icon: '📷'
            });

            // 3. Contacto de emergencia (15 pts)
            var hasContact1 =
                !!user.emergencyName1 &&
                !!user.emergencyPhone1;
            if (!hasContact1) {
                hasContact1 =
                    !!(user.emergencyContacts && user.emergencyContacts[0]);
            }
            var contact1Pts = hasContact1 ? 15 : 0;
            newBreakdown.push({
                label: 'Contacto de emergencia',
                points: contact1Pts,
                maxPoints: 15,
                completed: hasContact1,
                icon: '📞'
            });

            // 4. Segundo contacto (5 pts)
            var hasContact2 =
                !!user.emergencyName2 &&
                !!user.emergencyPhone2;
            if (!hasContact2) {
                hasContact2 =
                    !!(user.emergencyContacts && user.emergencyContacts[1]);
            }
            var contact2Pts = hasContact2 ? 5 : 0;
            newBreakdown.push({
                label: 'Segundo contacto',
                points: contact2Pts,
                maxPoints: 5,
                completed: hasContact2,
                icon: '📱'
            });

            // 5. GPS activo (20 pts)
            var gpsActive = false;
            try {
                if (GPS()) {
                    gpsActive =
                        (typeof GPS().isTracking === 'function' &&
                            GPS().isTracking()) ||
                        (typeof GPS().getLastKnownPosition === 'function' &&
                            !!GPS().getLastKnownPosition());
                }
            } catch (_) {}
            var gpsPts = gpsActive ? 20 : 0;
            newBreakdown.push({
                label: 'GPS activo',
                points: gpsPts,
                maxPoints: 20,
                completed: gpsActive,
                icon: '📍'
            });

            // 6. QR compartido (10 pts)
            var qrShared = false;
            try {
                var qrSetting = await DB().getSetting('qrShared');
                qrShared = qrSetting === 'true' || qrSetting === true;
            } catch (_) {}
            var qrPts = qrShared ? 10 : 0;
            newBreakdown.push({
                label: 'QR compartido',
                points: qrPts,
                maxPoints: 10,
                completed: qrShared,
                icon: '📱'
            });

            // 7. Círculo familiar (15 pts)
            var hasCircle = false;
            try {
                var circles = await DB().getCircles();
                hasCircle = Array.isArray(circles) && circles.length > 0;
            } catch (_) {}
            var circlePts = hasCircle ? 15 : 0;
            newBreakdown.push({
                label: 'Círculo familiar',
                points: circlePts,
                maxPoints: 15,
                completed: hasCircle,
                icon: '👨‍👩‍👧‍👦'
            });

            // 8. Notificaciones activas (5 pts)
            var notifActive = false;
            try {
                notifActive =
                    typeof Notification !== 'undefined' &&
                    Notification.permission === 'granted';
            } catch (_) {}
            var notifPts = notifActive ? 5 : 0;
            newBreakdown.push({
                label: 'Notificaciones activas',
                points: notifPts,
                maxPoints: 5,
                completed: notifActive,
                icon: '🔔'
            });

            // Total
            breakdown = newBreakdown; score = breakdown.reduce(function (sum, item) {
                return sum + item.points;
            }, 0);

            return score;
        } catch (err) {
            console.error('[Stats] Error calculando puntaje:', err);
            return 0;
        }
    }

    // ── Get Score Level ──────────────────────────────────────────────────
    function getScoreLevel(s) {
        var val = s !== undefined ? s : score;
        if (val < 25) return 'Principiante';
        if (val < 50) return 'Preparado';
        if (val < 75) return 'Protector';
        return 'Guardián';
    }

    // ── Render Stats ─────────────────────────────────────────────────────
    async function renderStats() {
        await calculateScore();

        // Update stats page score number
        var scoreNum = document.getElementById('stats-score-number');
        if (scoreNum) scoreNum.textContent = score;

        // Update SVG ring: circumference = 2 * PI * 70 ≈ 440
        var statsRing = document.getElementById('stats-progress-ring');
        if (statsRing) {
            var circumference = 2 * Math.PI * 70; // ~439.82
            var offset = circumference - (circumference * score) / 100;
            statsRing.style.strokeDasharray = circumference;
            statsRing.style.strokeDashoffset = offset;
        }

        // Update level label
        var levelLabel = document.getElementById('stats-score-label');
        if (levelLabel) levelLabel.textContent = getScoreLevel(score);

        // Render breakdown
        _renderBreakdown();

        // Render tips
        _renderTips();

        // Update dashboard progress ring (r=52, circumference ≈ 327)
        _updateDashboard();
    }

    // ── Get Tips ─────────────────────────────────────────────────────────
    function getTips() {
        var allTips = [
            '💧 Mantén al menos 3 litros de agua por persona para emergencias. Renuévala cada 6 meses.',
            '🔦 Ten linternas y baterías de repuesto en un lugar accesible. Considera una linterna de manivela.',
            '📋 Guarda copias digitales de tus documentos importantes en la nube. Cédula, pasaporte, títulos de propiedad.',
            '🏥 Aprende técnicas básicas de primeros auxilios. Un curso de la Cruz Roja puede salvar vidas.',
            '📍 Identifica las rutas de evacuación y puntos de encuentro de tu comunidad antes de que los necesites.',
            '🥫 Mantén un kit de alimentos no perecederos para 72 horas. Incluye abrelatas manual.',
            '📱 Carga siempre tu teléfono. Considera un cargador portátil o solar para emergencias.',
            '🏠 Revisa periódicamente la estructura de tu vivienda. Fisuras pueden indicar riesgo sísmico.',
            '👨‍👩‍👧‍👦 Practica simulacros familiares al menos dos veces al año. Todos deben conocer el plan.',
            '🎒 Prepara una mochila de emergencia con ropa, medicinas, documentos y dinero en efectivo.'
        ];

        // Rotate based on day of year
        var now = new Date();
        var start = new Date(now.getFullYear(), 0, 0);
        var diff = now - start;
        var dayOfYear = Math.floor(diff / 86400000);
        var startIdx = dayOfYear % allTips.length;

        var tips = [];
        for (var i = 0; i < 5; i++) {
            tips.push(allTips[(startIdx + i) % allTips.length]);
        }
        return tips;
    }

    // ── Run Simulacro ────────────────────────────────────────────────────
    async function runSimulacro() {
        // Step 1: Alert
        await _showSimulacroStep(
            '⚠️ SIMULACRO',
            '<div class="simulacro-alert">' +
                '<div class="simulacro-icon">🔴</div>' +
                '<h2>¡ALERTA SÍSMICA!</h2>' +
                '<p>Se ha detectado actividad sísmica significativa en tu zona.</p>' +
                '<p class="simulacro-badge">— ESTO ES UN SIMULACRO —</p>' +
                '</div>',
            'Continuar'
        );

        // Step 2: Protocol (after 2s visual delay)
        await _delay(2000);

        await _showSimulacroStep(
            '📋 Protocolo de Seguridad',
            '<div class="simulacro-protocol">' +
                '<ol class="protocol-steps">' +
                '<li>Mantén la calma. No corras.</li>' +
                '<li>Aléjate de ventanas y objetos que puedan caer.</li>' +
                '<li>Agáchate, cúbrete y sujétate debajo de una mesa.</li>' +
                '<li>Si estás al aire libre, busca un espacio abierto.</li>' +
                '<li>Después del temblor, revisa heridos y daños.</li>' +
                '<li>Comunica tu estado a tus contactos de emergencia.</li>' +
                '</ol>' +
                '</div>',
            'He leído los pasos'
        );

        // Step 3: Completion confirmation
        await _showSimulacroStep(
            '✅ Simulacro Finalizado',
            '<div class="simulacro-complete">' +
                '<div class="simulacro-icon">✅</div>' +
                '<p>¿Has completado el simulacro siguiendo los pasos indicados?</p>' +
                '</div>',
            'Sí, lo completé'
        );

        // Save completion
        try {
            await DB().saveSetting('lastSimulacro', Date.now().toString());
        } catch (_) {}

        App().showToast('Simulacro completado. ¡Bien hecho!', 'success');

        // Refresh stats since completing a simulacro might be tracked
        renderStats();
    }

    // ── Private: Render Breakdown ────────────────────────────────────────
    function _renderBreakdown() {
        var container = document.getElementById('stats-breakdown');
        if (!container) return;

        container.innerHTML =
            '<h3 class="card-title">📊 Desglose de Preparación</h3>';

        breakdown.forEach(function (item) {
            var statusClass = item.completed
                ? 'stats-done'
                : 'stats-pending';
            var statusIcon = item.completed ? '✅' : '⬜';

            var div = document.createElement('div');
            div.className = 'stats-criteria ' + statusClass;
            div.innerHTML =
                '<div class="criteria-left">' +
                '<span class="criteria-icon">' +
                item.icon +
                '</span>' +
                '<span class="criteria-label">' +
                item.label +
                '</span>' +
                '</div>' +
                '<div class="criteria-right">' +
                '<span class="criteria-points">' +
                item.points +
                '/' +
                item.maxPoints +
                '</span>' +
                '<span class="criteria-status">' +
                statusIcon +
                '</span>' +
                '</div>';

            container.appendChild(div);
        });
    }

    // ── Private: Render Tips ─────────────────────────────────────────────
    function _renderTips() {
        var container = document.getElementById('stats-tips');
        if (!container) return;

        var tips = getTips();
        container.innerHTML = '';

        tips.forEach(function (tip) {
            var div = document.createElement('div');
            div.className = 'stats-tip';
            div.textContent = tip;
            container.appendChild(div);
        });
    }

    // ── Private: Update Dashboard ────────────────────────────────────────
    function _updateDashboard() {
        // Dashboard progress ring: r=52, circumference ≈ 327
        var dashRing = document.getElementById('dashboard-progress-ring');
        if (dashRing) {
            var circumference = 2 * Math.PI * 52; // ~326.73
            var offset = circumference - (circumference * score) / 100;
            dashRing.style.strokeDasharray = circumference;
            dashRing.style.strokeDashoffset = offset;
        }

        // Dashboard progress text
        var dashText = document.getElementById('dashboard-progress-text');
        if (dashText) dashText.textContent = score + '%';

        // Dashboard score number
        var dashScore = document.getElementById('dashboard-score');
        if (dashScore) {
            var scoreEl = dashScore.querySelector('.score-number');
            if (scoreEl) scoreEl.textContent = score;
        }
    }

    // ── Private: Simulacro Step ──────────────────────────────────────────
    function _showSimulacroStep(title, bodyHtml, confirmText) {
        return new Promise(function (resolve) {
            App().showModal(title, bodyHtml, [
                {
                    text: confirmText,
                    class: 'btn btn-primary btn-block',
                    onClick: function () {
                        App().hideModal();
                        resolve();
                    }
                }
            ]);
        });
    }

    // ── Private: Delay ───────────────────────────────────────────────────
    function _delay(ms) {
        return new Promise(function (resolve) {
            setTimeout(resolve, ms);
        });
    }

    // ── Public API ───────────────────────────────────────────────────────
    return {
        init: init,
        calculateScore: calculateScore,
        getScoreLevel: getScoreLevel,
        renderStats: renderStats,
        getTips: getTips,
        runSimulacro: runSimulacro
    };
})();
