/**
 * VidaSegura - Auto Updater (Capacitor)
 * Checks GitHub for new releases and downloads the APK natively.
 */
window.VidaSegura = window.VidaSegura || {};
window.VidaSegura.Updater = (function () {
    'use strict';

    const APP_VERSION = 'v1.0.48';
    const GITHUB_REPO = 'salebe17/vidasegura-app';
    const API_URL = 'https://api.github.com/repos/' + GITHUB_REPO + '/releases/latest';

    let isChecking = false;

    async function checkForUpdates() {
        if (isChecking) return;
        // Solo aplica en app nativa (Capacitor)
        if (typeof Capacitor === 'undefined' || !Capacitor.isNativePlatform()) return;

        isChecking = true;
        try {
            console.log('[Updater] Checking for updates...');
            var response = await fetch(API_URL + '?t=' + new Date().getTime());
            if (!response.ok) throw new Error('API Error');
            var data = await response.json();
            
            var latestVersion = data.tag_name;
            var apkAsset = data.assets && data.assets.find(function(a) {
                return a.name.endsWith('.apk');
            });

            if (latestVersion && latestVersion !== APP_VERSION && apkAsset) {
                console.log('[Updater] Update available:', latestVersion);
                _promptUpdate(latestVersion, apkAsset.browser_download_url);
            } else {
                console.log('[Updater] App is up to date.');
            }
        } catch (err) {
            console.error('[Updater] Failed to check for updates', err);
        } finally {
            isChecking = false;
        }
    }

    function _promptUpdate(version, downloadUrl) {
        // Crear UI minimalista para la actualización
        var overlay = document.createElement('div');
        overlay.id = 'update-overlay';
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.backgroundColor = 'rgba(0,0,0,0.8)';
        overlay.style.zIndex = '999999';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';

        var box = document.createElement('div');
        box.style.background = '#111827';
        box.style.border = '1px solid #3b82f6';
        box.style.borderRadius = '16px';
        box.style.padding = '24px';
        box.style.maxWidth = '300px';
        box.style.textAlign = 'center';
        box.style.color = '#fff';
        box.style.boxShadow = '0 10px 25px rgba(0,0,0,0.5)';

        box.innerHTML = '<h3>¡Nueva Versión! 🚀</h3>' +
                        '<p style="font-size: 14px; color: #9ca3af; margin: 12px 0;">' +
                        'VidaSegura ' + version + ' está disponible con mejoras de seguridad y correcciones. ' +
                        'Para seguir protegido, actualiza ahora.</p>' +
                        '<p id="update-progress" style="font-size: 13px; font-weight: bold; color: #3b82f6; display: none;">Descargando... <span id="update-pct"></span></p>' +
                        '<button id="btn-update-now" style="background: #3b82f6; color: #fff; border: none; padding: 10px 20px; border-radius: 8px; width: 100%; font-weight: bold; margin-top: 16px;">Actualizar Gratis</button>' +
                        '<button id="btn-update-later" style="background: transparent; color: #9ca3af; border: none; padding: 10px 20px; margin-top: 8px; font-size: 13px; width: 100%;">Más tarde</button>';

        overlay.appendChild(box);
        document.body.appendChild(overlay);

        document.getElementById('btn-update-later').addEventListener('click', function() {
            document.body.removeChild(overlay);
        });

        document.getElementById('btn-update-now').addEventListener('click', function() {
            _downloadAndInstall(downloadUrl, version);
        });
    }

    async function _downloadAndInstall(url, version) {
        document.getElementById('btn-update-now').style.display = 'none';
        document.getElementById('btn-update-later').style.display = 'none';
        document.getElementById('update-progress').style.display = 'block';

        try {
            console.log('[Updater] Downloading APK from:', url);
            
            // Usar capacitor/filesystem para descargar directamente
            var { Filesystem } = Capacitor.Plugins;
            var fileName = 'VidaSegura_' + version + '.apk';

            // Filesystem.addListener for progress (if supported, otherwise it just downloads)
            var downloadTask = await Filesystem.downloadFile({
                url: url,
                path: fileName,
                directory: 'DATA',
                progress: true
            });

            console.log('[Updater] Downloaded to:', downloadTask.path);
            document.getElementById('update-pct').innerText = '100% - Instalando...';

            var uriResult = await Filesystem.getUri({
                path: fileName,
                directory: 'DATA'
            });

            var cleanPath = uriResult.uri;
            if (cleanPath.startsWith('file://')) {
                cleanPath = cleanPath.substring(7);
            }

            // Llamar al plugin nativo
            var AppUpdaterPlugin = Capacitor.Plugins.AppUpdater;
            await AppUpdaterPlugin.installApk({ filePath: cleanPath });

            // Remover UI después de 2s
            setTimeout(function() {
                var overlay = document.getElementById('update-overlay');
                if (overlay) document.body.removeChild(overlay);
            }, 2000);

        } catch (err) {
            console.error('[Updater] Update error', err);
            alert("Update Error: " + (err.message || err));
            document.getElementById('update-progress').innerText = 'Error al actualizar. Intenta de nuevo.';
            setTimeout(function() {
                var overlay = document.getElementById('update-overlay');
                if (overlay) document.body.removeChild(overlay);
            }, 3000);
        }
    }

    return {
        init: function() {
            setTimeout(checkForUpdates, 3000); // Check 3 seconds after boot
        }
    };

})();
