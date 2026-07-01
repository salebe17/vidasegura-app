const fs = require("fs");
let code = fs.readFileSync("js/family.js", "utf8");

const replacement = `    // ----------------------------------------------
    // Historial de Rutas (Panel Avanzado)
    // ----------------------------------------------
    var trackingMap = null;
    var trackingPolyline = null;
    var trackingMarker = null;
    var trackingLocations = [];
    var trackingPlayInterval = null;
    var trackingUid = null;

    async function showHistory(uid) {
        try {
            trackingUid = uid;
            var range = parseInt(document.getElementById("tracking-time-range").value) || 24;
            document.getElementById("tracking-panel").classList.remove("hidden");
            document.getElementById("tracking-subtitle").innerText = "Cargando datos...";
            
            if (!trackingMap) {
                trackingMap = L.map("tracking-map").setView([0, 0], 2);
                L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
                    maxZoom: 19
                }).addTo(trackingMap);
            }
            
            setTimeout(function(){ trackingMap.invalidateSize(); }, 300);

            var locs = await window.VidaSegura.DB.getLocations(range, uid);
            if (!locs || locs.length < 2) {
                document.getElementById("tracking-subtitle").innerText = "No hay suficiente historial en este rango.";
                if (trackingPolyline) { trackingMap.removeLayer(trackingPolyline); trackingPolyline = null; }
                if (trackingMarker) { trackingMap.removeLayer(trackingMarker); trackingMarker = null; }
                trackingLocations = [];
                return;
            }

            // locs is newest-first, reverse to oldest-first for timeline
            trackingLocations = locs.reverse();
            drawTrackingRoute();
            
        } catch (e) {
            console.error("[Family] Error showHistory:", e);
        }
    }

    function drawTrackingRoute() {
        if (trackingPolyline) trackingMap.removeLayer(trackingPolyline);
        if (trackingMarker) trackingMap.removeLayer(trackingMarker);
        
        var latlngs = trackingLocations.map(function(l) { return [l.lat, l.lng]; });
        
        trackingPolyline = L.polyline(latlngs, {color: "#3b82f6", weight: 4}).addTo(trackingMap);
        trackingMap.fitBounds(trackingPolyline.getBounds());
        
        var slider = document.getElementById("tracking-slider");
        slider.max = trackingLocations.length - 1;
        slider.value = trackingLocations.length - 1;
        
        document.getElementById("tracking-subtitle").innerText = trackingLocations.length + " puntos registrados";
        
        updateTrackingMarker(trackingLocations.length - 1);
    }

    function updateTrackingMarker(index) {
        var loc = trackingLocations[index];
        if (!loc) return;
        
        var latlng = [loc.lat, loc.lng];
        if (!trackingMarker) {
            var iconHtml = "<div style=\\"background:#3b82f6; width:16px; height:16px; border-radius:50%; border:2px solid white; box-shadow:0 0 5px rgba(0,0,0,0.5);\\"></div>";
            var divIcon = L.divIcon({ html: iconHtml, className: "tracking-point-icon", iconSize: [16,16], iconAnchor: [8,8] });
            trackingMarker = L.marker(latlng, {icon: divIcon}).addTo(trackingMap);
        } else {
            trackingMarker.setLatLng(latlng);
        }
        
        var timeStr = new Date(loc.timestamp).toLocaleTimeString([], {hour: "2-digit", minute:"2-digit"});
        document.getElementById("tracking-time-label").innerText = timeStr;
        
        var battery = loc.battery !== undefined && loc.battery !== null ? loc.battery + "%" : "--";
        var speed = loc.speed !== undefined && loc.speed !== null ? (loc.speed * 3.6).toFixed(1) + " km/h" : "--";
        
        document.getElementById("tracking-stats").innerHTML = "<span><i class=\\"fas fa-battery-half\\"></i> " + battery + "</span><span><i class=\\"fas fa-tachometer-alt\\"></i> " + speed + "</span>";
    }

    function onSliderInput() {
        var val = parseInt(document.getElementById("tracking-slider").value);
        updateTrackingMarker(val);
    }

    function onSliderChange() {
        var val = parseInt(document.getElementById("tracking-slider").value);
        if (trackingLocations[val]) {
            trackingMap.panTo([trackingLocations[val].lat, trackingLocations[val].lng]);
        }
    }

    function toggleTrackingPlay() {
        var icon = document.getElementById("icon-play-tracking");
        if (trackingPlayInterval) {
            clearInterval(trackingPlayInterval);
            trackingPlayInterval = null;
            icon.className = "fas fa-play";
        } else {
            icon.className = "fas fa-pause";
            var slider = document.getElementById("tracking-slider");
            trackingPlayInterval = setInterval(function() {
                var val = parseInt(slider.value);
                if (val >= trackingLocations.length - 1) {
                    slider.value = 0;
                } else {
                    slider.value = val + 1;
                }
                onSliderInput();
                if (slider.value % 5 === 0) onSliderChange();
            }, 500);
        }
    }

    function closeTrackingPanel() {
        if (trackingPlayInterval) toggleTrackingPlay();
        document.getElementById("tracking-panel").classList.add("hidden");
    }

    function changeTrackingRange(range) {
        if (trackingUid) showHistory(trackingUid);
    }
`;

const startIdx = code.indexOf("async function showHistory(uid) {");
if (startIdx > -1) {
    // Find the comment line before it
    const lastComment = code.lastIndexOf("//", startIdx);
    if (lastComment > -1 && startIdx - lastComment < 200) {
        const p1 = code.substring(0, lastComment);
        
        const returnIdx = code.indexOf("return {", startIdx);
        if (returnIdx > -1) {
            const p2 = code.substring(returnIdx);
            let newCode = p1 + replacement + "\n      // Public API\n      " + p2;
            newCode = newCode.replace("        showHistory: showHistory,", "        showHistory: showHistory,\n        closeTrackingPanel: closeTrackingPanel,\n        changeTrackingRange: changeTrackingRange,\n        toggleTrackingPlay: toggleTrackingPlay,\n        onSliderInput: onSliderInput,\n        onSliderChange: onSliderChange,");
            fs.writeFileSync("js/family.js", newCode, "utf8");
            console.log("Successfully replaced showHistory logic!");
        } else { console.log("no return found"); }
    } else { console.log("no comment found before function"); }
} else { console.log("no showHistory found"); }


