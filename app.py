import matplotlib.pyplot as plt
import numpy as np
import requests
from flask import Flask, render_template, request, redirect, url_for, jsonify

app = Flask(__name__)

ESP_IP = "http://192.168.119.85"  # Replace with your ESP32's IP address


@app.route('/')
def home():
    set_voltage = 0  # Default set_voltage; could be updated based on your server response
    return render_template('index.html', set_voltage=set_voltage)


@app.route('/fetch_measurements')
def fetch_measurements():
    """Fetch the last 100 sensor measurements from ESP32 and plot them."""
    try:
        response = requests.get(f"{ESP_IP}/get_measurements")
        if response.status_code == 200:
            data = response.json()
            sensor_values = data.get('sensor_values', [])
            set_voltage = data.get('set_voltage', 0)

            # Generate plot
            if sensor_values:
                time = np.arange(len(sensor_values)) * 0.25  # Assuming data every 0.25 seconds
                plot_file = plot_response(time, sensor_values, set_voltage)
                return jsonify({"plot_file": url_for('static', filename=plot_file), "set_voltage": set_voltage})
            else:
                return jsonify({"error": "No data received"}), 400
        else:
            return jsonify({"error": "Failed to fetch data from ESP32"}), 500
    except Exception as e:
        print(f"Error fetching measurements: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/set_voltage', methods=['POST'])
def set_voltage():
    new_voltage = int(request.form['voltage'])
    requests.get(f"{ESP_IP}/?voltage={new_voltage}")
    return redirect('/')


def plot_response(time, sensor_values, set_voltage):
    """Plot the sensor values and save the plot as a PNG file."""
    plt.figure(figsize=(10, 6))
    plt.plot(time, sensor_values, label="Sensor Values")
    plt.axhline(y=set_voltage / 255 * 3.3, color='r', linestyle='--', label="Setpoint (Voltage)")

    plt.xlabel("Time [s]")
    plt.ylabel("Sensor Value")
    plt.title("Sensor Measurements Over Time")
    plt.legend()

    plot_file = "plot.png"
    plt.savefig(f"static/{plot_file}")
    plt.close()
    return plot_file


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
