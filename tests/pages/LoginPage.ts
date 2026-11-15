import { Page, Locator } from '@playwright/test';

export class LoginPage {
  readonly page: Page;
  readonly correo: Locator;
  readonly contrasena: Locator;
  readonly botonEntrar: Locator;
  readonly mensajeError: Locator;

  constructor(page: Page) {
    this.page = page;
    // Por id: la etiqueta de la contraseña también lleva el botón del ojo ("Mostrar contraseña")
    this.correo = page.locator('#loginEmail');
    this.contrasena = page.locator('#loginPass');
    this.botonEntrar = page.getByRole('button', { name: 'Entrar', exact: true });
    this.mensajeError = page.locator('#loginErr');
  }

  async abrir() {
    await this.page.goto('/#entrar');
  }

  async login(correo: string, contrasena: string) {
    await this.correo.fill(correo);
    await this.contrasena.fill(contrasena);
    await this.botonEntrar.click();
  }
}
