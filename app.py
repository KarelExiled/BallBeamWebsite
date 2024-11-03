from flask import Flask, request, jsonify, render_template
from views import views  # Import the views module

app = Flask(__name__)

# Store sensor and voltage data
app.data_store = {
    "sensor_values": [],
    "set_voltage": 215  # default initial value
}

app.register_blueprint(views)  # Register the views blueprint

@app.route('/')
def index():
    return render_template("index.html", set_voltage=app.data_store["set_voltage"])

@app.route('/set_voltage', methods=['POST'])
def set_voltage():
    voltage = request.form.get("voltage", type=int)
    if voltage is not None and 0 <= voltage <= 255:
        app.data_store["set_voltage"] = voltage
    return render_template("index.html", set_voltage=app.data_store["set_voltage"])

@app.route('/update_sensor', methods=['POST'])
def update_sensor():
    sensor_value = request.json.get("sensor_value")
    if sensor_value is not None:
        app.data_store["sensor_values"].append(sensor_value)
        if len(app.data_store["sensor_values"]) > 100:  # keep only the last 100 readings
            app.data_store["sensor_values"].pop(0)
    return jsonify(success=True)

@app.route('/get_voltage', methods=['GET'])
def get_voltage():
    return jsonify(set_voltage=app.data_store["set_voltage"])

# New endpoint to retrieve sensor readings and set voltage
@app.route('/get_measurements', methods=['GET'])
def get_measurements():
    return jsonify(
        sensor_values=app.data_store["sensor_values"],
        set_voltage=app.data_store["set_voltage"]
    )

@views.route('/make_plot', methods=['POST'])
def make_plot():
    num_readings = int(request.form.get('num_readings', 100))  # Get the user-defined number of readings
    num_readings = max(5, min(num_readings, 100))  # Ensure it's between 5 and 100

    sensor_values = current_app.data_store["sensor_values"][-num_readings:]  # Get the last N sensor values
    set_voltage = current_app.data_store["set_voltage"]  # Access the current set voltage
    plot_filename = generate_plot(sensor_values, set_voltage)  # Generate the plot
    return {'plot_path': plot_filename}  # Return the plot path as a response


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
