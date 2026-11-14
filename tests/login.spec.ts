import { test, expect } from '@playwright/test';
import { LoginPage } from './pages/LoginPage';

const USER = process.env.TEST_USER ?? '';
const PASS = process.env.TEST_PASSWORD ?? '';

test.describe('REQ-001 Inicio de sesión de la vendedora', () => {
  test.skip(!USER || !PASS, 'Define TEST_USER y TEST_PASSWORD (vendedora de prueba con vitrina creada)');

  test('CP-001 Login exitoso @REQ-001', async ({ page }) => {
    const login = new LoginPage(page);
    await login.abrir();
    await login.login(USER, PASS);
    await expect(page.getByRole('heading', { name: 'Arrastra aquí todas las fotos' })).toBeVisible();
    await expect(page.locator('#storeBanner')).toBeVisible();
  });

  test('CP-002 Login con contraseña incorrecta @REQ-001', async ({ page }) => {
    const login = new LoginPage(page);
    await login.abrir();
    await login.login(USER, 'Clave-Invalida-123!');
    await expect(login.mensajeError).toHaveText(/incorrectos/);
    await expect(page.getByRole('heading', { name: 'Arrastra aquí todas las fotos' })).toBeHidden();
  });
});
