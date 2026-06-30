/**
 * VidaSegura — Módulo de Autenticación (Firebase Auth)
 * Registro y login con Firebase Authentication (email/password).
 * Perfil de usuario guardado en Firestore via DB.saveUser().
 * Foto de selfie subida a Firebase Storage: profilePhotos/{uid}.jpg
 *
 * Usa los globales definidos en firebase-config.js:
 *   firebaseAuth, firestore, firebaseStorage
 */
window.VidaSegura = window.VidaSegura || {};
window.VidaSegura.Auth = (function () {
  'use strict';

  var _currentUser = null;

  function $(id) { return document.getElementById(id); }

  // ── Public API ──────────────────────────────────────────────────────────────

  function init() {
    try {
      // Formulario de registro
      var formRegister = $('form-register');
      if (formRegister) {
        formRegister.addEventListener('submit', function (e) {
          e.preventDefault();
          handleRegister();
        });
      }

      // Formulario de login
      var formLogin = $('form-login');
      if (formLogin) {
        formLogin.addEventListener('submit', function (e) {
          e.preventDefault();
          handleLogin();
        });
      }

      // Links de navegación
      var linkToLogin = $('link-to-login');
      if (linkToLogin) {
        linkToLogin.addEventListener('click', function (e) {
          e.preventDefault();
          window.VidaSegura.App.navigate('login');
        });
      }

      var linkToRegister = $('link-to-register');
      if (linkToRegister) {
        linkToRegister.addEventListener('click', function (e) {
          e.preventDefault();
          window.VidaSegura.App.navigate('register');
        });
      }

      // Botón de logout
      var btnLogout = $('btn-logout');
      if (btnLogout) {
        btnLogout.addEventListener('click', function () {
          logout();
        });
      }

      // Botón de eliminar cuenta
      var btnDeleteAccount = $('btn-delete-account');
      if (btnDeleteAccount) {
        btnDeleteAccount.addEventListener('click', function () {
          deleteAccount();
        });
      }

      // Cámara selfie
      _setupSelfieCamera();

      // Restaurar sesión con Firebase Auth
      _loadCachedUser();

      console.log('[Auth] Módulo inicializado (Firebase Auth)');
    } catch (err) {
      console.error('[Auth] Error en init:', err);
    }
  }

  // ── Selfie Camera ──────────────────────────────────────────────────────────
  // Toda la lógica de cámara/galería se mantiene idéntica.

  var _cameraStream = null;

  function _setupSelfieCamera() {
    var cameraInput  = $('selfie-camera-input');
    var galleryInput = $('selfie-gallery-input');

    if (cameraInput) {
      cameraInput.addEventListener('change', function (e) {
        _handlePhotoFile(e.target.files[0]);
      });
    }
    if (galleryInput) {
      galleryInput.addEventListener('change', function (e) {
        _handlePhotoFile(e.target.files[0]);
      });
    }
  }

  function _handlePhotoFile(file) {
    if (!file) return;

    var reader = new FileReader();
    reader.onload = function (e) {
      var img = new Image();
      img.onload = function () {
        // Recortar a cuadrado y comprimir
        var canvas = document.createElement('canvas');
        var size = Math.min(img.width, img.height);
        canvas.width = 480;
        canvas.height = 480;
        var ctx = canvas.getContext('2d');
        var sx = (img.width - size) / 2;
        var sy = (img.height - size) / 2;
        ctx.drawImage(img, sx, sy, size, size, 0, 0, 480, 480);

        var dataURL = canvas.toDataURL('image/jpeg', 0.8);

        // Mostrar resultado
        var resultImg   = $('selfie-result');
        var placeholder = $('selfie-placeholder');
        var wrapper     = $('selfie-preview-wrapper');
        var hiddenInput = $('register-photo');
        var errorEl     = $('selfie-error');

        if (resultImg) {
          resultImg.src = dataURL;
          resultImg.style.display = 'block';
          resultImg.style.transform = 'none';
        }
        if (placeholder) placeholder.style.display = 'none';
        if (wrapper)     { wrapper.classList.remove('active'); wrapper.classList.add('captured'); }
        if (hiddenInput) hiddenInput.value = dataURL;
        if (errorEl)     errorEl.style.display = 'none';

        var App = window.VidaSegura.App;
        if (App) App.showToast('¡Foto cargada correctamente!', 'success');
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function _stopCamera() {
    if (_cameraStream) {
      _cameraStream.getTracks().forEach(function (track) { track.stop(); });
      _cameraStream = null;
    }
  }

  // ── Restaurar sesión con Firebase Auth ──────────────────────────────────────

  /**
   * Usa onAuthStateChanged para detectar si ya hay un usuario autenticado.
   * Si lo hay, carga su perfil desde Firestore.
   */
  function _loadCachedUser() {
    firebaseAuth.onAuthStateChanged(function (firebaseUser) {
      if (firebaseUser) {
        // Usuario autenticado — cargar perfil desde Firestore
        var DB = window.VidaSegura.DB;
        DB.getUser().then(function (profile) {
          if (profile) {
            _currentUser = profile;
            console.log('[Auth] Sesión restaurada para:', profile.name || profile.email);
          }
        }).catch(function (err) {
          console.warn('[Auth] No se pudo cargar perfil del usuario autenticado:', err);
        });
      } else {
        // Sin sesión
        _currentUser = null;
      }
    });
  }

  // ── Foto de selfie ──────────────────────────────────────────────────────────

  /**
   * Procesa la foto de selfie.
   * Firebase Storage no está habilitado (plan Spark), así que devuelve
   * la dataURL directamente para guardarla en Firestore.
   * @param {string} uid - UID del usuario.
   * @param {string} dataURL - Imagen en formato data:image/jpeg;base64,...
   * @returns {Promise<string>} La dataURL o cadena vacía.
   */
  async function _uploadSelfie(uid, dataURL) {
    // Sin Firebase Storage, devolver la dataURL tal cual
    if (!dataURL || !dataURL.startsWith('data:')) {
      return '';
    }
    return dataURL;
  }

  // ── Registro ───────────────────────────────────────────────────────────────

  async function handleRegister() {
    var App = window.VidaSegura.App;
    var DB  = window.VidaSegura.DB;

    try {
      // Recopilar valores del formulario
      var photo     = ($('register-photo')      || {}).value || '';
      var name      = ($('register-name')       || {}).value || '';
      var cedula    = ($('register-cedula')      || {}).value || '';
      var email     = ($('register-email')       || {}).value || '';
      var password  = ($('register-password')    || {}).value || '';
      var phone     = ($('register-phone')       || {}).value || '';
      var birthDay   = ($('register-birth-day')   || {}).value || '';
      var birthMonth = ($('register-birth-month') || {}).value || '';
      var birthYear  = ($('register-birth-year')  || {}).value || '';
      var birthdate  = (birthYear && birthMonth && birthDay)
        ? birthYear + '-' + birthMonth + '-' + birthDay
        : '';
      var bloodType = ($('register-blood-type')  || {}).value || '';
      var state     = ($('register-state')       || {}).value || '';
      var city      = ($('register-city')        || {}).value || '';
      var emergName = ($('register-emergency-name')  || {}).value || '';
      var emergPhone= ($('register-emergency-phone') || {}).value || '';
      var allergiesRaw = ($('register-allergies') || {}).value || '';

      // ── Validación: selfie obligatoria ──
      if (!photo) {
        App.showToast('Debes tomarte una selfie para registrarte', 'error');
        var errorEl = $('selfie-error');
        if (errorEl) errorEl.style.display = 'block';
        var selfieSection = $('selfie-section');
        if (selfieSection) selfieSection.scrollIntoView({ behavior: 'smooth' });
        return;
      }

      // ── Validación: GPS obligatorio ──
      if (navigator.geolocation) {
        try {
          await new Promise(function (resolve, reject) {
            navigator.geolocation.getCurrentPosition(
              function (pos) { resolve(pos); },
              function (err) { reject(err); },
              { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
            );
          });
        } catch (gpsErr) {
          App.showToast(
            'Debes permitir el acceso a tu ubicación para registrarte. Es esencial para que te encuentren en emergencias.',
            'error'
          );
          return;
        }
      } else {
        App.showToast(
          'Tu dispositivo no soporta GPS. Necesitas un dispositivo con GPS para usar VidaSegura.',
          'error'
        );
        return;
      }

      // ── Validaciones de campos ──
      if (!name.trim())     { App.showToast('Ingresa tu nombre completo', 'error'); return; }
      if (!cedula.trim())   { App.showToast('Ingresa tu cédula', 'error'); return; }
      if (!email.trim())    { App.showToast('Ingresa tu correo electrónico', 'error'); return; }
      if (!password)        { App.showToast('Ingresa una contraseña', 'error'); return; }
      if (password.length < 6) { App.showToast('La contraseña debe tener al menos 6 caracteres', 'error'); return; }
      if (!phone.trim())    { App.showToast('Ingresa tu teléfono', 'error'); return; }
      if (!bloodType)       { App.showToast('Selecciona tu tipo de sangre', 'error'); return; }
      if (!state)           { App.showToast('Selecciona tu estado', 'error'); return; }
      if (!emergName.trim()){ App.showToast('Ingresa un contacto de emergencia', 'error'); return; }

      // Parsear alergias
      var allergies = allergiesRaw
        ? allergiesRaw.split(',').map(function (a) { return a.trim(); }).filter(Boolean)
        : [];

      // Detener cámara si sigue activa
      _stopCamera();

      // Deshabilitar botón
      var btn = $('btn-register-submit');
      if (btn) { btn.disabled = true; btn.textContent = 'Registrando...'; }

      // ── 1. Crear usuario en Firebase Auth ──
      var emailClean = email.trim().toLowerCase();
      var credential;
      try {
        credential = await firebaseAuth.createUserWithEmailAndPassword(emailClean, password);
      } catch (authErr) {
        // Mapear errores comunes de Firebase Auth a mensajes en español
        var errorMsg = _mapAuthError(authErr);
        App.showToast(errorMsg, 'error');
        if (btn) { btn.disabled = false; btn.textContent = 'Crear Mi Cuenta'; }
        return;
      }

      var uid = credential.user.uid;

      // ── 2. Subir selfie a Firebase Storage ──
      var photoURL = await _uploadSelfie(uid, photo);

      // ── 3. Guardar perfil en Firestore via DB.saveUser() ──
      var userData = {
        id: uid,
        name: name.trim(),
        cedula: cedula.trim(),
        email: emailClean,
        phone: phone.trim(),
        birthdate: birthdate,
        bloodType: bloodType,
        allergies: allergies,
        medications: [],
        conditions: [],
        state: state,
        city: city.trim(),
        emergencyName1: emergName.trim(),
        emergencyPhone1: emergPhone.trim(),
        photo: photoURL,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      _currentUser = userData;
      await DB.saveUser(userData);
      await DB.saveSetting('onboardingDone', true);

      // ── 4. Actualizar displayName en Firebase Auth ──
      try {
        await credential.user.updateProfile({
          displayName: userData.name,
          photoURL: photoURL.length < 1000 ? photoURL : null // Solo si es URL, no dataURL
        });
      } catch (_) {
        // No es crítico si falla
      }

      // Rehabilitar botón
      if (btn) { btn.disabled = false; btn.textContent = 'Crear Mi Cuenta'; }

      App.showToast('¡Cuenta creada exitosamente! Bienvenido a VidaSegura', 'success');
      App.navigate('dashboard');
      App._showNav();
      App._showSOS();

    } catch (err) {
      console.error('[Auth] Error en registro:', err);
      var App2 = window.VidaSegura.App;
      if (App2) App2.showToast(err.message || 'Error al crear la cuenta', 'error');
      var btn2 = $('btn-register-submit');
      if (btn2) { btn2.disabled = false; btn2.textContent = 'Crear Mi Cuenta'; }
    }
  }

  // ── Login ──────────────────────────────────────────────────────────────────

  async function handleLogin() {
    var App = window.VidaSegura.App;
    var DB  = window.VidaSegura.DB;

    try {
      var email    = ($('login-email')    || {}).value || '';
      var password = ($('login-password') || {}).value || '';

      if (!email.trim())  { App.showToast('Ingresa tu correo electrónico', 'error'); return; }
      if (!password)       { App.showToast('Ingresa tu contraseña', 'error'); return; }

      // Deshabilitar botón
      var btn = $('btn-login-submit');
      if (btn) { btn.disabled = true; btn.textContent = 'Iniciando sesión...'; }

      // ── 1. Autenticar con Firebase Auth ──
      var credential;
      try {
        credential = await firebaseAuth.signInWithEmailAndPassword(
          email.trim().toLowerCase(),
          password
        );
      } catch (authErr) {
        var errorMsg = _mapAuthError(authErr);
        App.showToast(errorMsg, 'error');
        if (btn) { btn.disabled = false; btn.textContent = 'Iniciar Sesión'; }
        return;
      }

      // ── 2. Cargar perfil desde Firestore ──
      var profile = await DB.getUser();
      if (profile) {
        _currentUser = profile;
      } else {
        // Si por alguna razón no existe el documento, crear uno mínimo
        _currentUser = {
          id: credential.user.uid,
          name: credential.user.displayName || '',
          email: credential.user.email,
          photo: credential.user.photoURL || '',
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        await DB.saveUser(_currentUser);
      }

      if (btn) { btn.disabled = false; btn.textContent = 'Iniciar Sesión'; }

      App.showToast('¡Bienvenido de vuelta, ' + (_currentUser.name || _currentUser.email) + '!', 'success');
      App.navigate('dashboard');
      App._showNav();
      App._showSOS();

    } catch (err) {
      console.error('[Auth] Error en login:', err);
      var App2 = window.VidaSegura.App;
      if (App2) App2.showToast(err.message || 'Error al iniciar sesión', 'error');
      var btn2 = $('btn-login-submit');
      if (btn2) { btn2.disabled = false; btn2.textContent = 'Iniciar Sesión'; }
    }
  }

  // ── Logout ─────────────────────────────────────────────────────────────────

  function logout() {
    var App = window.VidaSegura.App;
    App.showModal('Cerrar Sesión', '<p>¿Estás seguro de que quieres cerrar sesión?</p>', [
      {
        text: 'Cancelar',
        class: 'btn btn-ghost',
        onClick: function () { App.hideModal(); }
      },
      {
        text: 'Cerrar Sesión',
        class: 'btn btn-secondary',
        onClick: async function () {
          App.hideModal();
          _currentUser = null;
          try {
            var DB = window.VidaSegura.DB;
            await DB.clearAll(); // Cierra sesión en Firebase Auth y limpia datos locales
          } catch (_) {}
          App._hideNav();
          App._hideSOS();
          App.navigate('login');
          App.showToast('Sesión cerrada', 'info');
        }
      }
    ]);
  }

  function deleteAccount() {
    var App = window.VidaSegura.App;
    App.showModal('⚠️ Eliminar Cuenta', '<p style="color:var(--danger)">¿Estás absolutamente seguro de que deseas eliminar tu cuenta de VidaSegura?</p><p>Esta acción borrará permanentemente todos tus datos de perfil, historial de ubicaciones y alertas. No se puede deshacer.</p>', [
      {
        text: 'Cancelar',
        class: 'btn btn-secondary',
        onClick: function () { App.hideModal(); }
      },
      {
        text: 'Eliminar Definitivamente',
        class: 'btn btn-danger',
        onClick: async function () {
          App.hideModal();
          App.showLoading('Eliminando cuenta...');
          try {
            var user = firebaseAuth.currentUser;
            if (user) {
              var uid = user.uid;
              // Borrar datos de Firestore
              await firestore.collection('users').doc(uid).delete();
              // Borrar datos de Realtime Database
              await realtimeDb.ref('users/' + uid).remove();
              // Borrar cuenta de Auth
              await user.delete();
            }
            App.hideLoading();
            _currentUser = null;
            App._hideNav();
            App._hideSOS();
            App.navigate('login');
            App.showToast('Tu cuenta ha sido eliminada correctamente', 'success');
          } catch (error) {
            App.hideLoading();
            console.error('Error al eliminar cuenta:', error);
            if (error.code === 'auth/requires-recent-login') {
              App.showToast('Por seguridad, debes cerrar sesión y volver a entrar antes de eliminar tu cuenta.', 'error');
            } else {
              App.showToast('No se pudo eliminar la cuenta. Intenta de nuevo más tarde.', 'error');
            }
          }
        }
      }
    ]);
  }

  // ── Utilidades ─────────────────────────────────────────────────────────────

  /**
   * Mapea códigos de error de Firebase Auth a mensajes amigables en español.
   * @param {Error} authError
   * @returns {string}
   */
  function _mapAuthError(authError) {
    var code = authError.code || '';
    switch (code) {
      case 'auth/email-already-in-use':
        return 'Ya existe una cuenta con este correo electrónico.';
      case 'auth/invalid-email':
        return 'El correo electrónico no es válido.';
      case 'auth/operation-not-allowed':
        return 'El registro con correo/contraseña no está habilitado.';
      case 'auth/weak-password':
        return 'La contraseña es demasiado débil. Usa al menos 6 caracteres.';
      case 'auth/user-disabled':
        return 'Esta cuenta ha sido deshabilitada. Contacta soporte.';
      case 'auth/user-not-found':
        return 'No existe una cuenta con este correo electrónico.';
      case 'auth/wrong-password':
        return 'Contraseña incorrecta. Inténtalo de nuevo.';
      case 'auth/too-many-requests':
        return 'Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo.';
      case 'auth/network-request-failed':
        return 'Error de conexión. Verifica tu internet e inténtalo de nuevo.';
      case 'auth/invalid-credential':
        return 'Credenciales inválidas. Verifica tu correo y contraseña.';
      default:
        return authError.message || 'Error de autenticación. Inténtalo de nuevo.';
    }
  }

  function isLoggedIn() {
    return !!_currentUser;
  }

  function getCurrentUser() {
    return _currentUser;
  }

  // ── API pública ────────────────────────────────────────────────────────────

  return {
    init:           init,
    isLoggedIn:     isLoggedIn,
    getCurrentUser: getCurrentUser,
    logout:         logout
  };
})();
