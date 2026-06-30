/**
 * VidaSegura — Módulo de Perfil (Firebase)
 * Gestiona datos de perfil del usuario: información personal, foto, tags
 * médicos, contactos de emergencia, seguro y preferencias de donación.
 *
 * Cambios clave respecto a la versión IndexedDB:
 *   - loadProfile()  → lee desde Firestore: users/{uid}
 *   - saveProfile()  → escribe en Firestore: users/{uid}
 *   - uploadPhoto()  → sube a Firebase Storage: profilePhotos/{uid}.jpg
 *                       y almacena la URL de descarga en Firestore
 *
 * Globals requeridos: firebaseAuth, firestore, firebaseStorage  (de firebase-config.js)
 */
window.VidaSegura = window.VidaSegura || {};
window.VidaSegura.Profile = (function () {
  'use strict';

  // ──────────────────────────────────────────────
  // Helpers privados
  // ──────────────────────────────────────────────

  var TAG_CONTAINERS = {
    allergy:    'profile-allergies-tags',
    medication: 'profile-medications-tags',
    condition:  'profile-conditions-tags',
  };

  var TAG_INPUTS = {
    allergy:    'profile-allergy-input',
    medication: 'profile-medication-input',
    condition:  'profile-condition-input',
  };

  /**
   * Consulta segura de un elemento por id; retorna null y registra en consola si falta.
   */
  function $(id) {
    var el = document.getElementById(id);
    if (!el) console.warn('[Profile] Elemento no encontrado: #' + id);
    return el;
  }

  /**
   * Recopila los valores de tags actualmente renderizados en un contenedor.
   */
  function collectTagValues(type) {
    var container = $(TAG_CONTAINERS[type]);
    if (!container) return [];
    return Array.from(container.querySelectorAll('.tag')).map(function (tag) {
      // El texto menos el botón × de eliminar
      var clone = tag.cloneNode(true);
      var removeBtn = clone.querySelector('.tag-remove');
      if (removeBtn) removeBtn.remove();
      return clone.textContent.trim();
    });
  }

  /**
   * Renderiza un array de strings como tags en el contenedor correspondiente.
   */
  function renderTags(type, values) {
    var container = $(TAG_CONTAINERS[type]);
    if (!container) return;
    container.innerHTML = '';
    if (!Array.isArray(values)) return;
    values.forEach(function (v) {
      if (v) addTag(type, v);
    });
  }

  /**
   * Obtiene el UID del usuario autenticado, o null.
   */
  function _getUid() {
    var user = firebaseAuth.currentUser;
    return user ? user.uid : null;
  }

  // ──────────────────────────────────────────────
  // API pública
  // ──────────────────────────────────────────────

  /**
   * Inicializa event listeners del módulo.
   */
  function init() {
    try {
      // Formulario submit
      var form = $('form-profile');
      if (form) {
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          saveProfile();
        });
      }

      // Selección de foto
      var photoInput = $('profile-photo-input');
      if (photoInput) {
        photoInput.addEventListener('change', function (e) {
          var file = e.target.files && e.target.files[0];
          if (file) uploadPhoto(file);
        });
      }

      // Botones de agregar tag
      document.querySelectorAll('.tag-add-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var type = btn.dataset.type;
          var input = $(TAG_INPUTS[type]);
          if (!input) return;
          var value = input.value.trim();
          if (value) {
            addTag(type, value);
            input.value = '';
          }
        });
      });

      // Enter en inputs de tags
      Object.keys(TAG_INPUTS).forEach(function (type) {
        var input = $(TAG_INPUTS[type]);
        if (!input) return;
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') {
            e.preventDefault();
            var value = input.value.trim();
            if (value) {
              addTag(type, value);
              input.value = '';
            }
          }
        });
      });

      console.log('[Profile] Módulo inicializado (Firebase)');
    } catch (err) {
      console.error('[Profile] Error durante init:', err);
    }
  }

  /**
   * Carga el perfil del usuario actual desde Firestore y puebla el formulario.
   * Lee de: Firestore → users/{uid}
   */
  async function loadProfile() {
    try {
      var uid = _getUid();
      if (!uid) {
        console.warn('[Profile] No hay usuario autenticado. No se puede cargar perfil.');
        return;
      }

      // Leer documento del usuario desde Firestore
      var doc = await firestore.collection('users').doc(uid).get();
      if (!doc.exists) {
        console.warn('[Profile] No se encontró documento de usuario en Firestore.');
        return;
      }

      var user = doc.data();
      user.id = uid;

      // ── Campos básicos ──
      var fields = {
        'profile-name':       user.name       || '',
        'profile-cedula':     user.cedula     || '',
        'profile-email':      user.email      || '',
        'profile-phone':      user.phone      || '',
        'profile-blood-type': user.bloodType  || '',
      };

      Object.keys(fields).forEach(function (id) {
        var el = $(id);
        if (el) el.value = fields[id];
      });

      // ── Fecha de nacimiento (selects) ──
      if (user.birthdate) {
        var parts = user.birthdate.split('-');
        if (parts.length === 3) {
          if ($('profile-birth-year'))  $('profile-birth-year').value  = parts[0];
          if ($('profile-birth-month')) $('profile-birth-month').value = parts[1];
          if ($('profile-birth-day'))   $('profile-birth-day').value   = parts[2];
        }
      }

      // ── Foto de perfil ──
      var photoEl     = $('profile-photo');
      var placeholder = $('profile-photo-placeholder');
      if (user.photo) {
        if (photoEl) {
          photoEl.src = user.photo;
          photoEl.style.display = 'block';
        }
        if (placeholder) placeholder.style.display = 'none';
      } else {
        if (photoEl) photoEl.style.display = 'none';
        if (placeholder) placeholder.style.display = '';
      }

      // ── Tags médicos ──
      renderTags('allergy',    user.allergies);
      renderTags('medication', user.medications);
      renderTags('condition',  user.conditions);

      // ── Contactos de emergencia ──
      if (user.emergencyContacts && Array.isArray(user.emergencyContacts)) {
        var contactsContainer = $('profile-emergency-contacts');
        if (contactsContainer) {
          contactsContainer.innerHTML = '';
          user.emergencyContacts.forEach(function (contact, idx) {
            contactsContainer.innerHTML += buildContactHTML(contact, idx);
          });
        }
      }

      // ── Seguro médico ──
      var insuranceEl = $('profile-insurance');
      if (insuranceEl) insuranceEl.value = user.insurance || '';

      // ── Toggle donante de órganos ──
      var donorEl = $('profile-organ-donor');
      if (donorEl) donorEl.checked = !!user.organDonor;

      // ── Notas médicas ──
      var notesEl = $('profile-medical-notes');
      if (notesEl) notesEl.value = user.medicalNotes || '';

      console.log('[Profile] Perfil cargado desde Firestore');
    } catch (err) {
      console.error('[Profile] Error cargando perfil:', err);
      if (window.VidaSegura.App && window.VidaSegura.App.showToast) {
        window.VidaSegura.App.showToast('Error al cargar el perfil', 'error');
      }
    }
  }

  /**
   * Guarda los datos del formulario de perfil en Firestore.
   * Escribe en: Firestore → users/{uid}  (merge: true)
   */
  async function saveProfile() {
    try {
      var App = window.VidaSegura.App;
      var uid = _getUid();

      if (!uid) {
        if (App && App.showToast) {
          App.showToast('No hay sesión activa. Inicia sesión para guardar.', 'error');
        }
        return;
      }

      var userData = {
        name:        ($('profile-name')       || {}).value || '',
        cedula:      ($('profile-cedula')     || {}).value || '',
        email:       ($('profile-email')      || {}).value || '',
        phone:       ($('profile-phone')      || {}).value || '',
        bloodType:   ($('profile-blood-type') || {}).value || '',
        allergies:    collectTagValues('allergy'),
        medications:  collectTagValues('medication'),
        conditions:   collectTagValues('condition'),
        insurance:    ($('profile-insurance')     || {}).value || '',
        organDonor:   ($('profile-organ-donor')   || {}).checked || false,
        medicalNotes: ($('profile-medical-notes') || {}).value || '',
        updatedAt:    Date.now()
      };

      // Construir fecha de nacimiento
      var y = ($('profile-birth-year')  || {}).value || '';
      var m = ($('profile-birth-month') || {}).value || '';
      var d = ($('profile-birth-day')   || {}).value || '';
      if (y && m && d) {
        userData.birthdate = y + '-' + m + '-' + d;
      } else {
        userData.birthdate = '';
      }

      // Recopilar contactos de emergencia del DOM
      var contactEls = document.querySelectorAll('.emergency-contact-item');
      var contacts = [];
      contactEls.forEach(function (el) {
        var nameEl  = el.querySelector('.contact-name');
        var phoneEl = el.querySelector('.contact-phone');
        var relEl   = el.querySelector('.contact-relation');
        if (nameEl && phoneEl) {
          contacts.push({
            name:     nameEl.value  || '',
            phone:    phoneEl.value || '',
            relation: relEl ? relEl.value : '',
          });
        }
      });
      userData.emergencyContacts = contacts;

      // Conservar foto existente (URL de Storage o dataURL)
      var photoEl = $('profile-photo');
      if (photoEl && photoEl.src && !photoEl.src.endsWith('#')) {
        userData.photo = photoEl.src;
      }

      // Escribir en Firestore con merge para no borrar campos no enviados
      await firestore.collection('users').doc(uid).set(userData, { merge: true });

      if (App && App.showToast) {
        App.showToast('Perfil actualizado correctamente', 'success');
      }
      console.log('[Profile] Perfil guardado en Firestore');
    } catch (err) {
      console.error('[Profile] Error guardando perfil:', err);
      if (window.VidaSegura.App && window.VidaSegura.App.showToast) {
        window.VidaSegura.App.showToast('Error al guardar el perfil', 'error');
      }
    }
  }

  /**
   * Agrega un tag al contenedor del tipo dado.
   * @param {string} type  - 'allergy' | 'medication' | 'condition'
   * @param {string} value - Texto del tag
   */
  function addTag(type, value) {
    try {
      if (!value || !value.trim()) return;
      value = value.trim();

      var container = $(TAG_CONTAINERS[type]);
      if (!container) return;

      // Evitar duplicados
      var existing = collectTagValues(type);
      if (existing.indexOf(value) !== -1) return;

      var span = document.createElement('span');
      span.className = 'tag';
      span.textContent = value;

      var removeBtn = document.createElement('span');
      removeBtn.className = 'tag-remove';
      removeBtn.dataset.type = type;
      removeBtn.dataset.value = value;
      removeBtn.textContent = '×';
      removeBtn.setAttribute('role', 'button');
      removeBtn.setAttribute('aria-label', 'Eliminar ' + value);

      removeBtn.addEventListener('click', function () {
        removeTag(type, value);
      });

      span.appendChild(removeBtn);
      container.appendChild(span);
    } catch (err) {
      console.error('[Profile] Error agregando tag:', err);
    }
  }

  /**
   * Elimina un tag del contenedor del tipo dado.
   */
  function removeTag(type, value) {
    try {
      var container = $(TAG_CONTAINERS[type]);
      if (!container) return;

      var tags = container.querySelectorAll('.tag');
      tags.forEach(function (tag) {
        var removeBtn = tag.querySelector('.tag-remove');
        if (removeBtn && removeBtn.dataset.value === value) {
          tag.remove();
        }
      });
    } catch (err) {
      console.error('[Profile] Error eliminando tag:', err);
    }
  }

  /**
   * Sube una foto de perfil a Firebase Storage y actualiza la UI + Firestore.
   * Destino en Storage: profilePhotos/{uid}.jpg
   *
   * Flujo:
   *   1. Validar que sea imagen
   *   2. Leer como dataURL para preview inmediato
   *   3. Subir a Firebase Storage
   *   4. Obtener downloadURL y escribirla en Firestore users/{uid}.photo
   *
   * Si Storage falla, se guarda la dataURL directamente como fallback.
   */
  function uploadPhoto(file) {
    try {
      if (!file || !file.type.startsWith('image/')) {
        if (window.VidaSegura.App) {
          window.VidaSegura.App.showToast('Por favor selecciona una imagen válida', 'warning');
        }
        return;
      }

      var uid = _getUid();
      if (!uid) {
        if (window.VidaSegura.App) {
          window.VidaSegura.App.showToast('Inicia sesión para cambiar tu foto', 'error');
        }
        return;
      }

      var reader = new FileReader();
      reader.onload = function (e) {
        try {
          var dataURL     = e.target.result;
          var photoEl     = $('profile-photo');
          var placeholder = $('profile-photo-placeholder');

          // Preview inmediato con la dataURL
          if (photoEl) {
            photoEl.src = dataURL;
            photoEl.style.display = 'block';
          }
          if (placeholder) {
            placeholder.style.display = 'none';
          }

          // Subir a Firebase Storage
          _uploadToStorage(uid, dataURL).then(function (downloadURL) {
            // Actualizar Firestore con la URL de descarga
            firestore.collection('users').doc(uid).update({
              photo:     downloadURL,
              updatedAt: Date.now()
            }).then(function () {
              // Actualizar el src con la URL definitiva de Storage
              if (photoEl) photoEl.src = downloadURL;
              console.log('[Profile] Foto subida a Storage y guardada en Firestore');
            }).catch(function (err) {
              console.warn('[Profile] Error actualizando foto en Firestore:', err);
            });
          }).catch(function (storageErr) {
            // Fallback: guardar dataURL directamente en Firestore
            console.warn('[Profile] Fallback: guardando dataURL en Firestore:', storageErr);
            firestore.collection('users').doc(uid).update({
              photo:     dataURL,
              updatedAt: Date.now()
            }).catch(function () {});
          });

          if (window.VidaSegura.App) {
            window.VidaSegura.App.showToast('Foto actualizada', 'success');
          }
        } catch (innerErr) {
          console.error('[Profile] Error procesando foto:', innerErr);
        }
      };

      reader.onerror = function () {
        console.error('[Profile] Error leyendo archivo de foto');
        if (window.VidaSegura.App) {
          window.VidaSegura.App.showToast('Error al leer la imagen', 'error');
        }
      };

      reader.readAsDataURL(file);
    } catch (err) {
      console.error('[Profile] Error subiendo foto:', err);
    }
  }

  /**
   * Sube una dataURL a Firebase Storage como profilePhotos/{uid}.jpg.
   * @param {string} uid     - UID del usuario
   * @param {string} dataURL - Imagen como data:image/…;base64,…
   * @returns {Promise<string>} URL pública de descarga
   * @private
   */
  async function _uploadToStorage(uid, dataURL) {
    var ref = firebaseStorage.ref('profilePhotos/' + uid + '.jpg');

    // Convertir dataURL a Blob
    var response = await fetch(dataURL);
    var blob     = await response.blob();

    var snapshot    = await ref.put(blob, { contentType: 'image/jpeg' });
    var downloadURL = await snapshot.ref.getDownloadURL();

    console.log('[Profile] Foto subida a Storage:', downloadURL);
    return downloadURL;
  }

  /**
   * Construye el HTML de una tarjeta de contacto de emergencia.
   */
  function buildContactHTML(contact, index) {
    return (
      '<div class="emergency-contact-item" data-index="' + index + '">' +
        '<input class="contact-name" type="text" placeholder="Nombre" value="' + (contact.name || '') + '">' +
        '<input class="contact-phone" type="tel" placeholder="Teléfono" value="' + (contact.phone || '') + '">' +
        '<input class="contact-relation" type="text" placeholder="Relación" value="' + (contact.relation || '') + '">' +
      '</div>'
    );
  }

  // ──────────────────────────────────────────────
  // Exponer API pública
  // ──────────────────────────────────────────────
  return {
    init:        init,
    loadProfile: loadProfile,
    saveProfile: saveProfile,
    addTag:      addTag,
    removeTag:   removeTag,
    uploadPhoto: uploadPhoto,
  };
})();
