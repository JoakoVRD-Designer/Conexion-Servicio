# Conexión Servicio

Sistema para vender el servicio de **creación de páginas web** desde varias tiendas a la vez (Fiverr + tiendas web propias por nicho) y gestionarlo todo desde un solo panel, con **IA (Claude)** que te ayuda a administrar los pedidos, redactar mensajes, generar los sitios y aplicar los cambios que pide el cliente.

```
 Tiendas públicas (/s/...)  ─┐
 Pedidos de Fiverr (import) ─┼─►  Panel /admin  ─►  IA: analiza, redacta, genera y modifica la web
 WhatsApp / Workana / otros ─┘        │                     │
                                      ▼                     ▼
                           Portal del cliente (/o/...)   sites/WEB-0001/index.html  → entregas
```

## Qué hace

| Función | Dónde |
|---|---|
| Varias tiendas, cada una con su nicho, colores, paquetes y precios | `config/stores.json` → páginas públicas en `/s/<slug>` |
| Formulario de pedido en tus tiendas propias (con enlace de pago por paquete) | `/s/<slug>` |
| Ver **quién pidió qué**: cliente, contacto, brief, paquete, precio, canal | `/admin` y `/admin/pedidos/<ID>` |
| Comunicarte con el cliente: portal con chat, botones de WhatsApp/email con el mensaje ya escrito, enlace al chat de Fiverr | ficha del pedido |
| Avisos al instante de pedidos y mensajes nuevos (Telegram o webhook) | `.env` |
| **IA**: analizar el pedido (resumen, preguntas faltantes, estructura, extras para vender) | botón “Analizar pedido” |
| **IA**: redactar la respuesta al cliente (respetando las reglas de Fiverr) | botón “Redactar respuesta” |
| **IA**: generar el sitio web completo (HTML responsive listo para entregar) | botón “Generar el sitio web” |
| **IA**: aplicar cambios pedidos por el cliente, con historial de versiones | “Aplicar cambios” |
| **IA**: importar un pedido de Fiverr pegando el texto | `/admin/pedidos/nuevo` |
| **IA**: escribir el título, descripción, etiquetas y FAQ de cada gig/tienda | `/admin/tiendas` |
| Ingresos: ganado neto (descontando comisión de cada canal) y por cobrar | panel principal |
| CLI para que **Claude Code administre el negocio** desde la terminal | `npm run cli` y `CLAUDE.md` |

## Puesta en marcha

Requiere Node.js 20 o superior.

```bash
npm install
cp .env.example .env      # pon ADMIN_PASSWORD y ANTHROPIC_API_KEY
npm start
```

- Tiendas públicas: http://localhost:3000/
- Panel: http://localhost:3000/admin (usuario `admin` y la clave de `ADMIN_PASSWORD`)

La clave de la IA se obtiene en https://console.anthropic.com/. Sin ella todo funciona salvo los botones de IA. El modelo por defecto es `claude-opus-5` (se puede cambiar con `AI_MODEL`).

### Avisos al celular (recomendado)

1. En Telegram habla con `@BotFather`, crea un bot y copia el token → `TELEGRAM_BOT_TOKEN`.
2. Escríbele cualquier cosa a tu bot y abre `https://api.telegram.org/bot<TOKEN>/getUpdates` para ver tu `chat.id` → `TELEGRAM_CHAT_ID`.

También puedes usar `NOTIFY_WEBHOOK_URL` (Slack, Discord, Make, Zapier…).

## Configurar tus tiendas

Edita `config/stores.json`. Cada tienda tiene:

- `id`, `slug` (URL pública `/s/<slug>`), `name`, `tagline`, `niche`, `accent` (color)
- `channel`: `fiverr` (la página pública solo muestra el enlace al gig) o `web` (tienda propia con formulario)
- `externalUrl`: enlace a tu gig de Fiverr
- `feePercent`: comisión del canal (Fiverr 20 %, pasarela de pago ~5 %) para calcular tu ganancia neta
- `packages`: paquetes con `price`, `deliveryDays`, `revisions`, `features` y `paymentLink` opcional (Mercado Pago, PayPal, Stripe…) que ve el cliente en su portal

Reinicia el servidor después de editarlo.

## Flujo de trabajo diario

1. **Llega un pedido** → te avisa por Telegram.
   - Tienda propia: se registra solo.
   - Fiverr: en *Nuevo pedido* pega el texto del pedido y la IA rellena los datos.
2. **Analizar pedido** → la IA te dice qué falta preguntar y propone la estructura.
3. **Redactar respuesta** → revisas, ajustas y envías (portal del cliente / WhatsApp / chat de Fiverr). Estado: *Contactado*.
4. **Generar el sitio web** → vista previa para ti y para el cliente (en su portal). Estado: *En revisión*.
5. El cliente pide cambios → **Aplicar cambios** con IA (cada cambio es una versión nueva, puedes volver a cualquiera).
6. **Descargar index.html** y entregarlo (o publicarlo en Netlify / Vercel / GitHub Pages / hosting del cliente). Estado: *Entregado* → *Completado* cuando cobras.

## Administrar con Claude Code

El archivo `CLAUDE.md` le explica a Claude Code cómo operar el negocio. Abre Claude Code **en la máquina donde corre el sistema** (los datos de clientes están en `data/` y `sites/`, que no se suben al repositorio) y pídele cosas como:

- “¿Qué pedidos tengo pendientes?”
- “Prepara la respuesta para WEB-0007 pidiéndole las fotos del local”
- “Genera el sitio de WEB-0003 y mejora la sección de precios a mano”
- “Aplica estos cambios que pidió el cliente en Fiverr: …”

Comandos de la CLI: `npm run cli -- ayuda`.

## Reglas importantes de Fiverr

- **Una sola cuenta de vendedor por persona.** Abrir varias cuentas de Fiverr puede hacer que te las cierren todas. Para tener “varias tiendas” en Fiverr crea **varios gigs** en tu cuenta (uno por nicho: restaurantes, profesionales, landing pages, e-commerce…; el número de gigs activos depende de tu nivel de vendedor) y usa las **tiendas propias** de este sistema y otras plataformas (Workana, Upwork…) como canales adicionales.
- **La comunicación y los pagos de clientes de Fiverr deben quedarse en Fiverr.** No pidas email/WhatsApp ni cobres por fuera. Por eso, en pedidos de Fiverr el panel no ofrece WhatsApp/email: registras la conversación aquí, usas la IA para redactar y envías por el chat de Fiverr. La IA ya tiene esta regla incorporada.
- Fiverr no ofrece una API pública para vendedores, por eso los pedidos de Fiverr se importan pegando el texto (la IA extrae los datos).

## Publicar el sistema en internet

Cualquier hosting de Node.js sirve (Render, Railway, Fly.io, un VPS…):

- Comando de inicio: `npm start`. Variables: las de `.env.example` (`TRUST_PROXY=1` y `PUBLIC_URL` si hay proxy/dominio).
- **Necesitas un disco persistente** montado para `data/` y `sites/` (o usa `DATA_DIR` y `SITES_DIR` para apuntar a él). Sin disco persistente, los pedidos se pierden en cada reinicio.
- Usa HTTPS (el panel usa autenticación básica) y una contraseña fuerte.
- Haz copias de seguridad de `data/db.json` y `sites/`.

## Estructura

```
config/stores.json   Tiendas, paquetes y precios
src/server.js        Servidor web (tiendas públicas, portal del cliente y panel)
src/views.js         Páginas HTML
src/db.js            Base de datos (data/db.json)
src/ai.js            Integración con Claude
src/sites.js         Versiones de los sitios generados (sites/<ID>/)
src/notify.js        Avisos por Telegram / webhook
src/cli.js           Línea de comandos para administrar (y para Claude Code)
test/                Pruebas (npm test)
```
