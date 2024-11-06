# This file contains route functions related to views, presumably part of the main app.

from flask import Blueprint, render_template, request, jsonify, url_for
import os

views = Blueprint('views', __name__)

# Endpoint for the main page
@views.route('/')
def home():
    return render_template("index.html")

# Endpoint to set voltage from a POST request
@views.route('/set_voltage', methods=['POST'])
def set_voltage():
    voltage = request.form.get('voltage')
    if voltage and voltage.isdigit():
        voltage = int(voltage)
        # Perform any necessary action with the voltage value
        return jsonify({"status": "success", "set_voltage": voltage})
    else:
        return jsonify({"status": "error", "message": "Invalid voltage input."})

# Endpoint to update sensor data
@views.route('/update_sensor', methods=['POST'])
def update_sensor():
    data = request.get_json()
    sensor_value = data.get("sensor_value")
    if sensor_value is not None:
        # Process the sensor value here
        return jsonify({"status": "success", "sensor_value": sensor_value})
    return jsonify({"status": "error", "message": "Sensor value is missing"})

# Endpoint to retrieve current voltage setting
@views.route('/get_voltage', methods=['GET'])
def get_voltage():
    # Return the currently set voltage (example)
    return jsonify({"set_voltage": 123})

# Endpoint to get sensor measurements
@views.route('/get_measurements', methods=['GET'])
def get_measurements():
    # Mock data to simulate sensor readings
    sensor_values = [random.randint(0, 255) for _ in range(10)]  # Replace with actual data source
    return jsonify({"sensor_values": sensor_values, "set_voltage": 123})
