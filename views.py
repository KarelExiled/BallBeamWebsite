import os
import numpy as np
import matplotlib.pyplot as plt
from flask import Blueprint, current_app

views = Blueprint('views', __name__)


def generate_plot(sensor_values, set_voltage):
    # Vul de sensor_values met dummy data als er minder dan 100 zijn
    if len(sensor_values) < 100:
        sensor_values = [0] * (100 - len(sensor_values)) + sensor_values

    # Zorg ervoor dat we alleen de laatste 100 waarden nemen
    sensor_values = sensor_values[-100:]

    # Bereken de tijd en de fout
    time = np.arange(100)
    error_values = [set_voltage - value for value in sensor_values]  # Bereken de fout

    # Plot de waarden
    plt.figure(figsize=(10, 6))
    plt.plot(time, sensor_values, label='Gemeten Waarden', marker='o')
    plt.plot(time, [set_voltage] * len(time), label='Setpoint', linestyle='--')
    plt.plot(time, error_values, label='Fout', linestyle='--', color='orange')

    plt.title('Sensorwaarden en Fout Over Tijd')
    plt.xlabel('Tijd')
    plt.ylabel('Waarde')
    plt.legend()
    plt.grid()

    # Sla de plot op in de static folder
    plot_path = os.path.join(current_app.static_folder, 'sensor_plot.png')
    plt.savefig(plot_path)
    plt.close()

    return 'sensor_plot.png'

@views.route('/plot')
def plot():
    # This route is no longer needed; plot generation is handled via /make_plot
    pass
