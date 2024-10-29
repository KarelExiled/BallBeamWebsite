import matplotlib.pyplot as plt
import numpy as np
import requests
from flask import Flask, render_template, request, redirect

app = Flask(__name__)

ESP_IP = "http://192.168.119.85"  # Replace with your ESP32's IP address

@app.route('/')
def home():
    try:
        # Fetch current sensor values and set voltage from the ESP32
        response = requests.get(f"{ESP_IP}/get_sensor_values")
        if response.status_code == 200:
            data = response.json()
            sensor_values = data.get('sensor_values', [])
            set_voltage = data.get('set_voltage', 0)
        else:
            sensor_values = []
            set_voltage = 0
    except Exception as e:
        print(f"Error connecting to ESP32: {e}")
        sensor_values = []
        set_voltage = 0

    # Plot the data and calculate characteristics
    if sensor_values:
        time = np.arange(len(sensor_values)) * 0.5  # Assuming data is taken every 0.5 seconds
        plot_file = plot_response(time, sensor_values, set_voltage)
    else:
        plot_file = None

    # Render the page with the plot and the form
    return render_template('index.html', set_voltage=set_voltage, plot_file=plot_file)

@app.route('/set_voltage', methods=['POST'])
def set_voltage():
    new_voltage = int(request.form['voltage'])
    requests.get(f"{ESP_IP}/?voltage={new_voltage}")
    return redirect('/')

def plot_response(time, sensor_values, set_voltage):
    """Plot the sensor values and calculate rise time, settling time, and overshoot."""
    plt.figure(figsize=(10, 6))
    plt.plot(time, sensor_values, label="Sensor Values")
    plt.axhline(y=set_voltage / 255 * 3.3, color='r', linestyle='--', label="Setpoint (Voltage)")

    # Calculate Rise time, Settling time, and Overshoot (simplified approach)
    rise_time = time[np.argmax(sensor_values > 0.9 * (set_voltage / 255 * 3.3))]
    settling_time = time[-1]
    overshoot = (max(sensor_values) - set_voltage / 255 * 3.3) / (set_voltage / 255 * 3.3) * 100

    plt.title(
        f"Time Domain Response\nRise Time: {rise_time:.2f}s, Settling Time: {settling_time:.2f}s, Overshoot: {overshoot:.2f}%")
    plt.xlabel("Time [s]")
    plt.ylabel("Sensor Values")
    plt.legend()

    plot_file = "static/plot.png"
    plt.savefig(plot_file)
    plt.close()  # Close the figure to free memory
    return plot_file

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
