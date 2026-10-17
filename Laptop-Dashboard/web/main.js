// Entry script: define the web components, then start the app logic.
// No cache-busting query strings: the server sends no-store, and a "?v=" on
// app.js would load a second copy alongside gamepad.js's import of it.

import "./components/connection-bar.js";
import "./components/video-panel.js";
import "./components/arena-panel.js";
import "./components/rover-visual-panel.js";
import "./components/estop-panel.js";
import "./components/bandwidth-panel.js";
import "./components/wheel-card.js";
import "./components/controller-panel.js";

import "./app.js";
import "./gamepad.js";
