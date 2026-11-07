# Vitrina USA

Catálogo de productos traídos de USA con subida de fotos en bloque, clasificación por categoría con IA, precios en USD y soles, y pedidos por WhatsApp.

- `app/vitrina-usa.html`: código de la vitrina. Hoy se ejecuta como Artifact en claude.ai (usa su base de datos, almacenamiento de fotos e IA). Para publicarla fuera de Claude hay que reemplazar esas funciones por servicios propios (por ejemplo S3 + CloudFront para fotos y una API para los productos).
- Resto del repositorio: kit de pruebas automatizadas (Playwright → GitHub → AWS CodeBuild → S3).

---

# Kit de pruebas automatizadas

Flujo: **Requerimientos + pruebas manuales → Codex (matriz + scripts) → Revisión QA → Playwright → GitHub → AWS CodeBuild → S3**

## Estructura

```
docs/matriz-trazabilidad.csv   Matriz REQ ↔ caso manual ↔ script ↔ aprobación QA
docs/prompt-codex.md           Prompt listo para Codex
tests/                         Scripts Playwright (Page Object Model en tests/pages)
scripts/check-traceability.js  Valida que cada caso automatizable tenga test y aprobación
playwright.config.ts           Reportes HTML, JUnit y JSON
.github/workflows/qa-review.yml  Corre en cada Pull Request
.github/CODEOWNERS             Obliga aprobación del equipo QA
buildspec.yml                  CodeBuild: ejecuta y publica reportes en S3
```

## Paso a paso

### 1. Requerimientos + pruebas manuales
Llena en la matriz `ID_Requerimiento`, descripción, casos manuales, pasos y resultado esperado.

### 2. Codex
Abre `docs/prompt-codex.md`, pégalo en Codex junto con tus requerimientos. Codex completa la matriz y genera los `.spec.ts`. Cada test lleva el ID del caso y el tag del requerimiento en el título (`CP-001 ... @REQ-001`), así puedes correr por requerimiento: `npx playwright test --grep @REQ-001`.

### 3. Revisión y aprobación QA
- Codex sube los cambios en una rama y abre un Pull Request.
- `qa-review.yml` valida la trazabilidad y ejecuta las pruebas.
- QA revisa, cambia `Estado_Revision_QA` a `Aprobado`, llena `Aprobado_Por` y `Fecha_Aprobacion`, y aprueba el PR.
- En GitHub → Settings → Branches, protege `main` con: *Require pull request approval*, *Require review from Code Owners* y *Require status checks* (`trazabilidad-y-pruebas`).

### 4. Playwright local
```bash
npm ci
npx playwright install chromium
BASE_URL=https://qa.tuapp.com TEST_USER=... TEST_PASSWORD=... npm test
npm run report
```

### 5. GitHub → AWS CodeBuild
1. CodeBuild → Create project → Source: GitHub (conexión OAuth o CodeConnections).
2. Webhook: evento `PUSH`, filtro `HEAD_REF` = `^refs/heads/main$`.
3. Environment: imagen `aws/codebuild/standard:7.0` (Ubuntu, Node 20).
4. Buildspec: usar `buildspec.yml` del repositorio.
5. Variables de entorno: `REPORT_BUCKET`, `BASE_URL`.
6. Secrets Manager: secreto `qa/playwright` con llaves `TEST_USER` y `TEST_PASSWORD`.

El `pre_build` corre `check-traceability.js --require-approval`: si algún caso automatizable no está **Aprobado** por QA, el build se detiene.

### 6. S3
Crea el bucket (privado, con bloqueo de acceso público). Cada ejecución queda en:
```
s3://<bucket>/reportes/<fecha>-<commit>/html/index.html
s3://<bucket>/reportes/<fecha>-<commit>/results/junit.xml
s3://<bucket>/reportes/<fecha>-<commit>/matriz-trazabilidad.csv
s3://<bucket>/reportes/latest/html/index.html
```
Para verlo en navegador sin hacerlo público, usa CloudFront con OAC o URLs prefirmadas.

Política mínima para el rol de servicio de CodeBuild:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["s3:PutObject", "s3:DeleteObject", "s3:ListBucket"],
      "Resource": ["arn:aws:s3:::<bucket>", "arn:aws:s3:::<bucket>/reportes/*"] },
    { "Effect": "Allow", "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:<region>:<cuenta>:secret:qa/playwright-*" }
  ]
}
```

Los reportes JUnit también aparecen en CodeBuild → *Report groups* con historial de pasados/fallidos.
