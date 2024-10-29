from flask import Flask, request, jsonify, render_template_string
import requests
from flask_cors import CORS  # Import CORS to handle cross-origin requests

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# Store the set voltage and sensor value
set_voltage = 215  # Initial voltage
sensor_value = 0   # Initial sensor value

@app.route("/set_voltage", methods=["POST"])
def set_voltage_endpoint():
    global set_voltage
    data = request.get_json()
    if "voltage" in data:
        set_voltage = data["voltage"]
        return jsonify({"message": "Set voltage updated", "set_voltage": set_voltage, "status": "success"}), 200
    return jsonify({"error": "Invalid input"}), 400

@app.route("/update_sensor", methods=["POST"])
def update_sensor_endpoint():
    global sensor_value
    data = request.get_json()
    if "sensor_value" in data:
        sensor_value = data["sensor_value"]
        return jsonify({"message": "Sensor value updated", "sensor_value": sensor_value, "status": "success"}), 200
    return jsonify({"error": "Invalid input"}), 400

@app.route("/")
def home():
    # Render the home page with current values
    return render_template_string("""
        <html>
            <head><title>ESP32 Control</title></head>
            <body>
                <h1>ESP32 Control</h1>
                <p>Current Set Voltage: {{ set_voltage }}</p>
                <p>Current Sensor Value: {{ sensor_value }}</p>
                <form action="/set_voltage" method="post">
                    <label for="voltage">Set New Voltage (0-3300):</label>
                    <input type="number" id="voltage" name="voltage" min="0" max="3300" value="{{ set_voltage }}">
                    <input type="submit" value="Update Voltage">
                </form>
            </body>
        </html>
    """, set_voltage=set_voltage, sensor_value=sensor_value)

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0')  # Run on all network interfaces
