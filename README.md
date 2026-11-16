# Showroomcito

**Tu showroom en el celular.** Plataforma para mercaditos, personas que venden desde casa (nuevos y usados) y mujeres que compran en EE. UU. o en sus viajes y revenden, en Perú y en EE. UU. Dominio: showroomcito.com. Cada vendedora crea su cuenta y su vitrina con enlace propio, sube fotos en bloque (la IA les pone categoría, público y nombre), y sus clientes arman un pedido con precios en dólares y soles que pueden pagar con tarjeta (Stripe), con Yape (QR) o enviar por WhatsApp. Las vendedoras pagan un plan mensual según cuántos productos publican.

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
- **Condición y descripción:** cada producto puede llevar su condición (*Nuevo con etiqueta, Nuevo sin etiqueta, Caja abierta, Usado como nuevo, Usado*), visible para el cliente en la tarjeta, el detalle y el mensaje de WhatsApp. Al subir un lote se puede fijar para todas las fotos en *Aplicar a todas*; si se deja vacía, la IA la sugiere por foto (solo si está segura). La IA también escribe una descripción corta con lo que se ve en la foto, que la vendedora puede editar.
- **Cantidad (stock):** opcional; vacío significa "sin control". El cliente ve "Quedan N" o "¡Última unidad!" cuando quedan 3 o menos, y "Agotado" en 0. No puede pedir más unidades de las disponibles: lo valida la pantalla y también el servidor.
- **Descuento automático:** al pagar con tarjeta, el webhook descuenta las unidades una sola vez (aunque Stripe reenvíe el aviso). Al confirmar un Yape, se descuentan cuando la vendedora toca *Confirmar pago*. Los pedidos por WhatsApp se ajustan a mano.

## Página de venta: portada y descripción

En Datos de la tienda › **Tu página de venta**: foto de portada (`Tienda.portada`, se achica a 1600 px) y descripción de hasta 300 letras (`Tienda.descripcionTienda`). El cliente ve arriba de la tienda la foto con el nombre, la descripción y cuántos productos hay. Sin foto, la cabecera usa los colores de Showroomcito; sin foto ni descripción, no se muestra.

## Tienda en dos idiomas (ES | EN)

- El cliente ve un botón **English / Español** arriba de la tienda. Se recuerda en su navegador (`localStorage` "vitrina-idioma"); también se puede abrir con `?lang=en` o `?lang=es`. Sin elegir, la tienda sale en el idioma de su país (Perú = español, EE. UU. = inglés).
- La vendedora siempre ve su panel en español y escribe en su idioma. Mientras tiene abierta su tienda, la app traduce sola con IA (Nova, query `traducirTextos`) el nombre y la descripción de cada producto nuevo o cambiado y los guarda en `Producto.trNombre`, `trDescripcion` (`trFuente` = huella del texto original, para no traducir dos veces). La descripción de la tienda se traduce al guardar Datos de la tienda (`Tienda.trDescripcionTienda`).
- Si todavía no hay traducción, el cliente ve el texto original.
- El mensaje de WhatsApp del pedido le llega a la vendedora en el idioma de su tienda, aunque el cliente compre en el otro.
- El asistente de compras responde en el idioma que eligió el cliente (`preguntarTienda(…, idioma)`).

## Catálogo por rubro (tipo de producto y marcas)

Al crear la tienda, en la misma pantalla, la vendedora toca **¿Qué vendes?**: Ropa y moda (marcado por defecto), Zapatos, Carteras y accesorios, Belleza y perfumes, Relojes y joyería o De todo un poco (`Tienda.rubro`; se cambia en Datos de la tienda; vacío = moda).

- Cada producto tiene **Tipo** (`Producto.tipo`: Vestido, Falda, Jean, Zapatillas, Cartera, Perfume…). La lista y sus categorías están en `src/rubros.js` (copia del servidor en `amplify/functions/shared/rubros.ts`). Al elegir el tipo, la categoría se pone sola.
- La IA de fotos y la del dictado eligen el tipo de esa lista; si la IA no responde, el dictado lo reconoce por las palabras ("vestido", "zapatillas", "lentes") y la marca por una lista de ~90 marcas conocidas o por la palabra que sigue a "marca".
- Los códigos nuevos salen del tipo: VES-001, FAL-001, JEA-001 (los ya puestos no cambian).
- Marca: al escribir se sugieren las de la tienda y las conocidas.
- Órdenes rápidas por tipo: "todas las faldas 20 % de descuento hoy".
- Próximo: rubros sin fotos (Frutas y verduras, Abarrotes) con unidad (kg, atado) y productos de inicio.

## Asistente de compras para clientes

En la tienda pública, el botón **¿Buscas algo?** abre un chat donde el cliente pregunta ("regalos para niño de 5 años", "¿qué ofertas hay?", "algo para mamá menos de S/ 100"). La consulta `preguntarTienda` (función `catalogo`, archivo `catalogo/cliente.ts`) arma la misma lista que ve el cliente (sin ocultos, vendidos ni agotados, sin costos ni origen) y le pide a Nova 2 Lite una respuesta corta con hasta 6 códigos. La tienda muestra tarjetas con foto, código y precio; al tocar una se abre el producto para agregarlo al pedido. El cierre sigue siendo por WhatsApp, Yape o tarjeta.

- Límite por tienda y por día según el plan: Free 20, Básico 100, Pro 300, Plus 1000 preguntas (`clienteDia` / `clienteUsos`). Al llegar al límite invita a escribir por WhatsApp.
- La vendedora lo apaga en Datos de la tienda (`Tienda.chatClientes = false`).
- Tienda de EE. UU.: responde en inglés. El cliente también puede dictar con el micrófono.

## Órdenes rápidas (voz o texto, como con Alexa)

En el asistente, frases cortas con palabras clave se entienden **al instante y sin IA** (no gastan usos del plan). Siempre se muestra la tarjeta con los cambios y la vendedora toca **Aplicar**. El código está en `src/comandos.js` (se puede probar solo, sin la página).

- **A qué productos:** un código (`CAR-002`, `car 2`, `car dos`), `categoría zapatos` / `todos los zapatos` / `las carteras`, `marca Guess`, `los marcados`, `toda la tienda`.
- **Qué cambiar:** `precio 120`, `stock 3` / `cantidad 3` / `hay 3`, `nombre …`, `quita la palabra …`, `no poner bolso sino cartera`, `descripción …`, `marca …`, `talla …`, `condición usado como nuevo`, `categoría accesorios`, `para mujer`, `costo 35`, `vendido`, `ocultar`, `publicar`, `agotado`, `sube/baja el precio 10 %` o `10 soles`.
- **Ofertas:** `15 % de descuento hoy`, `oferta 20 % hasta el domingo`, `por 3 días`, `este fin de semana`, `oferta a 100`, `quitar oferta`. Si no dice hasta cuándo, dura 7 días (y se avisa).
- Se pueden juntar: `CAR-002 precio 120 y stock 1`. Si la frase no es una orden clara (preguntas, "escribe una descripción…"), responde la IA como antes.
- "Órdenes rápidas" en el chat muestra la lista de ejemplos.

## Ofertas con fecha de fin

`Producto.precioOferta` y `Producto.ofertaHasta`: el precio normal no se toca. Mientras la oferta está vigente, el catálogo devuelve el precio de oferta en `precio` (y el normal en `precioAntes`), y `pagos` cobra ese precio con Yape y con tarjeta (`shared/oferta.ts`). Al vencer vuelve solo al precio normal. Se crea con órdenes rápidas, con el asistente o en Editar varios (Oferta % + hasta hoy / domingo / 7 / 30 días, o Quitar oferta). El cliente ve el precio tachado, "-15 %" y "Oferta hasta …"; el mensaje de WhatsApp dice "(oferta)".

## Grupo de WhatsApp de ventas

`Tienda.grupoWhatsapp` (solo enlaces `https://chat.whatsapp.com/…`). Si está puesto, el cliente ve **Únete a mi grupo de WhatsApp**. **📣 Mensaje para mi grupo** (en Productos o en Editar varios) arma el texto con los productos marcados, o con las ofertas vigentes si no hay marcados: Ofertas, Preventa, Novedades o Últimas unidades, con código, precio (tachado si hay oferta), talla y el enlace de la tienda. **Enviar por WhatsApp** abre WhatsApp para elegir el grupo (WhatsApp no deja publicar directo en un grupo); en el celular, **Compartir con fotos** manda también las fotos.

## Panel de la vendedora por pestañas

Al entrar, la vendedora ve su tienda separada en pestañas (se recuerda la última que abrió en ese equipo):

- **Productos**: subir fotos, dictar, editar varios y la vitrina. Si el plan está lleno, aquí sale un aviso con "Mejorar plan".
- **Pedidos**: pedidos con tarjeta o Yape. El número de la pestaña son los pedidos por confirmar o por entregar.
- **Tiendas de confianza**: invitaciones, productos para revender, separados y cuentas.
- **Plan y cobros**: plan, productos usados y pagos con tarjeta (Stripe). Al volver de Stripe se abre esta pestaña.
- **Datos de la tienda**: nombre, WhatsApp, moneda, Yape, días de separado y contraseña.

También se puede abrir una pestaña con el enlace: `#pedidos`, `#confianza`, `#plan` o `#datos`. El enlace para copiar y la vista de cliente quedan arriba, en todas las pestañas. El panel de la dueña y la tienda que ven los clientes no tienen pestañas.

## Código de cada producto

Cada producto recibe un código corto con las letras de su categoría y un número: `CAR-001` (carteras y bolsos), `ZAP-001` (zapatos), `ROP-` ropa, `ACC-` accesorios, `REL-` relojes y joyería, `PER-` perfumes y belleza, `ELE-` electrónica, `HOG-` hogar, `JUG-` juguetes, `OTR-` otros.

- Lo pone la app de la vendedora cuando el producto ya tiene categoría (o a los 3 minutos, con `OTR-`). Los productos antiguos reciben código en el orden en que se subieron.
- No cambia aunque después cambie la categoría, y no se repite dentro de la tienda.
- Se ve en la vitrina, en la ficha, en el mensaje de WhatsApp del pedido, en los pedidos con tarjeta o Yape y en la tabla "Editar varios". El buscador y el asistente lo encuentran (`car001` también sirve).
- En una tienda de confianza, la copia recibe su propio código de la revendedora; el cliente no ve el código de la dueña.

## Cargar productos por voz

Pensado para quien tiene muchos productos y los va mirando uno por uno:

1. **Dictar productos** › micrófono: se dice cada producto de corrido y luego **"siguiente"** (*"Cartera Coach negra, nueva con etiqueta, 85 soles, tengo 2… siguiente"*). Cada producto se guarda al instante en el celular; si el micrófono se corta por un silencio, se vuelve a encender. También se puede escribir (o usar el micrófono del teclado).
2. **La IA entiende el texto** (consulta `interpretarDictado`, misma función `clasificar` con Nova): nombre, marca, precio (convierte soles/dólares con el tipo de cambio), costo, cantidad, talla, condición y categoría. Si la IA falla, reglas simples completan lo básico. Todo se puede corregir.
3. **Fotos en el mismo orden**: se ordenan por la hora en que se tomaron; se ven junto a su dictado y se mueven con flechas. Avisa si hay más o menos fotos que productos.
4. **Vista previa antes de publicar**: los productos se crean **ocultos**; la IA revisa cada foto y marca ⚠️ si parece de otro tipo de producto que lo dictado. Se corrige ahí mismo y recién se toca **Publicar** (respeta el límite del plan).
5. Para **actualizar** la tienda por voz, el **Asistente** tiene micrófono: el texto queda en la caja para revisarlo y los cambios se confirman como siempre.

El reconocimiento de voz lo hace el navegador del celular (sin costo); solo el texto viaja a la IA.

## Tiendas de confianza

Dos vendedoras se conectan (una invita con el enlace de la tienda de la otra y la otra acepta) y cada una puede revender los productos que la otra comparte, **como si fueran suyos**: el cliente ve el nombre, el WhatsApp y los pagos de la revendedora, nunca la tienda de origen.

- **Compartir:** *Editar varios* › *Compartir*, con un % menos que tu precio (el **precio para revendedoras**). También desde la ficha de cada producto.
- **Revender:** *Tiendas de confianza* › *Para revender*: eliges productos y tu % de ganancia; se crea una copia en tu tienda (función `confianza`).
- **Foto, cantidad y disponibilidad** siempre salen del original (el catálogo y los pagos lo verifican en el servidor). Si la dueña lo vende, lo oculta o deja de compartirlo, desaparece de la otra tienda.
- **Ventas:** con tarjeta se registran solas (webhook); con Yape al confirmar el pago; por WhatsApp con *Registrar venta*. Baja la cantidad del original, se anota la deuda (tabla `Reventa`) y la dueña recibe un correo.
- **Cuentas:** cobra la revendedora y le paga a la dueña por fuera (Yape, efectivo); la dueña lo marca como pagado.
- **Separados:** si la clienta de la revendedora pide que se lo guarden, la revendedora toca **Separar**: las unidades se bloquean en el original (nadie más lo puede vender), la dueña lo ve en su panel ("Separado por…"), recibe correo y la revendedora puede avisarle por WhatsApp con el mensaje listo. Luego **Se vendió** (pasa a la cuenta) o **Liberar** (vuelve a estar disponible). Cada dueña fija en *Datos de la tienda* cuántos días dura un separado (por defecto 7); al vencer, ella también puede liberarlo.
- Solo entre tiendas con la misma moneda. Al cortar la relación se quitan los productos revendidos de ambas tiendas.
- La dueña de Showroomcito ve y puede cortar todas las relaciones desde su panel.

## Planes y pagos

| Plan | Productos visibles | Precio |
|---|---|---|
| Free | 10 | Gratis |
| Básico | 30 | S/ 19 al mes |
| Pro | 150 | S/ 49 al mes |
| Plus | ilimitados + fondo blanco con IA | S/ 99 al mes |

- **Planes:** suscripción mensual con Stripe Checkout. Los productos ocultos no cuentan. El límite se aplica en el servidor (Lambda `catalogo`): si una vendedora supera su plan o deja de pagar (3 días de gracia), los clientes solo ven sus productos más recientes hasta el límite.
- **Pedidos:** el cliente puede pagar con tarjeta si la vendedora activó cobros (Stripe Connect Express). El precio se lee de la base de datos, no del navegador. El dinero va a la cuenta Stripe de la vendedora y la plataforma retiene una comisión (`COMISION_PORCENTAJE`, 8 % por defecto, que cubre el ~6.8 % que cobra Stripe con tarjetas peruanas). WhatsApp sigue disponible.
- **Precio con Yape o efectivo:** cada vendedora define en *Datos de la tienda* un descuento (%) para quien paga con Yape o efectivo. El precio publicado es el de tarjeta y el descuento se muestra junto a cada producto, en el pedido y en el mensaje de WhatsApp, antes de pagar (como pide Indecopi). Se presenta como descuento y no como recargo por tarjeta, para cumplir las reglas de las marcas de tarjeta. El servidor calcula el monto con descuento al registrar un pedido por Yape.
- **Yape (QR):** como Stripe no acepta Yape, cada vendedora configura su número y la imagen de su QR en *Datos de la tienda*. El cliente ve el monto exacto en soles (calculado en el servidor), yapea y envía su pedido con su nombre y, si quiere, el código de operación. El pedido queda **Por confirmar** hasta que la vendedora revisa su app de Yape y toca *Confirmar pago* o *No llegó*. No hay comisión.
- **Versión por país:** al crear su vitrina, la vendedora elige dónde están sus clientes. **Perú:** precios en dólares y soles, Yape, descuento por Yape o efectivo, tarjeta en soles y planes en soles (S/19 · S/49 · S/99). **Estados Unidos:** solo dólares, tarjeta en dólares, sin Yape, planes en dólares (provisionales: $9 · $19 · $39, en `amplify/functions/shared/planes.ts` y `src/amplify-adapter.js`) y **la tienda del cliente en inglés** (productos, pedido, WhatsApp, pago y correo). El panel de la vendedora sigue en español, y la IA escribe los nombres de productos en inglés para tiendas de EE. UU.
- **Moneda de los precios (Perú):** cada vendedora de Perú elige en *Datos de la tienda* si pone sus precios en **soles** (por defecto en tiendas nuevas) o en **dólares** (se muestran también en soles con su tipo de cambio). En soles, los precios nunca cambian solos; el tipo de cambio solo convierte el costo de la etiqueta (USD) para calcular el margen. Al cambiar de moneda, los precios publicados se convierten automáticamente.
- **Correos (Resend):** al registrarse un pedido (pagado con tarjeta o por confirmar con Yape), el cliente recibe un correo con el detalle y un botón de WhatsApp, y la vendedora recibe el aviso del pedido nuevo. Si Resend falla, el pedido igual queda registrado.
- **Claves:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` y `RESEND_API_KEY` se guardan como secretos de Amplify, nunca en el código.
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

### Configurar los correos con Resend

1. Crea una cuenta gratis en [resend.com](https://resend.com) (unos 3,000 correos al mes).
2. En **API Keys**, crea una clave (`re_...`).
3. En Amplify › Hosting › **Secrets**, crea `RESEND_API_KEY` con esa clave y vuelve a desplegar. Si no quieres correos, guárdalo con el valor `no`.
4. El dominio **showroomcito.com** está verificado en Resend (región us-east-1, configurado con *Auto configure* de Cloudflare): DKIM en `resend._domainkey`, envío en `send` y `rsend`, y DMARC en `_dmarc`. No chocan con el correo de Zoho (MX y SPF en la raíz del dominio).
5. Remitente: `CORREO_REMITENTE = Showroomcito <pedidos@showroomcito.com>` en las funciones `pagos`, `stripe-webhook` y `confianza`. La clave de Resend debe tener permiso **Sending access** solo para showroomcito.com.

El correo confirma el pedido, pero no reemplaza la boleta o factura electrónica de SUNAT.

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
.github/workflows/qa-review.yml  Corre en cada Pull Request a main, después de cada cambio en pruebas, todas las noches y a mano
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
| `TEST_USER_B` / `TEST_PASSWORD_B` | secret | segunda vendedora (tiendas de confianza) |
| `TEST_STORE_B` | variable | enlace de la tienda de la segunda vendedora (en soles) |

En pruebas: `BASE_URL_QA=https://pruebas.showroomcito.com`, `TEST_STORE=showroomvip`, `TEST_STORE_YAPE=showroomvip`, `TEST_STORE_B=jessicaventasusa`. La cuenta `TEST_USER` es SUPERADMIN en el pool de pruebas (para el panel de la dueña).

**Correr a mano:** GitHub › Actions › QA Review › Run workflow (rama `pruebas`). El reporte queda en *Artifacts › playwright-report*.

**Revisar las pruebas sin internet:** con `PREVIEW_FILE=file:///ruta/vitrina-vista-previa.html` las pruebas de `tests/support/app.ts` abren la vista previa (datos de ejemplo) en lugar de la página real.

Las pruebas que necesitan una variable que no esté definida se marcan como omitidas en lugar de fallar.

Correr por requerimiento: `npx playwright test --grep @REQ-004`.

### CodeBuild → S3

Ver `buildspec.yml`. Necesita `REPORT_BUCKET`, `BASE_URL` y el secreto `qa/playwright` en Secrets Manager con `TEST_USER` y `TEST_PASSWORD`. Cada ejecución guarda el reporte HTML, el JUnit y la matriz en `s3://<bucket>/reportes/<fecha>-<commit>/`.

## Versión anterior

`app/vitrina-usa.html` es la primera versión, que funciona como Artifact dentro de claude.ai (una sola tienda).
