import os
import numpy as np
import matplotlib.pyplot as plt
from flask import Blueprint, current_app

views = Blueprint('views', __name__)

def generate_plot(sensor_values, set_voltage):
    # If we have less than 100 readings, fill with dummy data
    if len(sensor_values) < 100:
        sensor_values = [0] * (100 - len(sensor_values)) + sensor_values

    # Ensure we only take the last 100 readings
    sensor_values = sensor_values[-100:]

    time = np.arange(len(sensor_values))

    # Calculate rise time, settling time, and overshoot
    rise_time = np.argmax(np.array(sensor_values) >= (set_voltage * 0.9))  # Time to reach 90% of set voltage
    settling_time = np.argmax(np.abs(np.array(sensor_values) - set_voltage) < (set_voltage * 0.05))  # Time to settle within 5%
    overshoot = (max(sensor_values) - set_voltage) / set_voltage * 100 if set_voltage != 0 else 0  # Percentage overshoot

    # Prepare the plot
    plt.figure(figsize=(12, 7))
    plt.plot(time, sensor_values, label='Sensor Values', marker='o', markersize=3)
    plt.plot(time, [set_voltage] * len(time), label='Set Voltage', linestyle='--', color='orange')
    plt.axvline(x=rise_time, color='r', linestyle='--', label='Rise Time')
    plt.axvline(x=settling_time, color='g', linestyle='--', label='Settling Time')

    # Annotate overshoot on the plot
    plt.text(rise_time, max(sensor_values), f'Rise Time: {rise_time} s', color='red', verticalalignment='bottom')
    plt.text(settling_time, set_voltage + 10, f'Settling Time: {settling_time} s', color='green', verticalalignment='bottom')
    plt.text(time[-1], set_voltage, f'Overshoot: {overshoot:.2f}%', color='purple', verticalalignment='bottom')

    plt.title('Sensor Readings Over Time')
    plt.xlabel('Time')
    plt.ylabel('Sensor Value')
    plt.legend()
    plt.grid()

    # Save the plot in the static folder
    plot_path = os.path.join(current_app.static_folder, 'sensor_plot.png')
    plt.savefig(plot_path)
    plt.close()

    return 'sensor_plot.png'  # Return the filename for rendering in the template
