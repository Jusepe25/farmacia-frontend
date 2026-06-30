# Farmacia Frontend

Interfaz web (SPA) que funciona como **simulador / banco de pruebas** del proveedor externo de farmacia. Permite enviar recetas médicas contra la [**Farmacia API**](../farmacia-api), verificar su estado (healthcheck) y visualizar si la receta fue **Aceptada** o **Rechazada por falta de stock**.

> ⚠️ Este simulador toca el proveedor directamente solo por ser un banco de pruebas. En producción, únicamente el **Adaptador Farmacia (SVC-PRE-009)** debe invocar la API — nunca el SPA del usuario interno.

## Arquitectura y Tecnologías

- **React 19** con **Vite 8** (HMR, build de producción)
- **Tailwind CSS v4** (entrada `@import "tailwindcss";` en `src/index.css`)
- **ESLint** para linting
- Consumo de la API vía `fetch` con autenticación `Bearer Token`

## Iniciar el Proyecto

### Requisitos previos

- **Node.js 22** (o >= 18)
- La [Farmacia API](../farmacia-api) corriendo en `http://localhost:4002`

### Instalación

```bash
npm install
```

### Desarrollo

```bash
npm run dev
```

La aplicación arranca en `http://localhost:5173` (si el puerto está ocupado, Vite usa el siguiente disponible). El simulador verifica automáticamente `GET /health` al cargar.

### Build de producción

```bash
npm run build
npm run preview   # previsualiza el build localmente
```

## Configuración

La conexión al proveedor está definida en `src/App.jsx`:

| Constante  | Valor por defecto       | Descripción                                     |
| ---------- | ----------------------- | ----------------------------------------------- |
| `BASE_URL` | `http://localhost:4002` | URL base de la Farmacia API                     |
| `TOKEN`    | `test_api_key_123`      | `Bearer Token` del proveedor (banco de pruebas) |

> El backend ya habilita **CORS** para los orígenes de desarrollo (`localhost`). Si cambias el puerto del front y la petición se bloquea, revisa la configuración de `cors` en `farmacia-api/src/app.js`.

## Funcionalidad

1. **Healthcheck:** consulta `GET /health` y muestra el estado del proveedor (Operativa / No responde) con la hora de la última verificación.
2. **Envío de recetas:** formulario para `referenciaDespacho`, `farmacia`, `medicamento`, `dosis` y `cantidad`, que envía un `POST /api/v1/farmacia/recepcionar-receta`.
3. **Respuesta del despacho:** visualiza la decisión (`Aceptada` con su referencia, o `Rechazada` con el motivo) e incluye la respuesta JSON cruda.

## Estructura del Proyecto

- `/src/App.jsx`: Componente principal — todo el simulador (formulario, healthcheck y resultado)
- `/src/main.jsx`: Punto de entrada de React
- `/src/index.css`: Estilos globales e importación de Tailwind
- `/src/assets`: Recursos estáticos
- `/public`: Archivos públicos servidos tal cual

## Scripts

- `npm run dev`: Inicia el servidor de desarrollo
- `npm run build`: Genera el build de producción
- `npm run preview`: Previsualiza localmente el build de producción
- `npm run lint`: Ejecuta ESLint
