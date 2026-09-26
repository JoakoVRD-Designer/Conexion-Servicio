# Plan de trabajo — 27 de septiembre de 2026

Objetivo del día: dejar la **demo de DORN AGRO** lista para mostrar a clientes y actualizar con ella el portafolio de las tiendas.

## 0. Antes de empezar (10 min)

- [ ] Abrir la sesión con **acceso de escritura** a `JoakoVRD-Designer/dorn-agro` (ayer solo había lectura).
- [ ] Confirmar la **dirección publicada** de DORN AGRO (se asumió `https://joakovrd-designer.github.io/dorn-agro/`; se cambia en `config/stores.json` → `portfolio[0].url`).
- [ ] Ubicar el **firmware del ESP32** (¿`DORN-CODE`?) y el script `tools/crear-secuencia.mjs` (el código lo menciona pero no está en `dorn-agro`).
- [ ] Decidir si se prueba con **la placa real** o solo con el simulador.

## 1. Demo de DORN AGRO (prioridad)

**Problema actual:** “Probar sin cuenta (demo)” abre un panel vacío (“Sin señal”, sensores en “—”), porque la demo se conecta a un broker MQTT público esperando un equipo real. Con el simulador integrado activado se ve perfecta, pero viene apagado.

- [ ] En modo demo, usar automáticamente **transporte local + simulador integrado** (`auth.js` → `entrarDemo`, `app.js` → `conectarEquipo`), sin tocar los ajustes guardados de los usuarios con cuenta.
- [ ] Aviso visible: “Estás viendo una demostración con un equipo simulado” + botón para crear cuenta.
- [ ] Recorrido que se entienda solo: el suelo se seca → aparece la alerta → el agente de riego enciende la bomba → se confirma. Que funcione **sin claves de IA** (IA base).
- [ ] Subir la versión del service worker (`sw.js`: `dornagro-v6` → `v7`) en cada publicación.

**Cómo verificamos que quedó bien**
- Panel “En línea · simulado” en menos de 3 s, en escritorio y en celular (390 px), sin errores en la consola.
- Encender/Apagar confirma en el momento; los gráficos se mueven.
- Probado en un navegador limpio (sin datos guardados) y con la app ya instalada, para confirmar que se actualiza.

## 2. Seguridad del equipo real (antes de conectar una placa ante clientes)

**Problema:** broker público (`broker.hivemq.com`) + ID de equipo fijo (`dorn-agro-7k3q`) + sin contraseña ⇒ cualquiera que conozca el ID puede enviar órdenes a la bomba, y todos los visitantes comparten ese “equipo”.

- [ ] ID único por equipo (no escrito en el código público).
- [ ] Broker con usuario/contraseña y permisos por equipo (p. ej. HiveMQ Cloud o EMQX Serverless, ambos con plan gratis).
- [ ] No poner contraseñas del broker en `config.js` (es público): credenciales por usuario o reglas que limiten cada cuenta a su equipo.
- [ ] **App y firmware se cambian juntos** (mismo formato de temas y mensajes); probar primero con el simulador.
- [ ] Mantener las protecciones locales del firmware (sobrecorriente, batería baja, tiempo máximo de bombeo): la seguridad física no debe depender de internet.

## 3. Actualizar el portafolio (15 min, después del punto 1)

```bash
cd dorn-agro && python3 -m http.server 8765        # o usa la dirección publicada
cd Conexion-Servicio && npm run portafolio -- --sitio http://127.0.0.1:8765/
```

- [ ] Revisar las 6 imágenes regeneradas (`public/portafolio/` y `portafolio/fiverr/`). El script avisa si el panel no aparece “En línea” o si no cargaron las fuentes.
- [ ] `npm test` y subir los cambios.

## 4. Pendientes para empezar a vender (si queda tiempo)

- [ ] `npm run simulacion` con `ANTHROPIC_API_KEY` real para ver la calidad de las webs que genera Claude.
- [ ] Emails (SMTP de Gmail con contraseña de aplicación) y `PUBLIC_URL`.
- [ ] Publicar el sistema en Render (`render.yaml`).
- [ ] Fiverr: crear los gigs (textos con `/admin/tiendas` → “Generar textos del gig”) y subir la galería de `portafolio/fiverr/`.
- [ ] Configurar PayPal.me y Discord en `config/stores.json`.

## Reglas a tener en mente durante el día

- Cada cambio se prueba en un **navegador real, en escritorio y en celular**, con la consola sin errores.
- Nunca subir claves ni contraseñas a los repositorios (`config.js` de DORN AGRO es público; el `GOOGLE_CLIENT_ID` sí puede ser público).
- En Fiverr: sin enlaces externos en la descripción ni en los mensajes; el portafolio se muestra con las imágenes de la galería.
- Si cambia la demo, se regenera el portafolio (punto 3).
