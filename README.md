# Vitrina USA

Plataforma para revendedoras de productos traídos de USA. Cada vendedora crea su cuenta y su vitrina con enlace propio, sube fotos en bloque (la IA les pone categoría, público y nombre), y sus clientes arman un pedido que llega por WhatsApp con precios en dólares y soles.

## Cómo está armada

| Parte | Servicio AWS | Archivo |
|---|---|---|
| Cuentas de vendedoras y dueña | Cognito (grupo `SUPERADMIN`) | `amplify/auth/resource.ts` |
| Tiendas y productos, aislados por dueña | AppSync + DynamoDB (`allow.owner()`) | `amplify/data/resource.ts` |
| Vitrina pública (solo tiendas aprobadas) | Lambda `catalogo` | `amplify/functions/catalogo/` |
| Fotos, cada vendedora en su carpeta | S3 + CloudFront | `amplify/storage/resource.ts`, `amplify/backend.ts` |
| Clasificación de fotos con IA | Lambda `clasificar` + Bedrock (Claude Haiku 5.5) | `amplify/functions/clasificar/` |
| Web | Amplify Hosting (Vite) | `index.html`, `src/` |

**Aislamiento de datos:** las reglas de autorización de AppSync y S3 hacen que cada vendedora solo pueda leer y modificar sus propias tiendas, productos y fotos. El campo `estado` de una tienda (pendiente, aprobada, suspendida) solo lo cambia el grupo `SUPERADMIN`. Los clientes no leen las tablas: la Lambda `catalogo` solo devuelve vitrinas aprobadas.

### Rutas de la web

- `/` : inicio, registro e ingreso. Con sesión iniciada: la vitrina de la vendedora (edición).
- `/?tienda=<enlace>` : vitrina pública que ve el cliente.
- `/#entrar` : abre el formulario de ingreso.
- `/#panel` : panel de la dueña (solo `SUPERADMIN`).

## Publicar en AWS (primera vez)

1. **Activar Claude en Bedrock.** En la consola de AWS, región `us-east-1`: Amazon Bedrock › Model catalog › Claude Haiku 5.5. Si es tu primera vez con modelos de Anthropic, completa el formulario de caso de uso.
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

Las pruebas que necesitan una variable que no esté definida se marcan como omitidas en lugar de fallar.

Correr por requerimiento: `npx playwright test --grep @REQ-004`.

### CodeBuild → S3

Ver `buildspec.yml`. Necesita `REPORT_BUCKET`, `BASE_URL` y el secreto `qa/playwright` en Secrets Manager con `TEST_USER` y `TEST_PASSWORD`. Cada ejecución guarda el reporte HTML, el JUnit y la matriz en `s3://<bucket>/reportes/<fecha>-<commit>/`.

## Versión anterior

`app/vitrina-usa.html` es la primera versión, que funciona como Artifact dentro de claude.ai (una sola tienda).
