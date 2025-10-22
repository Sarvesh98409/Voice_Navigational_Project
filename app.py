import os
import subprocess
from flask import Flask, request, render_template, jsonify
import openrouteservice
import whisper
from config import ORS_API_KEY

app = Flask(__name__)

# ----------------- Whisper model -----------------
# changed to "small" for better accuracy with place names
whisper_model = whisper.load_model("small")

# OpenRouteService client
ors = openrouteservice.Client(key=ORS_API_KEY)

# ----------------- Routes -----------------
@app.route("/")
def index():
    return render_template("index.html")

# ----------------- Transcribe audio via Whisper -----------------
@app.route("/transcribe", methods=["POST"])
def transcribe():
    if "audio_blob" not in request.files:
        return jsonify({"error": "No audio file received"}), 400

    uploaded_file = request.files["audio_blob"]
    temp_input = "temp_input"
    temp_wav = "temp.wav"

    uploaded_file.save(temp_input)

    ffmpeg_path = r"C:\Users\sarvesh k\Downloads\ffmpeg-8.0-essentials_build\ffmpeg-8.0-essentials_build\bin\ffmpeg.exe"
    try:
        subprocess.run([
            ffmpeg_path, "-y", "-i", temp_input, "-ar", "16000", "-ac", "1", temp_wav
        ], check=True)
    except subprocess.CalledProcessError as e:
        return jsonify({"error": f"ffmpeg conversion failed: {str(e)}"}), 500

    try:
        result = whisper_model.transcribe(temp_wav, language="en", task="transcribe")
        text = result["text"].strip()
        if not text:
            return jsonify({"error": "Speech not recognized, please try again"}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        os.remove(temp_input)
        os.remove(temp_wav)

    return jsonify({"text": text})

# ----------------- Geocode destination -----------------
@app.route("/geocode", methods=["POST"])
def geocode():
    data = request.get_json()
    if not data or "text" not in data:
        return jsonify({"error": "Missing text"}), 400

    # ✅ force search inside Chennai
    query = f"{data['text']}, Chennai"

    try:
        res = ors.pelias_search(text=query, size=1)
        if res and res.get("features"):
            coords = res["features"][0]["geometry"]["coordinates"]
            lon, lat = coords[0], coords[1]
            label = res["features"][0]["properties"].get("label", query)
            return jsonify({"lat": lat, "lon": lon, "label": label})
        else:
            return jsonify({"error": "No geocoding result"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ----------------- Get directions with step coordinates -----------------
@app.route("/directions", methods=["POST"])
def directions():
    data = request.get_json()
    if not data or "end" not in data:
        return jsonify({"error": "Missing end"}), 400

    start = {"lat": 13.0418, "lon": 80.0456}  # Panimalar Engineering College
    end = data["end"]

    try:
        coords = [[start["lon"], start["lat"]], [end["lon"], end["lat"]]]
        route = ors.directions(coords, profile="foot-walking", format="geojson", instructions=True)

        steps = []
        features = route.get("features", [])
        if features:
            geometry = features[0]["geometry"]["coordinates"]
            segments = features[0]["properties"]["segments"]
            for seg in segments:
                for step in seg["steps"]:
                    start_wp = step["way_points"][0]
                    lat, lon = geometry[start_wp][1], geometry[start_wp][0]
                    steps.append({
                        "instruction": step.get("instruction"),
                        "distance": step.get("distance"),
                        "duration": step.get("duration"),
                        "lat": lat,
                        "lon": lon
                    })

        return jsonify({"steps": steps})

    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", debug=True, port=5000)
