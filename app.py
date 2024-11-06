# Assuming this is Flask application setup file, app.py

from flask import Flask, request, jsonify, render_template
from datetime import datetime
import os

app = Flask(__name__)

# Initialize default values for sensor data and set voltage
sensor_data = []
set_voltage = 0

@app.route('/')
def index():
    return render_template('index.html', set_voltage=set_voltage)

@app.route('/set_voltage', methods=['POST'])
def set_voltage_route():
    global set_voltage
    try:
        # Get voltage from form data
        set_voltage = int(request.form['voltage'])
        return jsonify({"status": "success", "set_voltage": set_voltage})
    except ValueError:
        return jsonify({"status": "error", "message": "Invalid voltage value."})

@app.route('/update_sensor', methods=['POST'])
def update_sensor():
    global sensor_data
    data = request.get_json()
    sensor_value = data.get("sensor_value")
    if sensor_value is not None:
        sensor_data.append(sensor_value)
        # Limit to last 100 readings
        if len(sensor_data) > 100:
            sensor_data.pop(0)
        return jsonify({"status": "success", "sensor_value": sensor_value})
    return jsonify({"status": "error", "message": "Invalid sensor data."})

@app.route('/get_voltage', methods=['GET'])
def get_voltage():
    return jsonify({"set_voltage": set_voltage})

@app.route('/get_measurements', methods=['GET'])
def get_measurements():
    return jsonify({"sensor_values": sensor_data, "set_voltage": set_voltage})

if __name__ == "__main__":
    app.run(debug=True)
