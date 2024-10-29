from flask import Flask
from flask import Flask, request, jsonify

app = Flask(__name__)

# Store the set voltage
set_voltage = 500  # initial value

@app.route("/")
def home() :
    return "this is home page"



if __name__ == '__main__':
    app.run(debug=True, port=8000)



    @app.route('/set_voltage', methods=['POST'])
    def set_voltage_endpoint():
        global set_voltage
        data = request.get_json()
        new_voltage = data.get('voltage')

        if new_voltage is not None and 0 <= new_voltage <= 3300:
            set_voltage = new_voltage
            return jsonify({"status": "success", "set_voltage": set_voltage}), 200
        return jsonify({"status": "error", "message": "Invalid voltage value"}), 400


    if __name__ == '__main__':
        app.run(host='0.0.0.0', port=80)
