# 🎤 Karaoke Sin Delay

Karaoke en grupo por internet donde **todos cantan y se escuchan al mismo tiempo**, sin el delay de Discord.

## Cómo lo logra

Discord agrega 100–300 ms de buffers. Esta app ataca el problema en dos frentes:

1. **La pista de karaoke NO viaja por internet mientras suena.** Cada navegador descarga la canción y la reproduce localmente, programada contra un reloj compartido (sincronización estilo NTP). La música suena en todos con precisión de **menos de 5 ms** (MP3 con Web Audio API) — sincronía perfecta, imposible de lograr transmitiendo audio.
2. **Las voces viajan directo entre usuarios (WebRTC P2P mesh)**, sin pasar por servidor, con Opus configurado en paquetes de 10 ms, jitter buffer en 0 y sin DTX. Resultado típico: **30–80 ms** entre personas de la misma región (Discord suele estar en 150–300 ms).

Nota honesta: el delay cero absoluto no existe por física (la señal viaja a la velocidad de la luz como máximo). Por debajo de ~30 ms el oído lo percibe como simultáneo; entre la misma ciudad/país este sistema se acerca mucho a eso.

## Requisitos para mínima latencia (¡importante!)

- **Audífonos con cable** (los Bluetooth agregan 100–300 ms — los peores enemigos)
- Conexión por **cable ethernet** o WiFi 5 GHz cerca del router
- Chrome o Edge (respetan mejor los ajustes de baja latencia)
- VPS **en el mismo país/región** que los cantantes (solo afecta la sincronía de la pista, no las voces)

## Instalación local (prueba rápida)

```bash
npm install
npm start
# abre http://localhost:3000 en varias pestañas/PCs de tu red
```

El micrófono solo funciona en `localhost` o con HTTPS.

## Despliegue en tu VPS

```bash
# 1. Copia la carpeta al VPS y dentro de ella:
npm install

# 2. Déjalo corriendo con pm2
npm i -g pm2
pm2 start server.js --name karaoke
pm2 save && pm2 startup

# 3. HTTPS obligatorio (el mic no funciona sin él). Lo más fácil: Caddy
sudo apt install -y caddy
```

`/etc/caddy/Caddyfile` (Caddy saca el certificado SSL solo):

```
karaoke.tudominio.com {
    reverse_proxy localhost:3000
}
```

```bash
sudo systemctl reload caddy
```

Listo: entra a `https://karaoke.tudominio.com`, crea una sala con cualquier código y comparte el link + código.

### Si alguien no se conecta (NAT estricto / CGNAT)

Instala un servidor TURN en el mismo VPS:

```bash
sudo apt install -y coturn
# en /etc/turnserver.conf:
#   listening-port=3478
#   user=karaoke:UNACLAVE
#   realm=karaoke.tudominio.com
sudo systemctl enable --now coturn
```

Y en `public/index.html`, dentro de `RTC_CONFIG`, descomenta y ajusta la línea del TURN.

## Uso

1. El primero en entrar con un código de sala es el **anfitrión** (controla la música).
2. El anfitrión sube un MP3 **o** pega un link de YouTube karaoke y pulsa ▶.
3. La pista arranca en todos exactamente al mismo tiempo; las voces van P2P.
4. Cada quien puede ajustar el volumen de la pista, de las voces en conjunto y de cada cantante.
5. **MP3 = sincronía perfecta (<5 ms). YouTube = ~100–200 ms de variación** (suficiente para seguir la letra; para máxima precisión usa MP3).

## Límites y siguiente nivel

- El mesh P2P funciona bien hasta ~8–10 personas (cada quien sube su voz a todos los demás: ~50 kbps × N). La sala admite 12.
- Si crecen a 15+ o hay conexiones débiles, el siguiente paso es un SFU: [LiveKit](https://livekit.io/) self-hosted en tu VPS (un solo binario) mantiene latencias similares centralizando el tráfico. La parte de sincronización de pista de este proyecto se reutiliza igual.
- La "Cancelación de eco" (checkbox) actívala solo si alguien usa parlantes; con audífonos déjala apagada para que la voz suene natural.
