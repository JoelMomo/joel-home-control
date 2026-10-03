# Casa de Joël

PWA estática para controlar de forma remota los dispositivos de casa a través del ESP32 de Wake-on-LAN.

## Dispositivos

- **Joel-PC**: estado, encendido mediante Wake-on-LAN y solicitud de apagado normal mediante el agente de Windows.
- **NAS**: estado comprobado por el ESP32 y encendido mediante Wake-on-LAN. El apagado remoto se incorporará cuando el NAS tenga su configuración definitiva.

## Flujo

```
PWA (HTTPS)
  -> MQTT sobre WSS/TLS
  -> HiveMQ Cloud
  -> MQTT/TLS
  -> ESP32
      -> Wake-on-LAN -> Joel-PC
      -> Wake-on-LAN -> NAS
      -> ping LAN -> estado NAS
      -> agente local autenticado -> estado/apagado Joel-PC
```

## Seguridad

- No contiene contraseñas ni tokens privados en el repositorio.
- La contraseña MQTT se guarda únicamente en el navegador cuando el usuario activa "Recordar".
- Los comandos usan timestamp + nonce aleatorio y esperan ACK del dispositivo que ejecuta la acción.
- El agente de Windows no expone puertos.
- No requiere abrir puertos del router.
- La interfaz local del ESP32 permanece disponible como fallback dentro de casa.

## Topics

### Infraestructura
- `domotica/wol/v1/esp32/status`

### Joel-PC
- `domotica/wol/v1/cmd/wake`
- `domotica/wol/v1/esp32/ack`
- `domotica/wol/v1/pc/status`
- `domotica/wol/v1/pc/cmd/shutdown`
- `domotica/wol/v1/pc/ack`

### NAS
- `domotica/wol/v1/nas/cmd/wake`
- `domotica/wol/v1/nas/ack`
- `domotica/wol/v1/nas/status`

## Dependencias

MQTT.js 5.16.0 se distribuye localmente en `vendor/mqtt.min.js` para evitar una dependencia de CDN en runtime.
