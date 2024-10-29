from flask import Flask, request, jsonify, render_template

app = Flask(__name__)

# Variables to store sensor data and set voltage
sensor_value = 0
set_voltage = 215  # Initial value for DAC output

@app.route("/")
def home():
    return render_template("index.html", sensor_value=sensor_value, set_voltage=set_voltage)

@app.route("/set_voltage", methods=["POST"])
def set_voltage_endpoint():
    global set_voltage
    data = request.get_json()

    new_voltage = data.get("voltage")
    if new_voltage is not None and 0 <= new_voltage <= 255:
        set_voltage = new_voltage
        return jsonify({"status": "success", "set_voltage": set_voltage}), 200
    return jsonify({"status": "error", "message": "Invalid voltage value"}), 400

@app.route("/update_sensor", methods=["POST"])
def update_sensor():
    global sensor_value
    data = request.get_json()

    sensor_value = data.get("sensor_value")
    return jsonify({"status": "success", "sensor_value": sensor_value}), 200

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=8000)
