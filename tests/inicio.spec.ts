import { test, expect } from '@playwright/test';
import { abrirInicio } from './support/app';

test.describe('REQ-024 Página principal de Showroomcito', () => {
  test('CP-055 Se ven los 4 planes y cambian de soles a dólares @REQ-024', async ({ page }) => {
    await abrirInicio(page);
    const planes = page.locator('#lPlanes .plan-card');
    await expect(planes).toHaveCount(4);
    for (const nombre of ['Free', 'Básico', 'Pro', 'Plus']) await expect(planes.getByText(nombre, { exact: true })).toBeVisible();
    // La moneda inicial depende del país del navegador: se prueban las dos.
    await page.locator('.l-moneda .chip[data-moneda="PEN"]').click();
    await expect(planes.nth(1)).toContainText('S/');
    await page.locator('.l-moneda .chip[data-moneda="USD"]').click();
    await expect(planes.nth(1)).toContainText('$');
    await expect(planes.nth(1)).not.toContainText('S/');
  });

  test('CP-056 "Crear mi showroom gratis" abre el registro @REQ-024', async ({ page }) => {
    await abrirInicio(page);
    await page.locator('#goSignup').click();
    await expect(page.locator('#authTitle')).toHaveText('Crear cuenta');
    await expect(page.locator('#reqPass')).toBeVisible();
    await expect(page.getByLabel('Repite la contraseña')).toBeVisible();
  });
});

test.describe('REQ-025 Registro y contraseña', () => {
  test.beforeEach(async ({ page }) => {
    await abrirInicio(page);
    await page.locator('#goSignup').click();
  });

  test('CP-057 Los requisitos de la contraseña se marcan solos @REQ-025', async ({ page }) => {
    const pass = page.locator('#loginPass');
    await pass.fill('abc');
    await expect(page.locator('#reqPass li.ok')).toHaveCount(1);       // solo minúscula
    await pass.fill('Clave-Prueba1');
    await expect(page.locator('#reqPass li.ok')).toHaveCount(5);
  });

  test('CP-058 Avisa si las contraseñas no coinciden @REQ-025', async ({ page }) => {
    await page.locator('#loginPass').fill('Clave-Prueba1');
    await page.locator('#loginPass2').fill('Clave-Prueba2');
    await expect(page.locator('#passIgual')).toContainText('no coinciden');
    await page.locator('#loginPass2').fill('Clave-Prueba1');
    await expect(page.locator('#passIgual')).toContainText('coinciden');
    await expect(page.locator('#passIgual')).not.toContainText('no coinciden');
  });

  test('CP-059 El ojo muestra y oculta la contraseña @REQ-025', async ({ page }) => {
    const pass = page.locator('#loginPass');
    await pass.fill('Clave-Prueba1');
    await expect(pass).toHaveAttribute('type', 'password');
    await page.locator('#verPass').click();
    await expect(pass).toHaveAttribute('type', 'text');
    await page.locator('#verPass').click();
    await expect(pass).toHaveAttribute('type', 'password');
  });

  test('CP-060 "¿Olvidaste tu contraseña?" pide solo el correo @REQ-025', async ({ page }) => {
    await page.locator('#authSwitch').click();                         // pasar a "Entrar"
    await expect(page.locator('#authTitle')).toHaveText('Entrar');
    await page.locator('#olvideBtn').click();
    await expect(page.locator('#authTitle')).toContainText('Recuperar');
    await expect(page.locator('#loginEmail')).toBeVisible();
    await expect(page.locator('#loginPass')).toBeHidden();
  });
});
