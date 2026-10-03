"use strict";

const BROKER_URL = "wss://9ae4e5d0c13a43c98c4e4b7f730851d9.s1.eu.hivemq.cloud:8884/mqtt";
const TOPIC_ESP_STATUS = "domotica/wol/v1/esp32/status";
const TOPIC_PC_WAKE = "domotica/wol/v1/cmd/wake";
const TOPIC_PC_WAKE_ACK = "domotica/wol/v1/esp32/ack";
const TOPIC_PC_STATUS = "domotica/wol/v1/pc/status";
const TOPIC_PC_SHUTDOWN = "domotica/wol/v1/pc/cmd/shutdown";
const TOPIC_PC_ACK = "domotica/wol/v1/pc/ack";
const TOPIC_NAS_WAKE = "domotica/wol/v1/nas/cmd/wake";
const TOPIC_NAS_ACK = "domotica/wol/v1/nas/ack";
const TOPIC_NAS_STATUS = "domotica/wol/v1/nas/status";
const DEFAULT_USER = "joel-wol-esp32";
const STORE_USER = "joelHomeMqttUser";
const STORE_PASS = "joelHomeMqttPass";
const STORE_REMEMBER = "joelHomeRemember";
const STORE_DEVICE = "joelHomeSelectedDevice";

const $ = (s) => document.querySelector(s);
const powerBtn = $("#powerBtn");
const heroTitle = $("#heroTitle");
const heroText = $("#heroText");
const routeText = $("#routeText");
const deviceStatus = $("#deviceStatus");
const statusText = $("#statusText");
const brokerValue = $("#brokerValue");
const espValue = $("#espValue");
const rssiValue = $("#rssiValue");
const lastSeenValue = $("#lastSeenValue");
const pcValue = $("#pcValue");
const nasValue = $("#nasValue");
const agentValue = $("#agentValue");
const pcTabState = $("#pcTabState");
const nasTabState = $("#nasTabState");
const pcTabDot = $("#pcTabDot");
const nasTabDot = $("#nasTabDot");
const overlay = $("#overlay");
const shutdownOverlay = $("#shutdownOverlay");
const toast = $("#toast");

let client = null;
let selectedDevice = localStorage.getItem(STORE_DEVICE) === "nas" ? "nas" : "pc";
let pendingWake = null;
let pendingShutdown = null;
let pcOnline = null;
let nasOnline = null;
let lastStatusAt = 0;
let lastEspOnline = false;
let toastTimer = null;
let installPrompt = null;

powerBtn.disabled = true;

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

function closeSettings() { overlay.classList.remove("show"); }
function openShutdownConfirm() { shutdownOverlay.classList.add("show"); }
function closeShutdownConfirm() { shutdownOverlay.classList.remove("show"); }

function setDot(dot, state) {
  dot.className = "deviceDot" + (state === true ? " online" : state === false ? " offline" : "");
}

function renderTabs() {
  document.querySelectorAll(".deviceTab").forEach(btn => {
    const active = btn.dataset.device === selectedDevice;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  });
  pcTabState.textContent = pcOnline === true ? "Encendido" : pcOnline === false ? "Apagado" : "Esperando estado";
  nasTabState.textContent = nasOnline === true ? "Encendido" : nasOnline === false ? "Apagado" : "Esperando estado";
  pcValue.textContent = pcOnline === true ? "Online" : pcOnline === false ? "Offline" : "—";
  nasValue.textContent = nasOnline === true ? "Online" : nasOnline === false ? "Offline" : "—";
  setDot(pcTabDot, pcOnline);
  setDot(nasTabDot, nasOnline);
}

function renderDevice() {
  renderTabs();
  const creds = loadCredentials();
  const busy = Boolean(pendingWake || pendingShutdown);

  powerBtn.classList.remove("shutdown", "onlineOnly");
  powerBtn.disabled = true;

  if (selectedDevice === "nas") {
    heroTitle.textContent = "NAS";
    routeText.textContent = "Internet · HiveMQ Cloud · ESP32 · NAS";
    if (!creds.password) {
      deviceStatus.className = "status";
      statusText.textContent = "Sin configurar";
      heroText.textContent = "Configura el acceso remoto";
      return;
    }
    if (!lastEspOnline) {
      deviceStatus.className = "status offline";
      statusText.textContent = "ESP32 sin conexión";
      heroText.textContent = "El ESP32 no está disponible";
      return;
    }
    if (busy) {
      deviceStatus.className = "status waiting";
      statusText.textContent = "Procesando";
      return;
    }
    if (nasOnline === true) {
      deviceStatus.className = "status online";
      statusText.textContent = "NAS en línea";
      heroText.textContent = "Encendido y disponible";
      powerBtn.classList.add("onlineOnly");
      powerBtn.setAttribute("aria-label", "NAS encendido");
      return;
    }
    if (nasOnline === false) {
      deviceStatus.className = "status offline";
      statusText.textContent = "NAS apagado";
      heroText.textContent = "Pulsa para encender";
      powerBtn.disabled = false;
      powerBtn.setAttribute("aria-label", "Encender NAS");
      return;
    }
    deviceStatus.className = "status waiting";
    statusText.textContent = "Comprobando NAS";
    heroText.textContent = "Esperando estado del ESP32…";
    return;
  }

  heroTitle.textContent = "Joel-PC";
  routeText.textContent = "Internet · HiveMQ Cloud · ESP32 · Joel-PC";
  if (!creds.password) {
    deviceStatus.className = "status";
    statusText.textContent = "Sin configurar";
    heroText.textContent = "Configura el acceso remoto";
    return;
  }
  if (!lastEspOnline) {
    deviceStatus.className = "status offline";
    statusText.textContent = "ESP32 sin conexión";
    heroText.textContent = "El ESP32 no está disponible";
    return;
  }
  if (busy) {
    deviceStatus.className = "status waiting";
    statusText.textContent = "Procesando";
    return;
  }
  if (pcOnline === true) {
    deviceStatus.className = "status online";
    statusText.textContent = "Joel-PC en línea";
    heroText.textContent = "Pulsa para apagar";
    powerBtn.disabled = false;
    powerBtn.classList.add("shutdown");
    powerBtn.setAttribute("aria-label", "Apagar Joel-PC");
  } else if (pcOnline === false) {
    deviceStatus.className = "status offline";
    statusText.textContent = "Joel-PC apagado";
    heroText.textContent = "Pulsa para encender";
    powerBtn.disabled = false;
    powerBtn.setAttribute("aria-label", "Encender Joel-PC");
  } else {
    deviceStatus.className = "status waiting";
    statusText.textContent = "Comprobando Joel-PC";
    heroText.textContent = "Esperando estado…";
  }
}

function selectDevice(device) {
  if (device !== "pc" && device !== "nas") return;
  selectedDevice = device;
  localStorage.setItem(STORE_DEVICE, device);
  renderDevice();
}

function disconnectClient() {
  if (client) {
    try { client.end(true); } catch (_) {}
  }
  client = null;
  brokerValue.textContent = "Desconectado";
}

function updateEspStatus(payload) {
  lastStatusAt = Date.now();
  lastEspOnline = payload.online === true;
  espValue.textContent = lastEspOnline ? "Online" : "Offline";
  rssiValue.textContent = Number.isFinite(payload.rssi) ? payload.rssi + " dBm" : "—";
  lastSeenValue.textContent = "Ahora";
  renderDevice();
}

function updatePcStatus(payload) {
  if (typeof payload.online !== "boolean") return;
  pcOnline = payload.online;
  const version = typeof payload.agentVersion === "string" ? payload.agentVersion : "";
  agentValue.textContent = version ? "v" + version + (pcOnline ? " · Online" : " · Sin señal") : (pcOnline ? "Online" : "Sin señal");
  renderDevice();
}

function updateNasStatus(payload) {
  if (typeof payload.online !== "boolean") return;
  nasOnline = payload.online;
  renderDevice();
}

function handleWakeAck(payload, target) {
  if (!pendingWake || pendingWake.target !== target || payload.id !== pendingWake.id) return;
  clearTimeout(pendingWake.timer);
  pendingWake = null;
  powerBtn.classList.remove("busy");
  powerBtn.classList.add("success");
  heroText.textContent = "Señal enviada · esperando " + (target === "nas" ? "NAS…" : "Joel-PC…");
  showToast("ESP32 ha enviado Wake-on-LAN a " + (target === "nas" ? "NAS" : "Joel-PC"));
  if (navigator.vibrate) navigator.vibrate(35);
  setTimeout(() => {
    powerBtn.classList.remove("success");
    renderDevice();
  }, 2400);
}

function handlePcAck(payload) {
  if (!pendingShutdown || payload.id !== pendingShutdown.id) return;
  const result = String(payload.result || "");
  if (result === "accepted" || result === "duplicate") {
    clearTimeout(pendingShutdown.timer);
    pendingShutdown = null;
    powerBtn.classList.remove("busy");
    heroText.textContent = "Apagado aceptado · esperando a Windows…";
    showToast("Joel-PC ha aceptado la orden de apagado");
    if (navigator.vibrate) navigator.vibrate(35);
    return;
  }

  if (["pc_offline", "agent_unconfigured", "busy", "expired", "failed"].includes(result)) {
    clearTimeout(pendingShutdown.timer);
    pendingShutdown = null;
    powerBtn.classList.remove("busy");
    if (result === "pc_offline") pcOnline = false;
    const messages = {
      pc_offline: "Joel-PC ya no está disponible",
      agent_unconfigured: "El agente de Windows no está configurado",
      busy: "Ya hay otra orden pendiente",
      expired: "La orden de apagado ha caducado",
      failed: "Windows no pudo iniciar el apagado"
    };
    showToast(messages[result] || "No se pudo apagar Joel-PC", true);
    renderDevice();
  }
}

function onMessage(topic, raw) {
  let payload;
  try { payload = JSON.parse(raw.toString()); } catch (_) { return; }
  if (topic === TOPIC_ESP_STATUS) return updateEspStatus(payload);
  if (topic === TOPIC_PC_STATUS) return updatePcStatus(payload);
  if (topic === TOPIC_NAS_STATUS) return updateNasStatus(payload);
  if (topic === TOPIC_PC_WAKE_ACK && payload.result === "sent") return handleWakeAck(payload, "pc");
  if (topic === TOPIC_NAS_ACK && payload.result === "sent") return handleWakeAck(payload, "nas");
  if (topic === TOPIC_PC_ACK) handlePcAck(payload);
}

function connectController(force = false) {
  const creds = loadCredentials();
  if (!creds.password) {
    brokerValue.textContent = "Sin credencial";
    renderDevice();
    if (force) openSettings();
    return;
  }
  if (client && (client.connected || client.reconnecting)) return;

  disconnectClient();
  brokerValue.textContent = "Conectando";
  lastEspOnline = false;
  renderDevice();

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
    client.subscribe([TOPIC_ESP_STATUS, TOPIC_PC_WAKE_ACK, TOPIC_PC_STATUS, TOPIC_PC_ACK, TOPIC_NAS_STATUS, TOPIC_NAS_ACK], { qos: 1 }, err => {
      if (err) showToast("No se pudo suscribir al estado remoto", true);
    });
  });
  client.on("reconnect", () => { brokerValue.textContent = "Reconectando"; });
  client.on("offline", () => { brokerValue.textContent = "Sin conexión"; });
  client.on("close", () => { brokerValue.textContent = "Desconectado"; });
  client.on("error", err => {
    brokerValue.textContent = "Error";
    showToast(err && err.message ? err.message : "Error MQTT", true);
  });
  client.on("message", onMessage);
}

function sendWake(target) {
  if (!client || !client.connected) {
    showToast("Conectando con HiveMQ…");
    connectController(true);
    return;
  }
  if (!lastEspOnline || pendingWake || pendingShutdown) return;

  const id = randomHex(16);
  const ts = Math.floor(Date.now() / 1000);
  const topic = target === "nas" ? TOPIC_NAS_WAKE : TOPIC_PC_WAKE;
  const message = "wake|" + ts + "|" + id;

  powerBtn.disabled = true;
  powerBtn.classList.add("busy");
  heroText.textContent = "Enviando orden al ESP32…";

  client.publish(topic, message, { qos: 1, retain: false }, err => {
    if (err) {
      powerBtn.classList.remove("busy");
      showToast("No se pudo publicar la orden", true);
      renderDevice();
      return;
    }
    const timer = setTimeout(() => {
      if (!pendingWake || pendingWake.id !== id) return;
      pendingWake = null;
      powerBtn.classList.remove("busy");
      showToast("La orden se envió, pero no llegó el ACK", true);
      renderDevice();
    }, 12000);
    pendingWake = { id, target, timer };
    heroText.textContent = "Esperando confirmación del ESP32…";
  });
}

function sendShutdown() {
  closeShutdownConfirm();
  if (!client || !client.connected || !lastEspOnline || pcOnline !== true || pendingWake || pendingShutdown) {
    showToast("Joel-PC no está disponible para apagar", true);
    renderDevice();
    return;
  }
  const id = randomHex(16);
  const ts = Math.floor(Date.now() / 1000);
  powerBtn.disabled = true;
  powerBtn.classList.add("busy");
  heroText.textContent = "Enviando orden de apagado…";

  client.publish(TOPIC_PC_SHUTDOWN, "shutdown|" + ts + "|" + id, { qos: 1, retain: false }, err => {
    if (err) {
      powerBtn.classList.remove("busy");
      showToast("No se pudo publicar la orden de apagado", true);
      renderDevice();
      return;
    }
    const timer = setTimeout(() => {
      if (!pendingShutdown || pendingShutdown.id !== id) return;
      pendingShutdown = null;
      powerBtn.classList.remove("busy");
      showToast("No llegó confirmación de Joel-PC", true);
      renderDevice();
    }, 12000);
    pendingShutdown = { id, timer };
  });
}

function handlePowerButton() {
  if (!loadCredentials().password) return openSettings();
  if (selectedDevice === "nas") {
    if (nasOnline === false) sendWake("nas");
    return;
  }
  if (pcOnline === true) openShutdownConfirm();
  else if (pcOnline === false) sendWake("pc");
}

document.querySelectorAll(".deviceTab").forEach(btn => btn.addEventListener("click", () => selectDevice(btn.dataset.device)));
powerBtn.addEventListener("click", handlePowerButton);
$("#settingsBtn").addEventListener("click", openSettings);
$("#cancelBtn").addEventListener("click", closeSettings);
overlay.addEventListener("click", e => { if (e.target === overlay) closeSettings(); });
$("#confirmShutdownBtn").addEventListener("click", sendShutdown);
$("#cancelShutdownBtn").addEventListener("click", closeShutdownConfirm);
shutdownOverlay.addEventListener("click", e => { if (e.target === shutdownOverlay) closeShutdownConfirm(); });

$("#settingsForm").addEventListener("submit", event => {
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

$("#forgetBtn").addEventListener("click", () => {
  clearCredentials();
  disconnectClient();
  closeSettings();
  lastEspOnline = false;
  pcOnline = null;
  nasOnline = null;
  lastStatusAt = 0;
  espValue.textContent = "—";
  rssiValue.textContent = "—";
  lastSeenValue.textContent = "—";
  agentValue.textContent = "—";
  renderDevice();
  showToast("Credenciales eliminadas de este dispositivo");
});

setInterval(() => {
  if (!lastStatusAt) return;
  const seconds = Math.floor((Date.now() - lastStatusAt) / 1000);
  lastSeenValue.textContent = seconds < 5 ? "Ahora" : "Hace " + seconds + " s";
  if (seconds > 75 && lastEspOnline) {
    lastEspOnline = false;
    espValue.textContent = "Sin respuesta";
    renderDevice();
  }
}, 5000);

window.addEventListener("beforeinstallprompt", event => {
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
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && (!client || !client.connected)) connectController();
});

renderDevice();
connectController();
