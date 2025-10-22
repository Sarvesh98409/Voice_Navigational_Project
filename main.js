let recordBtn = document.getElementById("recordBtn");
let startNavBtn = document.getElementById("startNav");
let detectedSpan = document.getElementById("detected");
let destcoordsSpan = document.getElementById("destcoords");
let logEl = document.getElementById("log");

function log(msg) {
  logEl.innerText += msg + "\n";
  logEl.scrollTop = logEl.scrollHeight;
}

// --------- Voice Navigation Setup ----------
let mediaRecorder;
let audioChunks = [];

recordBtn.onclick = async () => {
  if (!mediaRecorder || mediaRecorder.state === "inactive") {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];
    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
    mediaRecorder.onstop = async () => {
      const blob = new Blob(audioChunks, { type: "audio/webm" });
      log("Uploading audio for transcription...");
      let formData = new FormData();
      formData.append("audio_blob", blob, "recording.webm");
      const res = await fetch("/transcribe", { method: "POST", body: formData });
      const j = await res.json();
      if (j.error) { log("Transcription error: " + j.error); return; }
      const text = j.text;
      detectedSpan.innerText = text || "—";
      log("Transcribed: " + text);

      if (text && text.length > 0) {
        const g = await fetch("/geocode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text })
        });
        const gj = await g.json();
        if (gj.error) {
          log("Geocoding error: " + gj.error);
          destcoordsSpan.innerText = "—";
          startNavBtn.disabled = true;
        } else {
          destcoordsSpan.innerText = `${gj.lat.toFixed(6)}, ${gj.lon.toFixed(6)} (${gj.label || ''})`;
          window._destination = { lat: gj.lat, lon: gj.lon, label: gj.label };
          startNavBtn.disabled = false;
          log("Destination resolved: " + gj.label);
        }
      }
    };
    mediaRecorder.start();
    recordBtn.innerText = "Stop & Upload";
    setTimeout(() => {
      if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop();
      recordBtn.innerText = "Record Destination";
    }, 4000);
  } else if (mediaRecorder.state === "recording") {
    mediaRecorder.stop();
    recordBtn.innerText = "Record Destination";
  }
};

// --------- Navigation ----------
startNavBtn.onclick = async () => {
  if (!window._destination) { alert("No destination selected"); return; }

  const res = await fetch("/directions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ end: window._destination })
  });
  const j = await res.json();
  if (j.error) { log("Directions error: " + j.error); return; }
  const steps = j.steps || [];

  // Normal mode: only direction
  runNavigation(steps, false);
  drawRouteMap({ lat: 13.1693, lon: 80.2601 }, window._destination, steps); // Start = Manali, Chennai
};

// --------- Distance Calculator ----------
function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// --------- Speak Function ----------
function speak(text) {
  if (!window.speechSynthesis) return;
  let s = new SpeechSynthesisUtterance(text);
  s.rate = 1.0;
  window.speechSynthesis.speak(s);
}

// --------- Smart Navigation Logic ----------
function runNavigation(steps, announceDistance = false) {
  if (!steps || steps.length === 0) {
    log("No navigation steps available.");
    return;
  }

  speak("Starting navigation from Manali, Chennai.");
  log("Starting navigation...");

  let currentIndex = 0;
  const warned = {};

  const watcher = navigator.geolocation.watchPosition((pos) => {
    const myLat = pos.coords.latitude;
    const myLon = pos.coords.longitude;

    if (currentIndex >= steps.length) {
      speak("You have arrived at your destination.");
      log("Navigation complete.");
      navigator.geolocation.clearWatch(watcher);
      return;
    }

    const target = steps[currentIndex];
    const dist = distanceMeters(myLat, myLon, target.lat, target.lon);

    log(`Step ${currentIndex + 1}: ${target.instruction} | Distance: ${dist.toFixed(1)}m`);

    // Normal mode: only direction
    if (!announceDistance && !warned[currentIndex]) {
      speak(target.instruction);
      warned[currentIndex] = true;
    }

    // Distance + direction mode
    if (announceDistance && dist < 70 && dist > 12 && !warned[currentIndex]) {
      speak(`In ${Math.round(dist)} meters, ${target.instruction}`);
      warned[currentIndex] = true;
    }

    // Move to next step if very close
    if (dist < 12) {
      currentIndex++;
    }

    userMarker.setLatLng([myLat, myLon]);
  },
  (err) => log("Geolocation error: " + err.message),
  { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 });
}

// --------- Mini Map using Leaflet -----------
let map = L.map('map').setView([13.1693, 80.2601], 14); // Manali, Chennai
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

let userMarker = L.marker([13.1693, 80.2601], { title: "Start: Manali, Chennai" }).addTo(map);
let destMarker = null;
let routeLine = null;

function drawRouteMap(start, end, steps) {
  userMarker.setLatLng([start.lat, start.lon]);
  if (destMarker) map.removeLayer(destMarker);
  destMarker = L.marker([end.lat, end.lon], { title: "Destination" }).addTo(map);

  if (routeLine) map.removeLayer(routeLine);
  let latlngs = [[start.lat, start.lon]];
  steps.forEach(s => { if (s.lat && s.lon) latlngs.push([s.lat, s.lon]); });
  latlngs.push([end.lat, end.lon]);
  routeLine = L.polyline(latlngs, { color: "blue" }).addTo(map);
  map.fitBounds(routeLine.getBounds());
}

// --------- Camera Object Detection ----------
const video = document.getElementById("camera");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: true });
  video.srcObject = stream;

  const model = await cocoSsd.load();
  log("✅ Object detection model loaded!");

  const lastDetected = {};

  function detectFrame() {
    model.detect(video).then(predictions => {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      predictions.forEach(pred => {
        const { bbox, class: label, score } = pred;
        if (score > 0.6) {
          ctx.strokeStyle = "red";
          ctx.lineWidth = 2;
          ctx.strokeRect(bbox[0], bbox[1], bbox[2], bbox[3]);
          ctx.font = "14px Arial";
          ctx.fillStyle = "red";
          ctx.fillText(`${label} (${(score * 100).toFixed(1)}%)`, bbox[0], bbox[1] - 5);

          const now = Date.now();
          if (!lastDetected[label] || now - lastDetected[label] > 5000) {
            speak(label + " ahead");
            lastDetected[label] = now;
          }
        }
      });

      requestAnimationFrame(detectFrame);
    });
  }

  detectFrame();
}

startCamera();
