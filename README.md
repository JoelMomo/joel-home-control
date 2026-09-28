# Casa de Joël

PWA estática para enviar Wake-on-LAN a Joel-PC a través de HiveMQ Cloud y el ESP32 de casa.

## Flujo

```
PWA (HTTPS)
  -> MQTT sobre WSS/TLS
  -> HiveMQ Cloud
  -> MQTT/TLS
  -> ESP32
  -> Wake-on-LAN
  -> Joel-PC
```

## Seguridad

- No contiene contraseñas ni tokens privados en el repositorio.
- La PWA solicita una credencial MQTT exclusiva del controlador.
- La contraseña se guarda únicamente en el navegador cuando el usuario activa "Recordar".
- El comando WoL usa timestamp + nonce aleatorio y espera un ACK del ESP32.
- No requiere abrir puertos del router.
- La interfaz local del ESP32 sigue disponible como fallback dentro de casa.

## Topics

- `domotica/wol/v1/cmd/wake`
- `domotica/wol/v1/esp32/ack`
- `domotica/wol/v1/esp32/status`

## Dependencias

MQTT.js 5.16.0 se distribuye localmente en `vendor/mqtt.min.js` para evitar una dependencia de CDN en runtime.
