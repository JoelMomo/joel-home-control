# Casa de Joël

PWA estática para encender, ver el estado y solicitar el apagado normal de Joel-PC a través de HiveMQ Cloud y el ESP32 de casa.

## Flujo

```
PWA (HTTPS)
  -> MQTT sobre WSS/TLS
  -> HiveMQ Cloud
  -> MQTT/TLS
  -> ESP32
  -> Wake-on-LAN -> Joel-PC (encendido)
  -> agente local autenticado -> Windows (estado/apagado)
```

## Seguridad

- No contiene contraseñas ni tokens privados en el repositorio.
- La contraseña MQTT se guarda únicamente en el navegador cuando el usuario activa "Recordar".
- Los comandos usan timestamp + nonce aleatorio y esperan ACK del dispositivo que realmente ejecuta la acción.
- El agente de Windows no expone puertos: sondea al ESP32 dentro de la LAN con una clave local de 256 bits.
- No requiere abrir puertos del router.
- La interfaz local del ESP32 sigue disponible como fallback dentro de casa.

## Topics

- `domotica/wol/v1/cmd/wake`
- `domotica/wol/v1/esp32/ack`
- `domotica/wol/v1/esp32/status`
- `domotica/wol/v1/pc/status`
- `domotica/wol/v1/pc/cmd/shutdown`
- `domotica/wol/v1/pc/ack`

## Dependencias

MQTT.js 5.16.0 se distribuye localmente en `vendor/mqtt.min.js` para evitar una dependencia de CDN en runtime.
