/**
 * VidaSegura — Controlador Principal de la Aplicación (Firebase)
 * Manejo de navegación, ciclo de vida de páginas, UI y módulos.
 *
 * Cambios clave respecto a la versión IndexedDB:
 *   - No llama a DB.init(); Firebase se inicializa en firebase-config.js.
 *   - Usa firebaseAuth.onAuthStateChanged() para detectar sesión.
 *   - Registro de Service Worker eliminado (se restaurará con FCM).
 *   - refreshDashboard() obtiene usuario vía DB.getUser() (Firestore).
 *   - Perfil público sigue funcionando para visitantes no autenticados.
 *
 * Globals requeridos: firebaseAuth, firestore  (de firebase-config.js)
 */
window.VidaSegura = window.VidaSegura || {};
window.VidaSegura.App = {

  /** Estado de la aplicación */
  state: {
    currentPage: 'onboarding',
    previousPage: null,
    history: [],
    isOnline: navigator.onLine
  },

  /** Prompt diferido para instalación PWA */
  _deferredPrompt: null,

  /** Páginas que ocultan la barra de navegación */
  _noNavPages: ['onboarding', 'register', 'login', 'public-profile', 'sos-active'],

  /** Páginas que ocultan el botón SOS */
  _noSOSPages: ['onboarding', 'register', 'login', 'sos-active'],

  /** Páginas principales del nav */
  _mainNavPages: ['dashboard', 'map', 'family', 'settings'],

  /**
   * Inicializa la aplicación completa.
   * Se llama en DOMContentLoaded.
   */
  async init() {
    try {
      console.log('[App] Inicializando VidaSegura (Firebase)…');

      // 1. Verificar si la URL tiene perfil público (QR escaneado externamente).
      //    Esto se evalúa ANTES de comprobar auth porque los visitantes
      //    no autenticados deben poder ver el perfil público.
      var hash = window.location.hash;
      var isPublicProfileURL = hash && (hash.startsWith('#p=') || hash.startsWith('#profile='));

      if (isPublicProfileURL) {
        // Perfil público: no redirigir, dejar que _checkURLHash lo maneje
        console.log('[App] URL de perfil público detectada, cargando perfil…');
      } else {
        // 2. Determinar destino inicial según estado de autenticación Firebase.
        //    Usamos una promesa única sobre onAuthStateChanged para obtener
        //    el estado actual sin dejar el listener abierto (Auth.init se
        //    encarga del listener persistente).
        var firebaseUser = await new Promise(function (resolve) {
          var unsub = firebaseAuth.onAuthStateChanged(function (user) {
            unsub(); // dejar de escuchar tras el primer evento
            resolve(user);
          });
        });

        if (firebaseUser) {
          // Usuario autenticado — ir al dashboard
          this.navigate('dashboard');
          this._showNav();
          this._showSOS();
        } else {
          // No hay sesión — verificar si ya pasó por onboarding.
          // Como no hay usuario autenticado, intentamos leer la marca desde
          // localStorage (Firestore necesita auth).
          var onboardingDone = localStorage.getItem('vidasegura_onboardingDone');
          if (onboardingDone) {
            this.navigate('login');
          } else {
            this.navigate('onboarding');
          }
        }
      }

      // 3. Inicializar módulos existentes
      this._initModules();

      // 4. Configurar event listeners
      this._setupEventListeners();

      // 5. Manejar prompt de instalación PWA
      this._handleInstallPrompt();

      // 6. Ocultar pantalla de carga después de 1 segundo
      setTimeout(function () {
        window.VidaSegura.App.hideLoading();
      }, 1000);

      // 7. Verificar hash de URL para perfil público
      this._checkURLHash();

      console.log('[App] VidaSegura inicializada correctamente (Firebase).');
    } catch (e) {
      console.error('[App] Error durante la inicialización:', e);
      this.hideLoading();
      this.showToast('Error al iniciar la aplicación', 'error');
    }
  },

  /**
   * Inicializa todos los módulos que tengan función init().
   */
  _initModules() {
    var moduleNames = [
      'Auth', 'Profile', 'QR', 'GPS', 'Geofence', 'Map', 'SOS',
      'Family', 'Chat', 'Alerts', 'Resources', 'Stats', 'Notifications'
    ];
    moduleNames.forEach(function (name) {
      try {
        var mod = window.VidaSegura[name];
        if (mod && typeof mod.init === 'function') {
          mod.init();
          console.log('[App] Módulo ' + name + ' inicializado.');
        }
      } catch (e) {
        console.warn('[App] Error al inicializar módulo ' + name + ':', e);
      }
    });
  },

  /**
   * Configura todos los event listeners de la aplicación.
   */
  _setupEventListeners() {
    var self = this;

    // Offline / Online status
    window.addEventListener('offline', function() {
      var banner = document.getElementById('offline-banner');
      if (banner) banner.classList.remove('hidden');
    });
    window.addEventListener('online', function() {
      var banner = document.getElementById('offline-banner');
      if (banner) banner.classList.add('hidden');
    });

    // Check initial state
    if (!navigator.onLine) {
      var banner = document.getElementById('offline-banner');
      if (banner) banner.classList.remove('hidden');
    }

    // Botones de retroceso
    document.querySelectorAll('.btn-back[data-back]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        self.goBack();
      });
    });

    // Navegación principal
    document.querySelectorAll('.nav-item[data-page]').forEach(function (item) {
      item.addEventListener('click', function (e) {
        e.preventDefault();
        var page = item.dataset.page;
        if (page) self.navigate(page);
      });
    });

    // Acciones rápidas
    document.querySelectorAll('.quick-action-item[data-action]').forEach(function (item) {
      item.addEventListener('click', function (e) {
        e.preventDefault();
        var action = item.dataset.action;
        if (action) self.navigate(action);
      });
    });

    // Botón editar perfil
    var btnEditProfile = document.getElementById('btn-edit-profile');
    if (btnEditProfile) {
      btnEditProfile.addEventListener('click', function () { self.navigate('profile'); });
    }

    // Botón ver QR
    var btnViewQR = document.getElementById('btn-view-qr');
    if (btnViewQR) {
      btnViewQR.addEventListener('click', function () { self.navigate('qr-view'); });
    }

    // Botón ver estadísticas
    var btnViewStats = document.getElementById('btn-view-stats');
    if (btnViewStats) {
      btnViewStats.addEventListener('click', function () { self.navigate('stats'); });
    }

    // Clic en el mapa del dashboard abre la página de mapa completa
    var mapPreview = document.getElementById('dashboard-map-preview');
    if (mapPreview) {
      mapPreview.addEventListener('click', function () { self.navigate('map'); });
    }

    // Estado de conexión
    window.addEventListener('online', function () {
      self.state.isOnline = true;
      self.showToast('Conexión restablecida', 'success');
    });

    window.addEventListener('offline', function () {
      self.state.isOnline = false;
      self.showToast('Sin conexión a internet', 'warning');
    });

    // Toggle de tema — guardado en localStorage (no requiere auth)
    var themeToggle = document.getElementById('settings-theme-toggle');
    if (themeToggle) {
      themeToggle.addEventListener('change', function () {
        var newTheme = themeToggle.checked ? 'dark' : 'light';
        document.documentElement.dataset.theme = newTheme;
        try {
          localStorage.setItem('vidasegura_theme', newTheme);
          // También persistir en Firestore si hay sesión
          var DB = window.VidaSegura.DB;
          if (firebaseAuth.currentUser && DB && DB.saveSetting) {
            DB.saveSetting('theme', newTheme).catch(function () {});
          }
        } catch (e) {
          console.warn('[App] Error al guardar tema:', e);
        }
      });

      // Cargar tema guardado (localStorage primero, luego Firestore)
      var savedTheme = localStorage.getItem('vidasegura_theme');
      if (savedTheme) {
        document.documentElement.dataset.theme = savedTheme;
        themeToggle.checked = savedTheme === 'dark';
      } else if (firebaseAuth.currentUser) {
        window.VidaSegura.DB.getSetting('theme').then(function (theme) {
          if (theme) {
            document.documentElement.dataset.theme = theme;
            themeToggle.checked = theme === 'dark';
          }
        }).catch(function () {});
      }
    }

    // Botón instalar PWA
    var btnInstall = document.getElementById('btn-install-pwa');
    if (btnInstall) {
      btnInstall.addEventListener('click', async function () {
        if (self._deferredPrompt) {
          try {
            self._deferredPrompt.prompt();
            var result = await self._deferredPrompt.userChoice;
            console.log('[App] Resultado de instalación:', result.outcome);
            if (result.outcome === 'accepted') {
              self.showToast('¡Aplicación instalada correctamente!', 'success');
            }
          } catch (e) {
            console.warn('[App] Error al instalar PWA:', e);
          }
          self._deferredPrompt = null;
          btnInstall.style.display = 'none';
        }
      });
    }

    // Cerrar modal al hacer clic fuera
    var modalOverlay = document.getElementById('modal-overlay');
    if (modalOverlay) {
      modalOverlay.addEventListener('click', function (e) {
        if (e.target === modalOverlay) {
          self.hideModal();
        }
      });
    }

    // ── Onboarding slides ──
    this._setupOnboarding();
  },

  /**
   * Configura la navegación del onboarding (slides, dots, botones).
   */
  _onboardingSlide: 0,

  _setupOnboarding() {
    var self = this;
    var btnNext  = document.getElementById('btn-onboarding-next');
    var btnStart = document.getElementById('btn-onboarding-start');
    var btnSkip  = document.getElementById('btn-onboarding-skip');
    var slides   = document.querySelectorAll('.onboarding-slide');
    var dots     = document.querySelectorAll('.onboarding-dots .dot');
    var totalSlides = slides.length;

    if (!btnNext || !slides.length) return;

    var goToSlide = function (index) {
      if (index < 0 || index >= totalSlides) return;
      self._onboardingSlide = index;
      slides.forEach(function (s, i) {
        s.classList.toggle('active', i === index);
      });
      dots.forEach(function (d, i) {
        d.classList.toggle('active', i === index);
      });
      // Último slide: mostrar "Comenzar", ocultar "Siguiente"
      if (index === totalSlides - 1) {
        btnNext.classList.add('hidden');
        btnStart.classList.remove('hidden');
      } else {
        btnNext.classList.remove('hidden');
        btnStart.classList.add('hidden');
      }
    };

    btnNext.addEventListener('click', function (e) {
      e.preventDefault();
      goToSlide(self._onboardingSlide + 1);
    });

    // Marcar onboarding completado en localStorage (no requiere auth)
    btnStart.addEventListener('click', function (e) {
      e.preventDefault();
      try {
        localStorage.setItem('vidasegura_onboardingDone', 'true');
      } catch (err) { console.warn(err); }
      self.navigate('register');
    });

    btnSkip.addEventListener('click', function (e) {
      e.preventDefault();
      try {
        localStorage.setItem('vidasegura_onboardingDone', 'true');
      } catch (err) { console.warn(err); }
      self.navigate('register');
    });

    // Click en dots para navegar directamente
    dots.forEach(function (dot) {
      dot.addEventListener('click', function () {
        var idx = parseInt(dot.dataset.dot, 10);
        if (!isNaN(idx)) goToSlide(idx);
      });
    });
  },

  /**
   * Maneja el evento de prompt de instalación PWA.
   */
  _handleInstallPrompt() {
    var self = this;

    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      self._deferredPrompt = e;
      // Mostrar botón de instalación en configuración
      var btnInstall = document.getElementById('btn-install-pwa');
      if (btnInstall) {
        btnInstall.style.display = 'flex';
      }
      console.log('[App] Prompt de instalación disponible.');
    });

    window.addEventListener('appinstalled', function () {
      self._deferredPrompt = null;
      var btnInstall = document.getElementById('btn-install-pwa');
      if (btnInstall) {
        btnInstall.style.display = 'none';
      }
      console.log('[App] PWA instalada exitosamente.');
    });
  },

  /**
   * Verifica el hash de la URL para datos de perfil público.
   * Soporta:  #p=BASE64  (v2, nuevo)  y  #profile=BASE64  (legacy)
   *
   * Nota: esta función debe funcionar para visitantes NO autenticados
   * (personas que escanean un código QR).
   */
  _checkURLHash() {
    var self = this;
    var hash = window.location.hash;
    if (!hash || hash.length < 4) return;

    var encoded = null;

    if (hash.startsWith('#p=')) {
      encoded = hash.substring(3);
    } else if (hash.startsWith('#profile=')) {
      encoded = hash.substring('#profile='.length);
    }

    if (!encoded) return;

    try {
      var jsonStr = decodeURIComponent(escape(atob(encoded)));
      var data = JSON.parse(jsonStr);
      if (data) {
        // Esperar a que los módulos estén listos
        setTimeout(function () {
          var QR = window.VidaSegura.QR;
          if (QR && typeof QR.displayPublicProfile === 'function') {
            QR.displayPublicProfile(data);
          } else {
            self.navigate('public-profile', data);
          }
        }, 500);
      }
    } catch (e) {
      console.warn('[App] Error al parsear datos de perfil público:', e);
    }
  },

  // ─── NAVEGACIÓN ────────────────────────────────────────────────────────────

  /**
   * Navega a una página de la aplicación.
   * @param {string} pageName - Nombre de la página (corresponde al ID sin prefijo 'page-').
   * @param {Object} params - Parámetros opcionales para la página.
   */
  navigate(pageName, params) {
    if (!params) params = {};
    try {
      // 1. Ocultar página actual
      var currentEl = document.getElementById('page-' + this.state.currentPage);
      if (currentEl) {
        currentEl.classList.remove('active');
      }

      // 2. Mostrar página destino
      var targetEl = document.getElementById('page-' + pageName);
      if (targetEl) {
        targetEl.classList.add('active');
      } else {
        console.warn('[App] Página no encontrada: page-' + pageName);
        return;
      }

      // 3. Actualizar estados de navegación activa
      var mainNavPages = this._mainNavPages;
      document.querySelectorAll('.nav-item').forEach(function (item) {
        item.classList.remove('active');
        if (item.dataset.page === pageName && mainNavPages.indexOf(pageName) !== -1) {
          item.classList.add('active');
        }
      });

      // 4. Guardar en historial
      this.state.history.push(this.state.currentPage);

      // 5. Actualizar página actual
      this.state.previousPage = this.state.currentPage;
      this.state.currentPage = pageName;

      // 6. Mostrar/ocultar barra de navegación
      if (this._noNavPages.indexOf(pageName) !== -1) {
        this._hideNav();
      } else {
        this._showNav();
      }

      // 7. Mostrar/ocultar botón SOS
      if (this._noSOSPages.indexOf(pageName) !== -1) {
        this._hideSOS();
      } else {
        this._showSOS();
      }

      // 8. Ejecutar lógica específica de página
      this._onPageEnter(pageName, params);

      // 9. Scroll al inicio
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      console.error('[App.navigate]', e);
    }
  },

  /**
   * Ejecuta lógica al entrar a una página específica.
   * @param {string} pageName
   * @param {Object} params
   */
  _onPageEnter(pageName, params) {
    var VS = window.VidaSegura;
    try {
      switch (pageName) {
        case 'dashboard':
          this.refreshDashboard();
          break;
        case 'map':
          if (VS.Map && typeof VS.Map.init === 'function') {
            VS.Map.init('map-container');
            if (VS.Map.showUserLocation) VS.Map.showUserLocation('map-container');
          }
          break;
        case 'alerts':
          if (VS.Alerts && typeof VS.Alerts.checkSeismicActivity === 'function') {
            VS.Alerts.checkSeismicActivity();
          }
          break;
        case 'stats':
          if (VS.Stats && typeof VS.Stats.renderStats === 'function') {
            VS.Stats.renderStats();
          }
          break;
        case 'profile':
          if (VS.Profile && typeof VS.Profile.loadProfile === 'function') {
            VS.Profile.loadProfile();
          }
          break;
        case 'qr-view':
          if (VS.QR && typeof VS.QR.generateQR === 'function') {
            VS.QR.generateQR();
          }
          break;
        case 'resources':
          if (VS.Resources && typeof VS.Resources.loadResources === 'function') {
            VS.Resources.loadResources();
          }
          break;
        case 'public-profile':
          if (VS.Profile && typeof VS.Profile.loadPublicProfile === 'function') {
            VS.Profile.loadPublicProfile(params);
          }
          break;
        default:
          break;
      }
    } catch (e) {
      console.warn('[App] Error en _onPageEnter(' + pageName + '):', e);
    }
  },

  /**
   * Navega a la página anterior o al dashboard.
   */
  goBack() {
    var previous = this.state.history.pop();
    if (previous) {
      // No agregamos al historial cuando volvemos atrás
      var currentEl = document.getElementById('page-' + this.state.currentPage);
      if (currentEl) currentEl.classList.remove('active');

      var targetEl = document.getElementById('page-' + previous);
      if (targetEl) targetEl.classList.add('active');

      // Actualizar nav
      var mainNavPages = this._mainNavPages;
      document.querySelectorAll('.nav-item').forEach(function (item) {
        item.classList.remove('active');
        if (item.dataset.page === previous && mainNavPages.indexOf(previous) !== -1) {
          item.classList.add('active');
        }
      });

      this.state.previousPage = this.state.currentPage;
      this.state.currentPage = previous;

      if (this._noNavPages.indexOf(previous) !== -1) {
        this._hideNav();
      } else {
        this._showNav();
      }

      if (this._noSOSPages.indexOf(previous) !== -1) {
        this._hideSOS();
      } else {
        this._showSOS();
      }

      this._onPageEnter(previous, {});
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      this.navigate('dashboard');
    }
  },

  // ─── UI HELPERS ────────────────────────────────────────────────────────────

  /**
   * Muestra un toast de notificación.
   * @param {string} message - Texto del mensaje.
   * @param {string} type - Tipo: 'info', 'success', 'warning', 'error'.
   */
  showToast(message, type) {
    if (!type) type = 'info';
    try {
      var container = document.getElementById('toast-container');
      if (!container) {
        console.warn('[App] No se encontró #toast-container');
        return;
      }

      var toast = document.createElement('div');
      toast.className = 'toast toast-' + type;

      // Icono según tipo
      var icons = {
        info: '💡',
        success: '✅',
        warning: '⚠️',
        error: '❌'
      };

      var Utils = window.VidaSegura.Utils;
      var safeMsg = (Utils && Utils.sanitizeHTML) ? Utils.sanitizeHTML(message) : message;

      toast.innerHTML =
        '<span class="toast-icon">' + (icons[type] || icons.info) + '</span>' +
        '<span class="toast-message">' + safeMsg + '</span>';

      container.appendChild(toast);

      // Animar entrada
      requestAnimationFrame(function () {
        toast.classList.add('show');
      });

      // Auto-remover después de 3 segundos
      setTimeout(function () {
        toast.classList.remove('show');
        toast.classList.add('hide');
        setTimeout(function () {
          if (toast.parentNode) {
            toast.parentNode.removeChild(toast);
          }
        }, 400);
      }, 3000);
    } catch (e) {
      console.error('[App.showToast]', e);
    }
  },

  /**
   * Muestra un modal con título, contenido y acciones.
   * @param {string} title - Título del modal.
   * @param {string} content - Contenido HTML del modal.
   * @param {Array} actions - Array de {text, class, onClick}.
   */
  showModal(title, content, actions) {
    if (!actions) actions = [];
    try {
      var self = this;
      var overlay  = document.getElementById('modal-overlay');
      var titleEl  = document.getElementById('modal-title');
      var bodyEl   = document.getElementById('modal-body');
      var actionsEl = document.getElementById('modal-actions');

      if (!overlay || !titleEl || !bodyEl || !actionsEl) {
        console.warn('[App] Elementos del modal no encontrados.');
        return;
      }

      titleEl.textContent = title;
      bodyEl.innerHTML = content;
      actionsEl.innerHTML = '';

      actions.forEach(function (action) {
        var btn = document.createElement('button');
        btn.textContent = action.text;
        btn.className = action.class || 'btn btn-secondary';
        btn.addEventListener('click', function () {
          if (typeof action.onClick === 'function') {
            action.onClick();
          }
          self.hideModal();
        });
        actionsEl.appendChild(btn);
      });

      overlay.classList.remove('hidden');
    } catch (e) {
      console.error('[App.showModal]', e);
    }
  },

  /**
   * Oculta el modal.
   */
  hideModal() {
    var overlay = document.getElementById('modal-overlay');
    if (overlay) {
      overlay.classList.add('hidden');
    }
  },

  /**
   * Muestra la pantalla de carga.
   * @param {string} msg - Mensaje opcional.
   */
  showLoading(msg) {
    var loading = document.getElementById('loading-screen');
    if (loading) {
      loading.classList.remove('hidden', 'fade-out');
      var msgEl = loading.querySelector('.loading-text');
      if (msgEl && msg) {
        msgEl.textContent = msg;
      }
    }
  },

  /**
   * Oculta la pantalla de carga con animación de fade-out.
   */
  hideLoading() {
    var loading = document.getElementById('loading-screen');
    if (loading) {
      loading.classList.add('fade-out');
      setTimeout(function () {
        loading.classList.add('hidden');
      }, 500);
    }
  },

  /**
   * Devuelve si la aplicación tiene conexión a internet.
   * @returns {boolean}
   */
  isOnline() {
    return navigator.onLine;
  },

  // ─── NAVEGACIÓN BAR / SOS ──────────────────────────────────────────────────

  _showNav() {
    var nav = document.getElementById('nav-bottom');
    if (nav) nav.classList.remove('hidden');
  },

  _hideNav() {
    var nav = document.getElementById('nav-bottom');
    if (nav) nav.classList.add('hidden');
  },

  _showSOS() {
    var sos = document.getElementById('btn-sos-float');
    if (sos) sos.classList.remove('hidden');
  },

  _hideSOS() {
    var sos = document.getElementById('btn-sos-float');
    if (sos) sos.classList.add('hidden');
  },

  // ─── DASHBOARD ─────────────────────────────────────────────────────────────

  /**
   * Actualiza los datos del dashboard.
   * Obtiene el perfil del usuario desde Firestore vía DB.getUser(),
   * o desde Auth.getCurrentUser() como caché rápida.
   */
  async refreshDashboard() {
    try {
      var VS = window.VidaSegura;
      var self = this;

      // Intentar obtener usuario: primero caché de Auth, luego Firestore
      var user = null;
      if (VS.Auth && VS.Auth.getCurrentUser) {
        user = VS.Auth.getCurrentUser();
      }
      if (!user && VS.DB && VS.DB.getUser) {
        user = await VS.DB.getUser();
      }

      // Actualizar saludo con nombre del usuario
      var greetingEl = document.getElementById('dashboard-greeting');
      if (greetingEl && user) {
        var hour = new Date().getHours();
        var greeting = 'Buenos días';
        if (hour >= 12 && hour < 18) greeting = 'Buenas tardes';
        else if (hour >= 18) greeting = 'Buenas noches';
        var firstName = user.name ? user.name.split(' ')[0] : '';
        greetingEl.textContent = greeting + ', ' + firstName;
      }

      // Actualizar nombre del usuario
      var nameEl = document.getElementById('dashboard-user-name');
      if (nameEl && user) {
        nameEl.textContent = user.name || '';
      }

      // Solicitar permiso de notificaciones y arrancar listeners de fondo
      if (VS.Notifications && typeof VS.Notifications.requestPermission === 'function') {
        VS.Notifications.requestPermission();
        if (typeof VS.Notifications.startBackgroundListeners === 'function') {
          var firebaseAuth = window.firebase ? window.firebase.auth() : null;
          if (firebaseAuth && firebaseAuth.currentUser) {
            VS.Notifications.startBackgroundListeners(firebaseAuth.currentUser.uid);
          }
        }
      }

      // Actualizar puntuación de seguridad
      if (VS.Stats && typeof VS.Stats.calculateScore === 'function') {
        try {
          var score = await VS.Stats.calculateScore();
          var scoreEl = document.getElementById('dashboard-score');
          if (scoreEl) scoreEl.textContent = score || '0';

          // Actualizar anillo de progreso
          var ring = document.getElementById('progress-ring-circle');
          if (ring) {
            var circumference = 2 * Math.PI * (ring.getAttribute('r') || 54);
            var offset = circumference - ((score || 0) / 100) * circumference;
            ring.style.strokeDasharray = circumference;
            ring.style.strokeDashoffset = offset;
          }
        } catch (_) {}
      }

      // Actualizar lista de familia
      if (VS.Family && typeof VS.Family.refreshList === 'function') {
        try { await VS.Family.refreshList(); } catch (_) {}
      }

      // Actualizar alertas recientes desde Firestore
      try {
        if (VS.DB && VS.DB.getAlerts) {
          var alerts = await VS.DB.getAlerts();
          var alertsContainer = document.getElementById('dashboard-alerts');
          if (alertsContainer && alerts.length > 0) {
            var Utils = VS.Utils;
            var recentAlerts = alerts.slice(0, 3);
            alertsContainer.innerHTML = recentAlerts.map(function (alert) {
              var safeMsg = (Utils && Utils.sanitizeHTML)
                ? Utils.sanitizeHTML(alert.message || '')
                : (alert.message || '');
              var timeAgo = (Utils && Utils.timeAgo)
                ? Utils.timeAgo(alert.timestamp)
                : '';
              return (
                '<div class="alert-item alert-' + (alert.type || 'info') + '">' +
                  '<span class="alert-icon">' + self._getAlertIcon(alert.type) + '</span>' +
                  '<div class="alert-content">' +
                    '<p class="alert-text">' + safeMsg + '</p>' +
                    '<span class="alert-time">' + timeAgo + '</span>' +
                  '</div>' +
                '</div>'
              );
            }).join('');
          }
        }
      } catch (_) {}

      // Inicializar mini mapa del dashboard
      if (VS.Map && typeof VS.Map.initDashboardPreview === 'function') {
        try { VS.Map.initDashboardPreview(); } catch (_) {}
      }

    } catch (e) {
      console.error('[App.refreshDashboard]', e);
    }
  },

  /**
   * Devuelve un ícono de alerta según el tipo.
   * @param {string} type
   * @returns {string}
   */
  _getAlertIcon(type) {
    var icons = {
      emergency: '🚨',
      seismic: '🌋',
      weather: '🌧️',
      security: '🔒',
      info: '📢',
      sos: '🆘'
    };
    return icons[type] || icons.info;
  }
};

// ─── INICIALIZACIÓN ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {
  window.VidaSegura.App.init();
});
