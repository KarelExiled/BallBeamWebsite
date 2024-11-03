from flask import Flask, request, jsonify, render_template

app = Flask(__name__)

# Store sensor and voltage data
data_store = {
    "sensor_values": [],
    "set_voltage": 215  # default initial value
}

@app.route('/')
def index():
    return render_template("index.html", set_voltage=data_store["set_voltage"])

@app.route('/set_voltage', methods=['POST'])
def set_voltage():
    voltage = request.form.get("voltage", type=int)
    if voltage is not None and 0 <= voltage <= 255:
        data_store["set_voltage"] = voltage
    return render_template("index.html", set_voltage=data_store["set_voltage"])

@app.route('/update_sensor', methods=['POST'])
def update_sensor():
    sensor_value = request.json.get("sensor_value")
    if sensor_value is not None:
        data_store["sensor_values"].append(sensor_value)
        if len(data_store["sensor_values"]) > 100:  # keep only the last 100 readings
            data_store["sensor_values"].pop(0)
    return jsonify(success=True)

@app.route('/get_measurements', methods=['GET'])
def get_measurements():
    return jsonify(sensor_values=data_store["sensor_values"], set_voltage=data_store["set_voltage"])

@app.route('/get_voltage', methods=['GET'])
def get_voltage():
    return jsonify(set_voltage=data_store["set_voltage"])

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
