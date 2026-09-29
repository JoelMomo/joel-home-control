"use strict";

const BROKER_URL = "wss://9ae4e5d0c13a43c98c4e4b7f730851d9.s1.eu.hivemq.cloud:8884/mqtt";
const TOPIC_WAKE = "domotica/wol/v1/cmd/wake";
const TOPIC_ACK = "domotica/wol/v1/esp32/ack";
const TOPIC_STATUS = "domotica/wol/v1/esp32/status";
const DEFAULT_USER = "joel-wol-controller";
const STORE_USER = "joelHomeMqttUser";
const STORE_PASS = "joelHomeMqttPass";
const STORE_REMEMBER = "joelHomeRemember";

const $ = (s) => document.querySelector(s);
const powerBtn = $("#powerBtn");
const heroText = $("#heroText");
const espStatus = $("#espStatus");
const statusText = $("#statusText");
const brokerValue = $("#brokerValue");
const espValue = $("#espValue");
const rssiValue = $("#rssiValue");
const lastSeenValue = $("#lastSeenValue");
const overlay = $("#overlay");
const toast = $("#toast");

let client = null;
let pendingWake = null;
let lastStatusAt = 0;
let lastEspOnline = false;
let toastTimer = null;
let installPrompt = null;

function randomHex(bytes = 16) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return Array.from(data, b => b.toString(16).padStart(2, "0")).join("");
}

function showToast(message, error = false) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = "toast show" + (error ? " error" : "");
  toastTimer = setTimeout(() => { toast.className = "toast"; }, 2800);
}

function setStatus(mode, text) {
  espStatus.className = "status " + mode;
  statusText.textContent = text;
}

function loadCredentials() {
  const remember = localStorage.getItem(STORE_REMEMBER) === "1";
  const store = remember ? localStorage : sessionStorage;
  return {
    username: store.getItem(STORE_USER) || DEFAULT_USER,
    password: store.getItem(STORE_PASS) || "",
    remember
  };
}

function saveCredentials(username, password, remember) {
  localStorage.removeItem(STORE_USER);
  localStorage.removeItem(STORE_PASS);
  sessionStorage.removeItem(STORE_USER);
  sessionStorage.removeItem(STORE_PASS);
  localStorage.setItem(STORE_REMEMBER, remember ? "1" : "0");
  const store = remember ? localStorage : sessionStorage;
  store.setItem(STORE_USER, username);
  store.setItem(STORE_PASS, password);
}

function clearCredentials() {
  localStorage.removeItem(STORE_USER);
  localStorage.removeItem(STORE_PASS);
  localStorage.removeItem(STORE_REMEMBER);
  sessionStorage.removeItem(STORE_USER);
  sessionStorage.removeItem(STORE_PASS);
}

function openSettings() {
  const creds = loadCredentials();
  $("#username").value = creds.username;
  $("#password").value = creds.password;
  $("#remember").checked = creds.remember || !creds.password;
  overlay.classList.add("show");
  setTimeout(() => $("#password").focus(), 80);
}

function closeSettings() {
  overlay.classList.remove("show");
}

function disconnectClient() {
  if (client) {
    try { client.end(true); } catch (_) {}
  }
  client = null;
  brokerValue.textContent = "Desconectado";
}

function updateStatusView(payload) {
  lastStatusAt = Date.now();
  lastEspOnline = payload.online === true;
  if (lastEspOnline) {
    setStatus("online", "ESP32 en línea");
    espValue.textContent = "Online";
    heroText.textContent = "Listo para encender";
  } else {
    setStatus("offline", "ESP32 sin conexión");
    espValue.textContent = "Offline";
    heroText.textContent = "ESP32 no disponible";
  }
  rssiValue.textContent = Number.isFinite(payload.rssi) ? payload.rssi + " dBm" : "—";
  lastSeenValue.textContent = "Ahora";
}

function handleAck(payload) {
  if (!pendingWake || payload.id !== pendingWake.id) return;
  clearTimeout(pendingWake.timer);
  pendingWake = null;
  powerBtn.disabled = false;
  powerBtn.classList.remove("busy");
  powerBtn.classList.add("success");
  heroText.textContent = "Señal de encendido enviada";
  showToast("ESP32 ha enviado el Wake-on-LAN a Joel-PC");
  if (navigator.vibrate) navigator.vibrate(35);
  setTimeout(() => {
    powerBtn.classList.remove("success");
    if (lastEspOnline) heroText.textContent = "Listo para encender";
  }, 2400);
}

function onMessage(topic, raw) {
  let payload;
  try { payload = JSON.parse(raw.toString()); } catch (_) { return; }
  if (topic === TOPIC_STATUS) {
    updateStatusView(payload);
    return;
  }
  if (topic === TOPIC_ACK && payload.result === "sent") {
    handleAck(payload);
  }
}

function connectController(force = false) {
  const creds = loadCredentials();
  if (!creds.password) {
    setStatus("", "Sin configurar");
    heroText.textContent = "Configura el acceso remoto";
    brokerValue.textContent = "Sin credencial";
    if (force) openSettings();
    return;
  }
  if (client && (client.connected || client.reconnecting)) return;

  disconnectClient();
  setStatus("waiting", "Conectando…");
  brokerValue.textContent = "Conectando";
  heroText.textContent = "Conectando con casa…";

  client = mqtt.connect(BROKER_URL, {
    username: creds.username,
    password: creds.password,
    clientId: "joel-home-ui-" + randomHex(8),
    clean: true,
    protocolVersion: 4,
    connectTimeout: 10000,
    reconnectPeriod: 5000,
    keepalive: 30,
    resubscribe: true
  });

  client.on("connect", () => {
    brokerValue.textContent = "Conectado";
    setStatus("waiting", "Esperando ESP32…");
    heroText.textContent = "Esperando estado de casa…";
    client.subscribe([TOPIC_STATUS, TOPIC_ACK], { qos: 1 }, (err) => {
      if (err) showToast("No se pudo suscribir al estado remoto", true);
    });
  });

  client.on("reconnect", () => {
    brokerValue.textContent = "Reconectando";
    if (!lastEspOnline) setStatus("waiting", "Reconectando…");
  });

  client.on("offline", () => {
    brokerValue.textContent = "Sin conexión";
  });

  client.on("close", () => {
    brokerValue.textContent = "Desconectado";
  });

  client.on("error", (err) => {
    const detail = err && err.message ? err.message : "Error MQTT desconocido";
    brokerValue.textContent = "Error";
    setStatus("offline", "Error de acceso");
    heroText.textContent = detail;
    showToast(detail, true);
    console.error("MQTT error:", err);
  });

  client.on("message", onMessage);
}

function sendWake() {
  const creds = loadCredentials();
  if (!creds.password) {
    openSettings();
    return;
  }
  if (!client || !client.connected) {
    showToast("Conectando con HiveMQ…");
    connectController(true);
    return;
  }
  if (pendingWake) return;

  const id = randomHex(16);
  const ts = Math.floor(Date.now() / 1000);
  const message = "wake|" + ts + "|" + id;

  powerBtn.disabled = true;
  powerBtn.classList.add("busy");
  heroText.textContent = "Enviando orden remota…";

  client.publish(TOPIC_WAKE, message, { qos: 1, retain: false }, (err) => {
    if (err) {
      powerBtn.disabled = false;
      powerBtn.classList.remove("busy");
      heroText.textContent = "No se pudo enviar";
      showToast("No se pudo publicar la orden", true);
      return;
    }

    const timer = setTimeout(() => {
      if (!pendingWake || pendingWake.id !== id) return;
      pendingWake = null;
      powerBtn.disabled = false;
      powerBtn.classList.remove("busy");
      heroText.textContent = "Sin confirmación del ESP32";
      showToast("La orden se envió, pero no llegó el ACK", true);
    }, 12000);

    pendingWake = { id, timer };
    heroText.textContent = "Esperando confirmación del ESP32…";
  });
}

$("#settingsForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const username = $("#username").value.trim();
  const password = $("#password").value;
  const remember = $("#remember").checked;
  if (!username || !password) return;
  saveCredentials(username, password, remember);
  closeSettings();
  disconnectClient();
  showToast("Credencial guardada en este navegador");
  connectController();
});

$("#settingsBtn").addEventListener("click", openSettings);
$("#cancelBtn").addEventListener("click", closeSettings);
overlay.addEventListener("click", (event) => {
  if (event.target === overlay) closeSettings();
});

$("#forgetBtn").addEventListener("click", () => {
  clearCredentials();
  disconnectClient();
  closeSettings();
  lastEspOnline = false;
  lastStatusAt = 0;
  setStatus("", "Sin configurar");
  espValue.textContent = "—";
  rssiValue.textContent = "—";
  lastSeenValue.textContent = "—";
  heroText.textContent = "Configura el acceso remoto";
  showToast("Credenciales eliminadas de este dispositivo");
});

powerBtn.addEventListener("click", sendWake);

setInterval(() => {
  if (!lastStatusAt) return;
  const seconds = Math.floor((Date.now() - lastStatusAt) / 1000);
  lastSeenValue.textContent = seconds < 5 ? "Ahora" : "Hace " + seconds + " s";
  if (seconds > 75 && lastEspOnline) {
    lastEspOnline = false;
    setStatus("offline", "ESP32 sin respuesta");
    espValue.textContent = "Sin respuesta";
    heroText.textContent = "ESP32 no disponible";
  }
}, 5000);

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  $("#installBtn").hidden = false;
});

$("#installBtn").addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $("#installBtn").hidden = true;
});

window.addEventListener("appinstalled", () => {
  showToast("Casa de Joël instalada");
  $("#installBtn").hidden = true;
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && (!client || !client.connected)) {
    connectController();
  }
});

connectController();
