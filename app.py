from flask import Flask, request, jsonify, render_template
from flask_cors import CORS  # Import CORS to handle cross-origin requests

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# Store the set voltage and sensor values
set_voltage = 215  # Initial voltage
sensor_values = []  # List to store multiple sensor values

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
    global sensor_values
    data = request.json
    if not data:
        return jsonify({"error": "No JSON data provided"}), 400

    # Check if sensor_values is a list in the request data (batch mode)
    if "sensor_values" in data:
        sensor_values = data["sensor_values"]
        message = "Batch sensor data updated"
    else:
        # Single sensor value update for backward compatibility
        single_value = data.get("sensor_value")
        if single_value is not None:
            sensor_values = [single_value]
            message = "Single sensor data updated"
        else:
            return jsonify({"error": "Missing sensor value"}), 400

    return jsonify({"message": message, "status": "success"}), 200

@app.route("/sensor_value", methods=["GET"])
def get_sensor_value():
    global sensor_values
    # Return the most recent sensor value if available
    return jsonify({"sensor_values": sensor_values}), 200

@app.route("/get_voltage", methods=["GET"])
def get_voltage():
    global set_voltage
    return jsonify({"set_voltage": set_voltage}), 200

@app.route("/")
def home():
    return render_template("index.html", set_voltage=set_voltage, sensor_values=sensor_values)

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0')  # Run on all network interfaces
