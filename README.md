# Vitrina USA

Plataforma para revendedoras de productos traídos de USA. Cada vendedora crea su cuenta y su vitrina con enlace propio, sube fotos en bloque (la IA les pone categoría, público y nombre), y sus clientes arman un pedido con precios en dólares y soles que pueden pagar con tarjeta (Stripe), con Yape (QR) o enviar por WhatsApp. Las vendedoras pagan un plan mensual según cuántos productos publican.

## Cómo está armada

| Parte | Servicio AWS | Archivo |
|---|---|---|
| Cuentas de vendedoras y dueña | Cognito (correo o Google, grupo `SUPERADMIN`) | `amplify/auth/resource.ts` |
| Tiendas y productos, aislados por dueña | AppSync + DynamoDB (`allow.owner()`) | `amplify/data/resource.ts` |
| Vitrina pública (solo tiendas aprobadas) | Lambda `catalogo` | `amplify/functions/catalogo/` |
| Fotos, cada vendedora en su carpeta | S3 + CloudFront | `amplify/storage/resource.ts`, `amplify/backend.ts` |
| Clasificación de fotos con IA | Lambda `clasificar` + Bedrock (Claude Haiku 5.5) | `amplify/functions/clasificar/` |
| Fondo blanco con IA (plan Plus) | Lambda `fondo` + Bedrock (Amazon Nova Canvas) | `amplify/functions/fondo/` |
| Asistente de la vendedora | Lambda `asistente` + Bedrock (Claude, herramientas) | `amplify/functions/asistente/` |
| Planes y pago de pedidos | Lambda `pagos` + Stripe (Checkout, Billing, Connect) | `amplify/functions/pagos/` |
| Confirmación de pagos | Lambda `stripe-webhook` (URL pública con firma) | `amplify/functions/stripe-webhook/` |
| Web | Amplify Hosting (Vite) | `index.html`, `src/` |

**Aislamiento de datos:** las reglas de autorización de AppSync y S3 hacen que cada vendedora solo pueda leer y modificar sus propias tiendas, productos y fotos. El campo `estado` de una tienda (pendiente, aprobada, suspendida) solo lo cambia el grupo `SUPERADMIN`. Los clientes no leen las tablas: la Lambda `catalogo` solo devuelve vitrinas aprobadas.

### Rutas de la web

- `/` : inicio, registro e ingreso. Con sesión iniciada: la vitrina de la vendedora (edición).
- `/?tienda=<enlace>` : vitrina pública que ve el cliente.
- `/#entrar` : abre el formulario de ingreso.
- `/#panel` : panel de la dueña (solo `SUPERADMIN`).

## Asistente de la vendedora

Un chat en el panel (botón **Asistente**) donde la vendedora pide cosas como en WhatsApp: "¿qué me falta completar?", "escribe descripciones para los productos sin descripción", "pon 60 % de margen a los que tienen costo", "¿qué pedidos tengo por confirmar?".

- **Cómo funciona:** la Lambda `asistente` llama a Claude Haiku 5.5 en Bedrock (Converse API) con cuatro herramientas: `resumen_tienda`, `buscar_productos`, `listar_pedidos` y `proponer_cambios`. Claude decide qué herramienta usar; la Lambda las ejecuta con los datos de esa tienda.
- **Nada cambia sin permiso:** `proponer_cambios` no escribe en la base de datos. Devuelve una propuesta que la pantalla muestra como tabla de antes y después; solo al tocar **Aplicar** se guardan los cambios, con los permisos normales de la vendedora.
- **Seguridad:** la Lambda verifica que quien pregunta es la dueña de la tienda; solo lee productos y pedidos de esa tienda. La propuesta se valida (solo ids de esa tienda, campos permitidos, valores en rango).
- **Costo:** límite de mensajes por día según el plan (Free 15, Básico 60, Pro 200, Plus 1000), contado en el servidor.

## Productos: subida en lote, marca y cantidad

La idea central es **subir muchas fotos de una vez**. Al arrastrar el lote se puede escribir en *Aplicar a todas* el precio, la categoría, la marca y la cantidad de cada producto; la IA completa categoría, público, nombre y marca (sin sobrescribir lo que la vendedora escribió). Después, *Editar varios* cambia cualquiera de esos campos en muchos productos a la vez.

- **Fotos originales o mejoradas:** al soltar un lote se pregunta una sola vez cómo subirlo, con una muestra de antes y después: *Tal cual*, *Mejoradas* (luz, color y nitidez en el navegador, sin costo) o *Fondo blanco (IA)* (Amazon Nova Canvas en Bedrock, Lambda `fondo`). La elección se puede recordar para los próximos lotes.
- **Fondo blanco solo en plan Plus:** cada foto procesada por Nova Canvas tiene costo en AWS, así que la Lambda `fondo` lo rechaza si la tienda no tiene el plan Plus vigente. Requiere activar **Amazon Nova Canvas** en Bedrock (`us-east-1`).
- **Cantidad (stock):** opcional; vacío significa "sin control". El cliente ve "Quedan N" o "¡Última unidad!" cuando quedan 3 o menos, y "Agotado" en 0. No puede pedir más unidades de las disponibles: lo valida la pantalla y también el servidor.
- **Descuento automático:** al pagar con tarjeta, el webhook descuenta las unidades una sola vez (aunque Stripe reenvíe el aviso). Al confirmar un Yape, se descuentan cuando la vendedora toca *Confirmar pago*. Los pedidos por WhatsApp se ajustan a mano.

## Planes y pagos

| Plan | Productos visibles | Precio |
|---|---|---|
| Free | 10 | Gratis |
| Básico | 30 | S/ 19 al mes |
| Pro | 150 | S/ 49 al mes |
| Plus | ilimitados + fondo blanco con IA | S/ 99 al mes |

- **Planes:** suscripción mensual con Stripe Checkout. Los productos ocultos no cuentan. El límite se aplica en el servidor (Lambda `catalogo`): si una vendedora supera su plan o deja de pagar (3 días de gracia), los clientes solo ven sus productos más recientes hasta el límite.
- **Pedidos:** el cliente puede pagar con tarjeta si la vendedora activó cobros (Stripe Connect Express). El precio se lee de la base de datos, no del navegador. El dinero va a la cuenta Stripe de la vendedora y la plataforma retiene una comisión (`COMISION_PORCENTAJE`, 5 % por defecto). WhatsApp sigue disponible.
- **Yape (QR):** como Stripe no acepta Yape, cada vendedora configura su número y la imagen de su QR en *Datos de la tienda*. El cliente ve el monto exacto en soles (calculado en el servidor), yapea y envía su pedido con su nombre y, si quiere, el código de operación. El pedido queda **Por confirmar** hasta que la vendedora revisa su app de Yape y toca *Confirmar pago* o *No llegó*. No hay comisión.
- **Claves:** `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET` se guardan como secretos de Amplify, nunca en el código.
- **Limitaciones:** Stripe no acepta Yape ni Plin (por eso Yape va por QR con confirmación manual), y no abre cuentas a empresas registradas en Perú. Para la demostración se usa el **modo de prueba**. Para cobrar dinero real en Perú habría que cambiar a Mercado Pago o Culqi, o tener una empresa en un país soportado por Stripe.

### Configurar Stripe (modo de prueba)

1. Crea una cuenta en [stripe.com](https://dashboard.stripe.com/register) y deja activado **Test mode**.
2. En Settings › Connect, activa **Connect** (tipo de plataforma: marketplace).
3. Copia la **Secret key** (`sk_test_...`) desde Developers › API keys.
4. En Amplify › tu app › Hosting › **Secrets**, crea `STRIPE_SECRET_KEY` con esa clave, y `STRIPE_WEBHOOK_SECRET` con un valor temporal (por ejemplo `pendiente`). Despliega.
5. Después del despliegue, copia la URL del webhook: está en `amplify_outputs.json` como `custom.stripeWebhookUrl` (o en la consola de Lambda, función `stripe-webhook`, Function URL).
6. En Stripe › Developers › Webhooks › **Add endpoint**, pega esa URL (eventos de *tu cuenta*) y elige: `checkout.session.completed`, `checkout.session.expired`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`. El estado de los cobros de cada vendedora se consulta directamente al volver de Stripe y al abrir su vitrina, así que no hace falta un webhook de Connect.
7. Copia el **Signing secret** (`whsec_...`), actualiza el secreto `STRIPE_WEBHOOK_SECRET` en Amplify y vuelve a desplegar.

Tarjeta de prueba: `4242 4242 4242 4242`, cualquier fecha futura y cualquier CVC.

## Iniciar sesión con Google (opcional)

Las vendedoras pueden entrar con **Continuar con Google** además de su correo. Se activa después del primer despliegue:

1. En [Google Cloud Console](https://console.cloud.google.com/) crea un proyecto › *APIs y servicios* › **Pantalla de consentimiento de OAuth** (tipo *Externo*, nombre de la app, correo de soporte).
2. *Credenciales* › **Crear ID de cliente de OAuth** › *Aplicación web*. Copia el **ID de cliente** y el **secreto**.
3. En Amplify › Hosting › **Secrets**, crea `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`. En **Environment variables**, crea `GOOGLE_LOGIN` = `si` y `SITE_URL` = la URL de tu app (ej. `https://main.d123.amplifyapp.com`). Vuelve a desplegar.
4. Copia el dominio de Cognito (en `amplify_outputs.json` › `auth.oauth.domain`, o Cognito › App integration › Domain). En el cliente de Google agrega:
   - *Orígenes de JavaScript autorizados:* `https://<dominio-de-cognito>`
   - *URI de redirección autorizados:* `https://<dominio-de-cognito>/oauth2/idpresponse`

Mientras `GOOGLE_LOGIN` no sea `si`, el botón no aparece y el despliegue no necesita los secretos de Google.

Nota: si una vendedora ya tenía cuenta con correo y contraseña y luego entra con Google usando el mismo correo, Cognito crea una cuenta separada. Para unirlas haría falta un disparador *pre sign-up* que enlace ambas identidades.

## Publicar en AWS (primera vez)

1. **Activar los modelos en Bedrock.** En la consola de AWS, región `us-east-1`: Amazon Bedrock › Model catalog › **Claude Haiku 5.5** (clasificación) y **Amazon Nova Canvas** (fondo blanco). Si es tu primera vez con modelos de Anthropic, completa el formulario de caso de uso.
2. **Crear la app en Amplify.** AWS Amplify › Create new app › GitHub › repositorio `gift-sale-online-app` › rama `main`. Amplify detecta `amplify.yml`. Despliega (tarda unos 10 minutos la primera vez).
3. **Crear tu cuenta.** Abre la URL de Amplify (`https://main.xxxx.amplifyapp.com`), toca *Crear mi vitrina* y regístrate con tu correo.
4. **Darte permisos de dueña.** Amazon Cognito › User pools › (el de la app) › Groups › `SUPERADMIN` › Add user › tu correo. Cierra sesión y vuelve a entrar: aparece el botón *Panel de dueña*.
5. **Aprobar vitrinas.** Panel de dueña › Pendientes › Aprobar.

Cada merge a `main` vuelve a desplegar backend y web.

## Desarrollo local

```bash
npm install
npx ampx sandbox      # backend personal en tu cuenta AWS; genera amplify_outputs.json
npm run dev           # web en http://localhost:5173
```

## Pruebas automatizadas

Flujo: **Requerimientos + pruebas manuales → Codex (matriz + scripts) → Revisión QA → Playwright → GitHub → AWS CodeBuild → S3**

```
docs/matriz-trazabilidad.csv   REQ ↔ caso manual ↔ script ↔ aprobación QA
docs/prompt-codex.md           Prompt listo para Codex
tests/                         Playwright (Page Object Model en tests/pages)
scripts/check-traceability.js  Valida que cada caso automatizable tenga test (y aprobación con --require-approval)
.github/workflows/qa-review.yml  Corre en cada Pull Request
buildspec.yml                  CodeBuild: ejecuta y publica reportes en S3
```

Variables para las pruebas (GitHub › Settings › Secrets and variables › Actions, y en CodeBuild):

| Nombre | Tipo | Valor |
|---|---|---|
| `BASE_URL_QA` | variable | URL de Amplify a probar |
| `TEST_USER` / `TEST_PASSWORD` | secret | vendedora de prueba con vitrina creada |
| `TEST_STORE` | variable | enlace de una vitrina aprobada con productos con precio |
| `TEST_PENDING_STORE` | variable | enlace de una vitrina pendiente |
| `TEST_STORE_COBROS` | variable | enlace de una vitrina aprobada con pagos con tarjeta activos |
| `TEST_STORE_YAPE` | variable | enlace de una vitrina aprobada con Yape configurado |

Las pruebas que necesitan una variable que no esté definida se marcan como omitidas en lugar de fallar.

Correr por requerimiento: `npx playwright test --grep @REQ-004`.

### CodeBuild → S3

Ver `buildspec.yml`. Necesita `REPORT_BUCKET`, `BASE_URL` y el secreto `qa/playwright` en Secrets Manager con `TEST_USER` y `TEST_PASSWORD`. Cada ejecución guarda el reporte HTML, el JUnit y la matriz en `s3://<bucket>/reportes/<fecha>-<commit>/`.

## Versión anterior

`app/vitrina-usa.html` es la primera versión, que funciona como Artifact dentro de claude.ai (una sola tienda).
