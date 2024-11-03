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

@app.route('/make_plot', methods=['POST'])
def make_plot():
    from views import generate_plot  # Import the plot generation function
    plot_path = generate_plot(app.data_store["sensor_values"], app.data_store["set_voltage"])
    return jsonify(plot_path=plot_path)  # Return the path to the plot image

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
