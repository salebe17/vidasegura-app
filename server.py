"""
VidaSegura — API Server
Sirve archivos estáticos + API REST para registro/login/perfil.
Puerto: 7847
"""
import json
import os
import hashlib
import time
import uuid
from http.server import HTTPServer, ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'userdata')
USERS_FILE = os.path.join(DATA_DIR, 'users.json')

def ensure_data_dir():
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(USERS_FILE):
        with open(USERS_FILE, 'w', encoding='utf-8') as f:
            json.dump({}, f)

def load_users():
    ensure_data_dir()
    try:
        with open(USERS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except:
        return {}

def save_users(users):
    ensure_data_dir()
    with open(USERS_FILE, 'w', encoding='utf-8') as f:
        json.dump(users, f, ensure_ascii=False, indent=2)

def hash_password(password):
    return hashlib.sha256(password.encode('utf-8')).hexdigest()


class VidaSeguraHandler(SimpleHTTPRequestHandler):
    """Handles static files + API routes."""

    def do_OPTIONS(self):
        """CORS preflight."""
        self.send_response(200)
        self._cors_headers()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)

        # --- API Endpoints ---
        if self.path == '/api/unregister':
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write(b"""
            <!DOCTYPE html>
            <html><head><meta charset="utf-8"></head><body>
            <h2>Limpiando sistema interno...</h2>
            <script>
            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.getRegistrations().then(function(regs) {
                    regs.forEach(function(reg) { reg.unregister(); });
                    document.body.innerHTML = '<h2 style="color:green">!Listo! Ya puedes volver al enlace original de la app.</h2>';
                });
            } else {
                document.body.innerHTML = '<h2 style="color:green">!Listo! Ya puedes volver al enlace original de la app.</h2>';
            }
            </script></body></html>
            """)
            return
            
        # API: Get user by ID
        if parsed.path.startswith('/api/user/'):
            user_id = parsed.path.split('/api/user/')[-1].strip('/')
            return self._get_user(user_id)

        # API: Get user by email (query param)
        if parsed.path == '/api/user':
            params = parse_qs(parsed.query)
            email = params.get('email', [None])[0]
            if email:
                return self._get_user_by_email(email)
            self._json_response(400, {'error': 'Email requerido'})
            return

        # API: Location update (save via GET for simplicity)
        if parsed.path == '/api/locations':
            params = parse_qs(parsed.query)
            user_id = params.get('userId', [None])[0]
            if user_id:
                return self._get_locations(user_id)
            self._json_response(400, {'error': 'userId requerido'})
            return

        # Static files
        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        body = self._read_body()

        if parsed.path == '/api/register':
            return self._register(body)

        if parsed.path == '/api/login':
            return self._login(body)

        if parsed.path == '/api/user/update':
            return self._update_user(body)

        if parsed.path == '/api/location':
            return self._save_location(body)

        self._json_response(404, {'error': 'Ruta no encontrada'})

    # ── API Handlers ──

    def _register(self, data):
        if not data:
            return self._json_response(400, {'error': 'Datos requeridos'})

        email = data.get('email', '').strip().lower()
        password = data.get('password', '')
        name = data.get('name', '')

        if not email or not password or not name:
            return self._json_response(400, {'error': 'Nombre, email y contraseña son requeridos'})

        users = load_users()

        # Check if email already exists
        for uid, u in users.items():
            if u.get('email', '').lower() == email:
                return self._json_response(409, {'error': 'Ya existe una cuenta con este correo'})

        # Create user
        user_id = str(uuid.uuid4())
        now = int(time.time() * 1000)

        user = {
            'id': user_id,
            'name': data.get('name', ''),
            'cedula': data.get('cedula', ''),
            'email': email,
            'passwordHash': hash_password(password),
            'phone': data.get('phone', ''),
            'birthdate': data.get('birthdate', ''),
            'bloodType': data.get('bloodType', ''),
            'allergies': data.get('allergies', []),
            'medications': data.get('medications', []),
            'conditions': data.get('conditions', []),
            'state': data.get('state', ''),
            'city': data.get('city', ''),
            'emergencyName1': data.get('emergencyName1', ''),
            'emergencyPhone1': data.get('emergencyPhone1', ''),
            'emergencyName2': data.get('emergencyName2', ''),
            'emergencyPhone2': data.get('emergencyPhone2', ''),
            'photo': data.get('photo', ''),
            'insurance': data.get('insurance', ''),
            'organDonor': data.get('organDonor', False),
            'medicalNotes': data.get('medicalNotes', ''),
            'createdAt': now,
            'updatedAt': now,
        }

        users[user_id] = user
        save_users(users)

        # Return user without password hash
        safe_user = {k: v for k, v in user.items() if k != 'passwordHash'}
        return self._json_response(201, {'ok': True, 'user': safe_user})

    def _login(self, data):
        if not data:
            return self._json_response(400, {'error': 'Datos requeridos'})

        email = data.get('email', '').strip().lower()
        password = data.get('password', '')

        if not email or not password:
            return self._json_response(400, {'error': 'Email y contraseña requeridos'})

        users = load_users()
        pw_hash = hash_password(password)

        for uid, u in users.items():
            if u.get('email', '').lower() == email:
                if u.get('passwordHash') == pw_hash:
                    safe_user = {k: v for k, v in u.items() if k != 'passwordHash'}
                    return self._json_response(200, {'ok': True, 'user': safe_user})
                else:
                    return self._json_response(401, {'error': 'Contraseña incorrecta'})

        return self._json_response(404, {'error': 'No hay cuenta registrada con este correo'})

    def _get_user(self, user_id):
        users = load_users()
        user = users.get(user_id)
        if user:
            safe_user = {k: v for k, v in user.items() if k != 'passwordHash'}
            return self._json_response(200, {'ok': True, 'user': safe_user})
        return self._json_response(404, {'error': 'Usuario no encontrado'})

    def _get_user_by_email(self, email):
        users = load_users()
        email = email.strip().lower()
        for uid, u in users.items():
            if u.get('email', '').lower() == email:
                safe_user = {k: v for k, v in u.items() if k != 'passwordHash'}
                return self._json_response(200, {'ok': True, 'user': safe_user})
        return self._json_response(404, {'error': 'Usuario no encontrado'})

    def _update_user(self, data):
        if not data or not data.get('id'):
            return self._json_response(400, {'error': 'ID de usuario requerido'})

        users = load_users()
        user_id = data['id']
        user = users.get(user_id)

        if not user:
            return self._json_response(404, {'error': 'Usuario no encontrado'})

        # Merge fields (don't allow changing password hash directly)
        for key, val in data.items():
            if key not in ('passwordHash',):
                user[key] = val

        user['updatedAt'] = int(time.time() * 1000)
        users[user_id] = user
        save_users(users)

        safe_user = {k: v for k, v in user.items() if k != 'passwordHash'}
        return self._json_response(200, {'ok': True, 'user': safe_user})

    def _save_location(self, data):
        if not data or not data.get('userId'):
            return self._json_response(400, {'error': 'userId requerido'})

        user_id = data['userId']
        loc_file = os.path.join(DATA_DIR, f'locations_{user_id}.json')

        locations = []
        if os.path.exists(loc_file):
            try:
                with open(loc_file, 'r') as f:
                    locations = json.load(f)
            except:
                locations = []

        loc = {
            'id': str(uuid.uuid4()),
            'lat': data.get('lat'),
            'lng': data.get('lng'),
            'accuracy': data.get('accuracy'),
            'timestamp': data.get('timestamp', int(time.time() * 1000)),
        }
        locations.append(loc)

        # Keep only last 500 locations
        locations = locations[-500:]

        with open(loc_file, 'w') as f:
            json.dump(locations, f)

        return self._json_response(200, {'ok': True})

    def _get_locations(self, user_id):
        loc_file = os.path.join(DATA_DIR, f'locations_{user_id}.json')
        locations = []
        if os.path.exists(loc_file):
            try:
                with open(loc_file, 'r') as f:
                    locations = json.load(f)
            except:
                pass
        # Return last 48 hours
        cutoff = int(time.time() * 1000) - (48 * 60 * 60 * 1000)
        recent = [l for l in locations if l.get('timestamp', 0) > cutoff]
        return self._json_response(200, {'ok': True, 'locations': recent})

    # ── Helpers ──

    def _read_body(self):
        try:
            length = int(self.headers.get('Content-Length', 0))
            if length == 0:
                return None
            raw = self.rfile.read(length)
            return json.loads(raw.decode('utf-8'))
        except:
            return None

    def _json_response(self, code, data):
        self.send_response(code)
        self._cors_headers()
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode('utf-8'))

    def _cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def log_message(self, format, *args):
        # Log todo temporalmente para depurar
        super().log_message(format, *args)


if __name__ == '__main__':
    import ssl

    ensure_data_dir()
    PORT = 7847
    CERT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cert.pem')
    KEY_FILE  = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'key.pem')

    server = ThreadingHTTPServer(('0.0.0.0', PORT), VidaSeguraHandler)

    # Wrap with SSL if cert exists
    if os.path.exists(CERT_FILE) and os.path.exists(KEY_FILE):
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(certfile=CERT_FILE, keyfile=KEY_FILE)
        server.socket = ctx.wrap_socket(server.socket, server_side=True)
        proto = 'https'
    else:
        proto = 'http'

    print('===========================================')
    print('  VidaSegura Server v1.0')
    print('  ' + proto + '://0.0.0.0:' + str(PORT))
    print('  ' + proto + '://51.161.91.160:' + str(PORT))
    print('  Data: ' + DATA_DIR)
    print('===========================================')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n[Server] Detenido.')
        server.server_close()
