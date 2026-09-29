"use strict";

const BROKER_URL = "wss://9ae4e5d0c13a43c98c4e4b7f730851d9.s1.eu.hivemq.cloud:8884/mqtt";
const TOPIC_WAKE = "domotica/wol/v1/cmd/wake";
const TOPIC_ACK = "domotica/wol/v1/esp32/ack";
const TOPIC_STATUS = "domotica/wol/v1/esp32/status";
const TOPIC_PC_STATUS = "domotica/wol/v1/pc/status";
const TOPIC_PC_ACK = "domotica/wol/v1/pc/ack";
const TOPIC_SHUTDOWN = "domotica/wol/v1/pc/cmd/shutdown";
const DEFAULT_USER = "joel-wol-esp32";
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
const pcValue = $("#pcValue");
const agentValue = $("#agentValue");
const overlay = $("#overlay");
const shutdownOverlay = $("#shutdownOverlay");
const toast = $("#toast");

let client = null;
let pendingWake = null;
let pendingShutdown = null;
let pcOnline = null;
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

function openShutdownConfirm() {
  shutdownOverlay.classList.add("show");
}

function closeShutdownConfirm() {
  shutdownOverlay.classList.remove("show");
}

function renderPowerState() {
  const busy = Boolean(pendingWake || pendingShutdown);
  powerBtn.classList.toggle("shutdown", pcOnline === true && !busy);

  if (busy) {
    powerBtn.disabled = true;
    return;
  }

  if (!lastEspOnline) {
    powerBtn.disabled = true;
    if (loadCredentials().password) heroText.textContent = "ESP32 no disponible";
    return;
  }

  powerBtn.disabled = false;
  if (pcOnline === true) {
    powerBtn.setAttribute("aria-label", "Apagar Joel-PC");
    heroText.textContent = "PC disponible · pulsa para apagar";
  } else if (pcOnline === false) {
    powerBtn.setAttribute("aria-label", "Encender Joel-PC");
    heroText.textContent = "Apagado · pulsa para encender";
  } else {
    powerBtn.setAttribute("aria-label", "Encender Joel-PC");
    heroText.textContent = "Esperando estado de Joel-PC…";
  }
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
  } else {
    setStatus("offline", "ESP32 sin conexión");
    espValue.textContent = "Offline";
  }
  rssiValue.textContent = Number.isFinite(payload.rssi) ? payload.rssi + " dBm" : "—";
  lastSeenValue.textContent = "Ahora";
  renderPowerState();
}

function updatePcStatusView(payload) {
  if (typeof payload.online !== "boolean") return;
  pcOnline = payload.online;
  const version = typeof payload.agentVersion === "string" ? payload.agentVersion : "";
  pcValue.textContent = pcOnline ? "Online" : "Offline";
  if (version) {
    agentValue.textContent = "v" + version + (pcOnline ? " · Online" : " · Sin señal");
  } else {
    agentValue.textContent = pcOnline ? "Online" : "Sin señal";
  }
  renderPowerState();
}

function handleAck(payload) {
  if (!pendingWake || payload.id !== pendingWake.id) return;
  clearTimeout(pendingWake.timer);
  pendingWake = null;
  powerBtn.classList.remove("busy");
  powerBtn.classList.add("success");
  powerBtn.disabled = true;
  heroText.textContent = "Señal de encendido enviada · esperando Joel-PC…";
  showToast("ESP32 ha enviado el Wake-on-LAN a Joel-PC");
  if (navigator.vibrate) navigator.vibrate(35);
  setTimeout(() => {
    powerBtn.classList.remove("success");
    renderPowerState();
  }, 2400);
}

function handlePcAck(payload) {
  if (!pendingShutdown || payload.id !== pendingShutdown.id) return;

  const result = String(payload.result || "");
  if (result === "accepted" || result === "duplicate") {
    clearTimeout(pendingShutdown.timer);
    pendingShutdown = null;
    powerBtn.classList.remove("busy");
    powerBtn.disabled = true;
    heroText.textContent = "Apagado aceptado · esperando a Windows…";
    showToast("Joel-PC ha aceptado la orden de apagado");
    if (navigator.vibrate) navigator.vibrate(35);
    setTimeout(() => {
      if (pcOnline === true && !pendingShutdown) {
        showToast("Joel-PC sigue encendido; el apagado puede haber sido bloqueado", true);
        renderPowerState();
      }
    }, 20000);
    return;
  }

  if (["pc_offline", "agent_unconfigured", "busy", "expired", "failed"].includes(result)) {
    clearTimeout(pendingShutdown.timer);
    pendingShutdown = null;
    powerBtn.classList.remove("busy");
    if (result === "pc_offline") pcOnline = false;
    renderPowerState();
    const messages = {
      pc_offline: "Joel-PC ya no está disponible",
      agent_unconfigured: "El agente de Windows no está configurado",
      busy: "Ya hay otra orden pendiente",
      expired: "La orden de apagado ha caducado",
      failed: "Windows no pudo iniciar el apagado"
    };
    showToast(messages[result] || "No se pudo apagar Joel-PC", true);
  }
}

function onMessage(topic, raw) {
  let payload;
  try { payload = JSON.parse(raw.toString()); } catch (_) { return; }
  if (topic === TOPIC_STATUS) {
    updateStatusView(payload);
    return;
  }
  if (topic === TOPIC_PC_STATUS) {
    updatePcStatusView(payload);
    return;
  }
  if (topic === TOPIC_ACK && payload.result === "sent") {
    handleAck(payload);
    return;
  }
  if (topic === TOPIC_PC_ACK) {
    handlePcAck(payload);
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
    client.subscribe([TOPIC_STATUS, TOPIC_ACK, TOPIC_PC_STATUS, TOPIC_PC_ACK], { qos: 1 }, (err) => {
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
  if (pendingWake || pendingShutdown || pcOnline === true) return;

  const id = randomHex(16);
  const ts = Math.floor(Date.now() / 1000);
  const message = "wake|" + ts + "|" + id;

  powerBtn.disabled = true;
  powerBtn.classList.add("busy");
  heroText.textContent = "Enviando orden remota…";

  client.publish(TOPIC_WAKE, message, { qos: 1, retain: false }, (err) => {
    if (err) {
      powerBtn.classList.remove("busy");
      showToast("No se pudo publicar la orden", true);
      renderPowerState();
      return;
    }

    const timer = setTimeout(() => {
      if (!pendingWake || pendingWake.id !== id) return;
      pendingWake = null;
      powerBtn.classList.remove("busy");
      showToast("La orden se envió, pero no llegó el ACK", true);
      renderPowerState();
    }, 12000);

    pendingWake = { id, timer };
    heroText.textContent = "Esperando confirmación del ESP32…";
  });
}

function sendShutdown() {
  closeShutdownConfirm();
  if (!client || !client.connected || !lastEspOnline || pcOnline !== true) {
    showToast("Joel-PC no está disponible para apagar", true);
    renderPowerState();
    return;
  }
  if (pendingWake || pendingShutdown) return;

  const id = randomHex(16);
  const ts = Math.floor(Date.now() / 1000);
  const message = "shutdown|" + ts + "|" + id;

  powerBtn.disabled = true;
  powerBtn.classList.add("busy");
  heroText.textContent = "Enviando orden de apagado…";

  client.publish(TOPIC_SHUTDOWN, message, { qos: 1, retain: false }, (err) => {
    if (err) {
      powerBtn.classList.remove("busy");
      showToast("No se pudo publicar la orden de apagado", true);
      renderPowerState();
      return;
    }

    const timer = setTimeout(() => {
      if (!pendingShutdown || pendingShutdown.id !== id) return;
      pendingShutdown = null;
      powerBtn.classList.remove("busy");
      showToast("No llegó confirmación de Joel-PC", true);
      renderPowerState();
    }, 12000);

    pendingShutdown = { id, timer };
    heroText.textContent = "Esperando confirmación de Windows…";
  });
}

function handlePowerButton() {
  if (!loadCredentials().password) {
    openSettings();
    return;
  }
  if (pcOnline === true) {
    openShutdownConfirm();
  } else {
    sendWake();
  }
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

$("#confirmShutdownBtn").addEventListener("click", sendShutdown);
$("#cancelShutdownBtn").addEventListener("click", closeShutdownConfirm);
shutdownOverlay.addEventListener("click", (event) => {
  if (event.target === shutdownOverlay) closeShutdownConfirm();
});

$("#forgetBtn").addEventListener("click", () => {
  clearCredentials();
  disconnectClient();
  closeSettings();
  lastEspOnline = false;
  pcOnline = null;
  lastStatusAt = 0;
  setStatus("", "Sin configurar");
  espValue.textContent = "—";
  rssiValue.textContent = "—";
  lastSeenValue.textContent = "—";
  pcValue.textContent = "—";
  agentValue.textContent = "—";
  heroText.textContent = "Configura el acceso remoto";
  showToast("Credenciales eliminadas de este dispositivo");
});

powerBtn.addEventListener("click", handlePowerButton);

setInterval(() => {
  if (!lastStatusAt) return;
  const seconds = Math.floor((Date.now() - lastStatusAt) / 1000);
  lastSeenValue.textContent = seconds < 5 ? "Ahora" : "Hace " + seconds + " s";
  if (seconds > 75 && lastEspOnline) {
    lastEspOnline = false;
    setStatus("offline", "ESP32 sin respuesta");
    espValue.textContent = "Sin respuesta";
    renderPowerState();
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
