/**
 * VidaSegura - Módulo de Utilidades
 * Funciones auxiliares de formato, validación, geolocalización y más.
 */
window.VidaSegura = window.VidaSegura || {};
window.VidaSegura.Utils = {

  /**
   * Genera un identificador único universal.
   * @returns {string} UUID v4 o cadena hexadecimal aleatoria como respaldo.
   */
  generateId() {
    try {
      if (crypto && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
    } catch (_) { /* fallback */ }
    // Fallback: cadena hexadecimal de 32 caracteres
    const bytes = new Uint8Array(16);
    (crypto || window.msCrypto).getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  },

  /**
   * Formatea una fecha al locale español (ej: '25 jun 2026').
   * @param {Date|string|number} date
   * @returns {string}
   */
  formatDate(date) {
    try {
      const d = date instanceof Date ? date : new Date(date);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleDateString('es-VE', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      }).replace('.', '');
    } catch (e) {
      console.error('[Utils.formatDate]', e);
      return '';
    }
  },

  /**
   * Formatea una fecha en formato HH:MM (24 horas).
   * @param {Date|string|number} date
   * @returns {string}
   */
  formatTime(date) {
    try {
      const d = date instanceof Date ? date : new Date(date);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleTimeString('es-VE', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
    } catch (e) {
      console.error('[Utils.formatTime]', e);
      return '';
    }
  },

  /**
   * Devuelve tiempo relativo en español (ej: 'hace 5 min', 'hace 2 horas').
   * @param {Date|string|number} date
   * @returns {string}
   */
  timeAgo(date) {
    try {
      const d = date instanceof Date ? date : new Date(date);
      if (isNaN(d.getTime())) return '';
      const now = Date.now();
      const diffMs = now - d.getTime();

      if (diffMs < 0) return 'justo ahora';

      const seconds = Math.floor(diffMs / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);
      const weeks = Math.floor(days / 7);
      const months = Math.floor(days / 30);

      if (seconds < 60) return 'hace un momento';
      if (minutes === 1) return 'hace 1 min';
      if (minutes < 60) return `hace ${minutes} min`;
      if (hours === 1) return 'hace 1 hora';
      if (hours < 24) return `hace ${hours} horas`;
      if (days === 1) return 'hace 1 día';
      if (days < 7) return `hace ${days} días`;
      if (weeks === 1) return 'hace 1 semana';
      if (weeks < 4) return `hace ${weeks} semanas`;
      if (months === 1) return 'hace 1 mes';
      if (months < 12) return `hace ${months} meses`;

      const years = Math.floor(months / 12);
      if (years === 1) return 'hace 1 año';
      return `hace ${years} años`;
    } catch (e) {
      console.error('[Utils.timeAgo]', e);
      return '';
    }
  },

  /**
   * Valida un correo electrónico.
   * @param {string} email
   * @returns {boolean}
   */
  validateEmail(email) {
    if (!email || typeof email !== 'string') return false;
    const re = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
    return re.test(email.trim());
  },

  /**
   * Valida un número telefónico venezolano.
   * Acepta formatos: 04XX-XXXXXXX, +58 4XX XXXXXXX, 04XXXXXXXXX, etc.
   * @param {string} phone
   * @returns {boolean}
   */
  validatePhone(phone) {
    if (!phone || typeof phone !== 'string') return false;
    const cleaned = phone.replace(/[\s\-().+]/g, '');
    // Formato venezolano: 04XX seguido de 7 dígitos o 584XX seguido de 7 dígitos
    const re = /^(0?4(12|14|16|24|26)\d{7}|58\s?4(12|14|16|24|26)\d{7})$/;
    return re.test(cleaned) || /^\d{10,13}$/.test(cleaned);
  },

  /**
   * Genera un código numérico aleatorio.
   * @param {number} length - Longitud del código (por defecto 6).
   * @returns {string}
   */
  generateCode(length = 6) {
    let code = '';
    const bytes = new Uint8Array(length);
    (crypto || window.msCrypto).getRandomValues(bytes);
    for (let i = 0; i < length; i++) {
      code += (bytes[i] % 10).toString();
    }
    return code;
  },

  /**
   * Crea una función debounce.
   * @param {Function} fn
   * @param {number} delay - Milisegundos (por defecto 300).
   * @returns {Function}
   */
  debounce(fn, delay = 300) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  },

  /**
   * Crea una función throttle.
   * @param {Function} fn
   * @param {number} delay - Milisegundos (por defecto 300).
   * @returns {Function}
   */
  throttle(fn, delay = 300) {
    let lastCall = 0;
    let timer = null;
    return function (...args) {
      const now = Date.now();
      const remaining = delay - (now - lastCall);
      clearTimeout(timer);
      if (remaining <= 0) {
        lastCall = now;
        fn.apply(this, args);
      } else {
        timer = setTimeout(() => {
          lastCall = Date.now();
          fn.apply(this, args);
        }, remaining);
      }
    };
  },

  /**
   * Calcula la distancia entre dos coordenadas usando la fórmula de Haversine.
   * @param {number} lat1 - Latitud punto 1.
   * @param {number} lng1 - Longitud punto 1.
   * @param {number} lat2 - Latitud punto 2.
   * @param {number} lng2 - Longitud punto 2.
   * @returns {number} Distancia en kilómetros.
   */
  haversineDistance(lat1, lng1, lat2, lng2) {
    const R = 6371; // Radio de la Tierra en km
    const toRad = (deg) => (deg * Math.PI) / 180;

    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  },

  /**
   * Calcula la edad en años a partir de una fecha de nacimiento.
   * @param {string|Date} birthdate
   * @returns {number} Edad en años.
   */
  calculateAge(birthdate) {
    try {
      const birth = birthdate instanceof Date ? birthdate : new Date(birthdate);
      if (isNaN(birth.getTime())) return 0;
      const today = new Date();
      let age = today.getFullYear() - birth.getFullYear();
      const monthDiff = today.getMonth() - birth.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
        age--;
      }
      return Math.max(0, age);
    } catch (e) {
      console.error('[Utils.calculateAge]', e);
      return 0;
    }
  },

  /**
   * Devuelve un array con los 24 estados de Venezuela.
   * @returns {string[]}
   */
  getVenezuelanStates() {
    return [
      'Amazonas',
      'Anzoátegui',
      'Apure',
      'Aragua',
      'Barinas',
      'Bolívar',
      'Carabobo',
      'Cojedes',
      'Delta Amacuro',
      'Distrito Capital',
      'Falcón',
      'Guárico',
      'La Guaira',
      'Lara',
      'Mérida',
      'Miranda',
      'Monagas',
      'Nueva Esparta',
      'Portuguesa',
      'Sucre',
      'Táchira',
      'Trujillo',
      'Yaracuy',
      'Zulia'
    ];
  },

  /**
   * Escapa entidades HTML para prevenir inyección.
   * @param {string} str
   * @returns {string}
   */
  sanitizeHTML(str) {
    if (!str || typeof str !== 'string') return '';
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
      '/': '&#x2F;'
    };
    return str.replace(/[&<>"'/]/g, (char) => map[char]);
  },

  /**
   * Copia texto al portapapeles del sistema.
   * @param {string} text
   * @returns {Promise<boolean>}
   */
  async copyToClipboard(text) {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
        return true;
      }
      // Fallback para navegadores sin soporte de Clipboard API
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '-9999px';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textarea);
      return success;
    } catch (e) {
      console.error('[Utils.copyToClipboard]', e);
      return false;
    }
  },

  /**
   * Devuelve un array con los tipos de sangre.
   * @returns {string[]}
   */
  getBloodTypes() {
    return ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
  }
};
