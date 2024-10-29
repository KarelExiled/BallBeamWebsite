import matplotlib.pyplot as plt
import numpy as np
from scipy import signal
import requests
from flask import Flask, render_template_string, request, redirect

app = Flask(__name__)

ESP_IP = "http://192.168.119.85"  # Replace with your ESP32's IP address

@app.route('/')
def home():
    try:
        # Fetch current sensor value and set voltage from the ESP32
        response = requests.get(ESP_IP)
        if response.status_code == 200:
            html_content = response.text
            sensor_value = int(parse_value(html_content, 'Sensor Value (Pin 25):'))
            set_voltage = int(parse_value(html_content, 'Set Voltage (Pin 26):'))
        else:
            sensor_value = 0
            set_voltage = 0
    except Exception as e:
        print(f"Error connecting to ESP32: {e}")
        sensor_value = 0
        set_voltage = 0

    # Plot the data and calculate characteristics
    time, response_data = simulate_system_response(sensor_value)
    plot_file = plot_response(time, response_data, set_voltage)

    # Render the page with the plot and the form
    return render_template_string(
        '''
        <html>
        <head><title>ESP32 Real-Time Plot</title></head>
        <body>
            <h1>ESP32 Real-Time Plot and Control</h1>
            <p>Sensor Value: {{ sensor_value }}</p>
            <p>Set Voltage: {{ set_voltage }}</p>
            <h3>Adjust Set Voltage:</h3>
            <form action="/set_voltage" method="post">
                <input type="number" name="voltage" min="0" max="255" value="{{ set_voltage }}">
                <input type="submit" value="Set Voltage">
            </form>
            <h3>System Response Plot:</h3>
            <img src="{{ plot_file }}" alt="Time Domain Plot">
        </body>
        </html>
        ''', sensor_value=sensor_value, set_voltage=set_voltage, plot_file=plot_file
    )

@app.route('/set_voltage', methods=['POST'])
def set_voltage():
    new_voltage = int(request.form['voltage'])
    requests.get(f"{ESP_IP}/?voltage={new_voltage}")
    return redirect('/')

def parse_value(html, label):
    """Helper function to extract values from HTML content."""
    start = html.find(label) + len(label)
    end = html.find('</p>', start)
    return html[start:end].strip()

def simulate_system_response(sensor_value):
    """Simulate system response based on sensor value."""
    # Example of a simple step response simulation
    system = signal.TransferFunction([1], [1, 2, 1])
    time, response = signal.step(system)
    response *= sensor_value / 4095  # Normalize the response based on sensor value
    return time, response

def plot_response(time, response, set_voltage):
    """Plot the system response and calculate rise time, settling time, and overshoot."""
    plt.figure(figsize=(10, 6))
    plt.plot(time, response, label="Response")
    plt.axhline(y=set_voltage / 255 * 3.3, color='r', linestyle='--', label="Setpoint (Voltage)")

    # Calculate Rise time, Settling time, and Overshoot (simplified approach)
    rise_time = time[np.argmax(response > 0.9 * set_voltage / 255 * 3.3)]
    settling_time = time[-1]
    overshoot = (max(response) - set_voltage / 255 * 3.3) / (set_voltage / 255 * 3.3) * 100

    plt.title(
        f"Time Domain Response\nRise Time: {rise_time:.2f}s, Settling Time: {settling_time:.2f}s, Overshoot: {overshoot:.2f}%")
    plt.xlabel("Time [s]")
    plt.ylabel("Response")
    plt.legend()

    plot_file = "static/plot.png"
    plt.savefig(plot_file)
    return plot_file

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
