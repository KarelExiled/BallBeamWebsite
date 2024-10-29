from flask import Flask, request, jsonify, render_template

app = Flask(__name__)

# Variable to store the current position of the ball
ball_position = {"position": 0}


@app.route("/update", methods=["POST"])
def update():
    """
    This endpoint receives data from the ESP32.
    It expects a JSON payload with a "position" field.
    """
    global ball_position
    data = request.get_json()

    # Check if the data contains the "position" key
    if "position" in data:
        # Update the ball position
        ball_position["position"] = data["position"]
        return jsonify({"status": "success"}), 200
    else:
        # If the "position" key is missing, return an error
        return jsonify({"status": "error", "message": "Position not provided"}), 400


@app.route("/get-data", methods=["GET"])
def get_data():
    """
    This endpoint provides the latest ball position for the frontend.
    It returns the data as JSON.
    """
    return jsonify(ball_position)


@app.route("/")
def index():
    """
    This endpoint serves the main HTML page.
    """
    return render_template("index.html")


if __name__ == "__main__":
    # Run the Flask application on port 5000 for local testing
    app.run(host="0.0.0.0", port=5000)
