import { test, expect } from '@playwright/test';
import { LoginPage } from './pages/LoginPage';

const USER = process.env.TEST_USER ?? '';
const PASS = process.env.TEST_PASSWORD ?? '';

test.describe('REQ-001 Inicio de sesión', () => {
  test('CP-001 Login exitoso @REQ-001', async ({ page }) => {
    const login = new LoginPage(page);
    await login.abrir();
    await login.login(USER, PASS);
    await expect(page).toHaveURL(/dashboard/);
    await expect(page.getByText(USER)).toBeVisible();
  });

  test('CP-002 Login con contraseña incorrecta @REQ-001', async ({ page }) => {
    const login = new LoginPage(page);
    await login.abrir();
    await login.login(USER, 'clave-invalida');
    await expect(login.mensajeError).toBeVisible();
    await expect(page).toHaveURL(/login/);
  });
});
