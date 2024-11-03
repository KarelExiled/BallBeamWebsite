import numpy as np

def calculate_plot_properties(sensor_values, set_voltage):
    """Utility to calculate any specific properties for plotting."""
    normalized_voltage = set_voltage / 255 * 3.3
    time = np.arange(len(sensor_values)) * 0.25  # Assuming 0.25 seconds interval
    return time, normalized_voltage
