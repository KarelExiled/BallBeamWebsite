from flask import Flask, request, jsonify, render_template
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

@app.route('/update_sensor', methods=['POST'])
def update_sensor():
    global sensor_value
    data = request.json
    if not data:
        return jsonify({"error": "No JSON data provided"}), 400

    sensor_value = data.get("sensor_value", sensor_value)
    if sensor_value is None:
        return jsonify({"error": "Missing sensor value"}), 400

    return jsonify({"message": "Sensor data updated", "status": "success"}), 200

@app.route("/sensor_value", methods=["GET"])
def get_sensor_value():
    global sensor_value
    return jsonify({"sensor_value": sensor_value}), 200

@app.route("/")
def home():
    return render_template("index.html", set_voltage=set_voltage, sensor_value=sensor_value)

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0')  # Run on all network interfaces
