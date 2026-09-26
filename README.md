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
| **El cliente sube su logo y fotos** desde su portal (se validan y se usan en el sitio) | portal del cliente |
| **Revisión**: envías la vista previa, el cliente la **aprueba** o **pide cambios** (se cuentan contra las revisiones del paquete) | portal del cliente |
| **Entrega**: ZIP listo para cualquier hosting; el cliente directo lo descarga **solo cuando pagó el total** | portal y panel |
| **Emails automáticos al cliente**: confirmación del pedido, mensajes, vista previa lista, sitio terminado | `.env` (SMTP) |
| **Publicación con un clic en Netlify** (hosting gratis con HTTPS) | botón “Publicar en Netlify” |
| **Plantilla rápida sin IA** (gratis e instantánea) para tener una primera versión en segundos | botón “Plantilla rápida” |
| Avisos al instante de pedidos, mensajes, cambios y aprobaciones (Telegram, webhook o email) | `.env` |
| **IA**: analizar el pedido (resumen, preguntas faltantes, estructura, extras para vender) | botón “Analizar pedido” |
| **IA**: redactar la respuesta al cliente (respetando las reglas de Fiverr) | botón “Redactar respuesta” |
| **IA**: generar el sitio web completo (HTML responsive listo para entregar), **viendo las fotos del cliente** | botón “Generar con IA” |
| **IA**: aplicar cambios pedidos por el cliente, con historial de versiones | “Aplicar cambios” |
| **IA**: importar un pedido de Fiverr pegando el texto | `/admin/pedidos/nuevo` |
| **IA**: escribir el título, descripción, etiquetas y FAQ de cada gig/tienda | `/admin/tiendas` |
| **Cobro directo sin comisión de plataforma** (PayPal, Mercado Pago, Stripe, transferencia) para clientes de tus tiendas propias: anticipo + saldo, mensaje de cobro listo y registro de pagos | ficha del pedido y portal del cliente |
| Ingresos: ganado neto (descontando comisión de cada canal), cobrado directo y saldo por cobrar | panel principal |
| CLI para que **Claude Code administre el negocio** desde la terminal | `npm run cli` y `CLAUDE.md` |

## Puesta en marcha

Requiere Node.js 22 o superior.

```bash
npm install
cp .env.example .env      # pon ADMIN_PASSWORD y ANTHROPIC_API_KEY
npm start
```

- Tiendas públicas: http://localhost:3000/
- Panel: http://localhost:3000/admin (usuario `admin` y la clave de `ADMIN_PASSWORD`)

La clave de la IA se obtiene en https://console.anthropic.com/. Sin ella todo funciona salvo los botones de IA (la plantilla rápida sí funciona). El modelo por defecto es `claude-opus-5` (se puede cambiar con `AI_MODEL`).

### Probar todo con la simulación

```bash
npm run simulacion
```

Recorre el ciclo completo de dos pedidos con un cliente “de verdad” (por HTTP, como un navegador) y te deja en `simulacion-resultado/` un `INFORME.md` con cada verificación, los sitios generados, el ZIP que descargó la clienta, los emails y los avisos. Si tienes `ANTHROPIC_API_KEY` en `.env` usa **Claude real** (gasta unos pocos dólares de API); con `npm run simulacion -- --offline` usa una API de Claude simulada. Netlify, emails y Telegram siempre se simulan: la simulación nunca contacta a nadie de verdad ni toca tus datos reales.

### Emails al cliente (recomendado)

Sin email, el cliente solo ve tus respuestas si entra a su portal. Configura SMTP en `.env` (con Gmail: `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, tu correo en `SMTP_USER` y una **contraseña de aplicación** en `SMTP_PASS`). Se envían solos: confirmación del pedido con su enlace privado, tus mensajes, “tu vista previa está lista” y “tu sitio está terminado”. Nunca se envían a clientes de marketplaces. Define también `PUBLIC_URL` para que los enlaces de los emails apunten a tu dominio.

### Publicar en Netlify con un clic (opcional)

Crea un token en app.netlify.com → User settings → Applications → Personal access tokens y ponlo en `NETLIFY_TOKEN`. En la ficha del pedido aparece “Publicar en Netlify”: crea el sitio (`negocio-web-0001.netlify.app`) y lo actualiza en cada nueva publicación. Luego el cliente puede conectar su dominio desde Netlify.

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

Además, el bloque `payments` (común a todas las tiendas propias) define cómo te pagan los clientes directos:

```json
"payments": {
  "paypalMe": "tuusuario",                     // genera enlaces paypal.me con el monto exacto
  "links": [{ "label": "Mercado Pago", "url": "https://link.mercadopago.com.ar/tuusuario" }],
  "instructions": "Transferencia: alias TU.ALIAS / CBU ...",
  "depositPercent": 50,                        // anticipo antes de empezar (0 = cobro total)
  "feePercent": 5.4                            // comisión del medio de pago, para calcular tu neto
}
```

Para ofrecer **Discord** como canal de comunicación a tus clientes directos, completa el bloque `contact`:

```json
"contact": { "discordInvite": "https://discord.gg/tu-invitacion", "discordUser": "tuusuario" }
```

El portal del cliente muestra el botón “Unirme a Discord” y la IA puede ofrecerlo en sus mensajes, **solo en pedidos de tiendas propias o contacto directo** (nunca en Fiverr u otros marketplaces, cuyos sistemas detectan y sancionan estos intentos). El formulario de pedido también pide el usuario de Discord del cliente (opcional).

Reinicia el servidor después de editarlo.

## Cobrar sin comisión de plataforma

Con los clientes que llegan **por tus tiendas propias o por contacto directo** (redes sociales, Google, recomendados) cobras directo por PayPal, Mercado Pago, etc. y te quedas con casi todo (solo la comisión del medio de pago, ~3-5 %, en vez del 20 % de Fiverr):

1. En la ficha del pedido pulsa **“Preparar mensaje de cobro”**: arma el mensaje con el monto del anticipo (o del saldo) y tus enlaces de pago, listo para enviar por el portal, WhatsApp o email.
2. El cliente también ve un botón **Pagar** en su portal con el monto exacto.
3. Cuando recibes el dinero, **“Registrar pago recibido”**. El panel muestra lo cobrado y el saldo pendiente.

**Los clientes que te contratan por Fiverr, Workana, Upwork u otro marketplace pagan siempre dentro de esa plataforma.** Pedirles que paguen por PayPal para saltarte la comisión viola sus reglas y es causa habitual de suspensión permanente de la cuenta (pierdes reseñas, nivel y dinero pendiente). Por eso el sistema nunca muestra enlaces de pago externos en esos pedidos, y la IA no los propone aunque el cliente lo pida. La estrategia sana es usar los marketplaces para conseguir reseñas y portafolio, y hacer crecer en paralelo tus tiendas propias, donde cobras sin comisión.

## Marketplaces recomendados (además de Fiverr)

Comisiones aproximadas para el vendedor en 2026 (cambian a menudo: verifícalas antes de registrarte). Puedes tener un perfil en cada una: son empresas distintas.

| Plataforma | Comisión aprox. | Por qué te sirve |
|---|---|---|
| **Workana** | 5-20 % | La más grande de Latinoamérica; clientes en español |
| **Upwork** | 0-15 % variable por contrato (≈10 % en promedio) | Clientes de EE. UU./Europa que pagan más; muchos proyectos web |
| **Contra** | 0 % | Sin comisión; ideal como portafolio y para cobrar a clientes que tú consigues |
| **Freelancer.com** | ~10 % | Muy usada en Argentina, Colombia, México |
| **Malt** | ~10 % | Fuerte en España y Europa |
| **PeoplePerHour** | hasta 20 %, baja con el volumen por cliente | Reino Unido y Europa; ofertas tipo “paquete” como Fiverr |
| **99designs** | 10-15 % | Especializada en diseño (logos, marcas, diseño web) |
| **Toptal** | 0 % al freelancer | Proyectos muy bien pagados, pero solo acepta ~3 % de postulantes |

Los canales Workana, Upwork, Freelancer.com, PeoplePerHour, Malt y Contra ya existen en el panel (con su comisión automática en `src/config.js` → `CHANNEL_FEES`).

## Flujo de trabajo diario

1. **Llega un pedido** → te avisa (Telegram/email) y al cliente le llega un email con su enlace privado.
   - Tienda propia: se registra solo. El cliente sube su logo y fotos desde su portal.
   - Fiverr: en *Nuevo pedido* pega el texto del pedido y la IA rellena los datos. Los archivos que te mande por Fiverr los subes tú en la ficha.
2. **Analizar pedido** → la IA te dice qué falta preguntar y propone la estructura.
3. **Redactar respuesta** → revisas, ajustas y envías. Estado: *Contactado*.
4. **Cobrar el anticipo** (clientes directos) → “Preparar mensaje de cobro” y, cuando llegue, “Registrar pago recibido”.
5. **Generar el sitio** con IA (o la plantilla rápida). Solo tú lo ves hasta que pulsas **“Enviar vista previa al cliente”**. Estado: *En revisión*.
6. El cliente **aprueba** o **pide cambios** desde su portal. Los cambios te llegan precargados → **Aplicar cambios** con IA → nueva versión → vuelves a enviarla.
7. **Publicar en Netlify** (opcional) y **Entregar**: el cliente recibe el email “tu sitio está terminado”; puede descargar el ZIP cuando haya pagado el total. En Fiverr: descarga el ZIP del panel y súbelo en la entrega del pedido.
8. Marca *Completado* cuando todo esté cobrado.

## Administrar con Claude Code

El archivo `CLAUDE.md` le explica a Claude Code cómo operar el negocio. Abre Claude Code **en la máquina donde corre el sistema** (los datos de clientes están en `data/` y `sites/`, que no se suben al repositorio) y pídele cosas como:

- “¿Qué pedidos tengo pendientes?”
- “Prepara la respuesta para WEB-0007 pidiéndole las fotos del local”
- “Genera el sitio de WEB-0003 y mejora la sección de precios a mano”
- “Aplica estos cambios que pidió el cliente en Fiverr: …”

Comandos de la CLI: `npm run cli -- ayuda`.

## Reglas importantes de Fiverr

- **No se cobra por fuera.** Todo cliente que te conoció en Fiverr paga por Fiverr (ver “Cobrar sin comisión de plataforma”).
- **Una sola cuenta de vendedor por persona.** Abrir varias cuentas de Fiverr puede hacer que te las cierren todas. Para tener “varias tiendas” en Fiverr crea **varios gigs** en tu cuenta (uno por nicho: restaurantes, profesionales, landing pages, e-commerce…; el número de gigs activos depende de tu nivel de vendedor) y usa las **tiendas propias** de este sistema y otras plataformas (Workana, Upwork…) como canales adicionales.
- **La comunicación de clientes de Fiverr debe quedarse en Fiverr.** No pidas email, WhatsApp ni Discord (Fiverr detecta esas palabras en el chat y puede advertirte o suspenderte). Por eso, en pedidos de Fiverr el panel no ofrece WhatsApp/email ni enlaces de pago: registras la conversación aquí, usas la IA para redactar y envías por el chat de Fiverr. La IA ya tiene esta regla incorporada.
- Fiverr no ofrece una API pública para vendedores, por eso los pedidos de Fiverr se importan pegando el texto (la IA extrae los datos).

## Publicar el sistema en internet

**Opción fácil: Render** (render.com). El repositorio incluye `render.yaml`: en Render elige *New → Blueprint*, conecta este repositorio y completa las variables que te pida (`PUBLIC_URL`, `ANTHROPIC_API_KEY`, SMTP…). Crea el servidor con un disco persistente de 1 GB (requiere el plan Starter, unos USD 7/mes más el disco). La contraseña del panel (`ADMIN_PASSWORD`) se genera sola: la ves en *Environment*.

**Con Docker** (cualquier VPS):

```bash
docker build -t conexion-servicio .
docker run -d --restart unless-stopped -p 3000:3000 --env-file .env -v conexion-datos:/datos conexion-servicio
```

En todos los casos:
- **Necesitas un disco persistente** para los datos (`DATA_DIR` y `SITES_DIR`; en Docker ya apuntan al volumen `/datos`). Sin él, los pedidos se pierden en cada reinicio.
- Usa HTTPS (el panel usa autenticación básica) y una contraseña fuerte. Define `PUBLIC_URL` con tu dominio.
- Copias de seguridad: `npm run cli -- respaldo` genera un ZIP con todos los pedidos y sitios.

## Estructura

```
config/stores.json   Tiendas, paquetes y precios
src/server.js        Servidor web (tiendas públicas, portal del cliente y panel)
src/views.js         Páginas HTML
src/db.js            Base de datos (data/db.json)
src/ai.js            Integración con Claude
src/payments.js      Cobros directos (PayPal, Mercado Pago...) y estado de pagos
src/flows.js         Acciones del negocio (pedido, mensajes, vista previa, aprobación, cambios, entrega)
src/sites.js         Versiones de los sitios y archivos del cliente (sites/<ID>/, sites/<ID>/assets/)
src/templates.js     Plantilla rápida sin IA
src/mailer.js        Emails al cliente (SMTP)
src/deploy.js        Publicación en Netlify
src/zip.js           Generador de ZIP para las entregas
src/notify.js        Avisos por Telegram / webhook
src/cli.js           Línea de comandos para administrar (y para Claude Code)
scripts/simulacion.js  Simulación completa del negocio (npm run simulacion)
test/                Pruebas (npm test; incluye la simulación)
```
