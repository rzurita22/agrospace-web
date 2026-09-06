# Agrospace: Netlify + Google Apps Script

Esta carpeta separa el frontend del backend:

- `public/index.html`: dashboard para Netlify.
- `public/chat.html`: METEOX IA para Netlify.
- `netlify/functions/apps-script.mjs`: proxy same-origin entre el navegador y Google Apps Script.
- `apps-script/Code.gs`: backend actualizado con un endpoint RPC controlado por lista blanca.
- `netlify.toml`: publica `public/` y crea `/api/apps-script`.

## 1. Actualizar Google Apps Script

1. Hacer una copia de seguridad del proyecto actual.
2. Reemplazar el contenido de `Code.gs` por `apps-script/Code.gs`.
3. Implementar > Administrar implementaciones > editar la Web App > **Nueva version**.
4. Ejecutar como: vos.
5. Acceso: la misma configuracion que usa actualmente tu Web App.
6. Conservar la URL `/exec`.

El `doGet()` se conserva, por lo que la pagina vieja puede seguir funcionando durante la migracion. El nuevo `doPost()` agrega `accion=rpc`.

## 2. Publicar en Netlify

Recomendado: subir esta carpeta a GitHub y conectar el repositorio a Netlify. Netlify detectara `netlify.toml`.

Opcionalmente crear en Netlify la variable de entorno:

`GAS_WEB_APP_URL=https://script.google.com/macros/s/TU_DEPLOYMENT_ID/exec`

El proxy trae como fallback la URL actual, pero usar la variable permite cambiar de deployment sin editar codigo.

## 3. Seguridad

El HTML original contenia una AIO Key de Adafruit en el codigo del navegador. En esta version se elimino el valor por defecto del HTML publico y las lecturas/escrituras normales pasan por Apps Script.

**Rotar la AIO Key de Adafruit IO antes de considerar terminada la migracion**, porque la clave anterior ya estuvo expuesta en el frontend. Luego actualizar la clave en Script Properties / configuracion del backend y, si corresponde, en el ESP32.

El gateway RPC deja publicas solamente:

- inicio/verificacion de sesion;
- lectura del ultimo dato;
- lectura historica.

Las funciones de configuracion, alertas, chat IA y escritura exigen una sesion Agrospace valida.

## 4. URLs finales

- Dashboard: `https://TU-SITIO.netlify.app/`
- Chat: `https://TU-SITIO.netlify.app/chat.html`
- API interna: `https://TU-SITIO.netlify.app/api/apps-script`

No pongas claves de Adafruit, OpenAI ni Telegram en los archivos dentro de `public/`.
