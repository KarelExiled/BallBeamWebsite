from flask import Flask, request, jsonify, render_template
import os
import matplotlib.pyplot as plt
from datetime import datetime
from collections import deque

app = Flask(__name__)

# Global variables
sensor_values = deque(maxlen=100)  # Store the last 100 sensor readings
set_voltage = 215  # Initial voltage value


# Endpoint to update set voltage
@app.route('/set_voltage', methods=['POST'])
def set_voltage_route():
    global set_voltage
    data = request.form
    set_voltage = int(data.get("voltage", set_voltage))  # Update set voltage
    return jsonify({"status": "success", "set_voltage": set_voltage})


# Endpoint to fetch the current set voltage
@app.route('/get_voltage', methods=['GET'])
def get_voltage():
    return jsonify({"set_voltage": set_voltage})


# Endpoint to receive batched sensor data from the ESP32
@app.route('/update_sensor', methods=['POST'])
def update_sensor():
    data = request.get_json()
    values = data.get("sensor_values", [])

    for value in values:
        sensor_values.append(value)  # Store each sensor value

    return jsonify({"status": "success", "message": "Sensor data updated"})


# Endpoint to send sensor values and current set voltage to the client-side JavaScript
@app.route('/get_measurements', methods=['GET'])
def get_measurements():
    return jsonify({
        "sensor_values": list(sensor_values),
        "set_voltage": set_voltage
    })


# Endpoint to create a plot based on the number of sensor values requested
@app.route('/make_plot', methods=['POST'])
def make_plot():
    data = request.get_json()
    num_readings = int(data.get("num_readings", 100))

    # Limit readings to what's available
    plot_values = list(sensor_values)[-num_readings:]

    # Plotting
    plt.figure(figsize=(10, 4))
    plt.plot(plot_values, marker='o', linestyle='-', color='b')
    plt.title("Sensor Data Plot")
    plt.xlabel("Reading")
    plt.ylabel("Sensor Value")

    # Save plot to a file
    plot_filename = f"static/sensor_plot_{datetime.now().strftime('%Y%m%d%H%M%S')}.png"
    plt.savefig(plot_filename)
    plt.close()

    return jsonify({"plot_path": plot_filename})


# Serve the main HTML page
@app.route('/')
def index():
    return render_template('index.html', set_voltage=set_voltage)


# Run the Flask app
if __name__ == '__main__':
    os.makedirs("static", exist_ok=True)  # Create static directory for plots
    app.run(host='0.0.0.0', port=5000, debug=True)
