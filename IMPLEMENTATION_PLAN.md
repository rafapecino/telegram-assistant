# Mejoras del panel tras la revisión en Chrome

## Alcance

Cambios de interfaz y navegación en una rama aislada. Sin despliegue, migraciones, escrituras en los datos
personales ni cambios de permisos o conexiones.

## Implementación

1. Corregir la ayuda de recordatorios para que describa la próxima hora en punto de Madrid. Inicializar
   fecha y hora juntas y usar «Crear recordatorio» como acción local.
2. Identificar cada sección mediante un parámetro de URL, con enlaces nativos y soporte de historial.
   No requiere reglas nuevas en el alojamiento. Mantener el destino tras autenticarse.
3. Añadir salto al contenido, título de pestaña y foco al navegar. Agrupar el menú en tres bloques.
4. Mostrar noticias relacionadas solo en Inicio, distribuir los temas en varias filas y aumentar textos
   auxiliares. Respetar la preferencia de movimiento reducido.
5. Verificar tipos, compilación y pruebas de rutas y horarios con medianoche y cambios de hora.

## Validación pendiente antes de integrar

- Probar la versión modificada en Chrome con una sesión de pruebas: enlaces, Atrás/Adelante, recarga,
  diálogos y salto al contenido; comprobar foco con teclado y lector de pantalla.
- Revisar a 390 y 1280 px, con ampliación al 200 %, y pasar axe en las secciones afectadas.
- La auditoría de autorización del servidor requiere una revisión específica con cuentas de prueba;
  la revisión visual anterior no certifica el aislamiento entre cuentas.

La compilación no publica la aplicación. No fusionar ni subir la rama sin revisar la automatización de
Vercel: un push o una PR podría generar una previsualización automáticamente.

## Ampliación móvil solicitada

- Sincronizar todos los cambios de interfaz con la rama main autorizada para producción.
- Recuperar la última sección al reabrir la PWA, con prioridad de los enlaces explícitos.
- Reiniciar el desplazamiento de página al navegar y el del menú móvil al abrirlo.
- Ocultar el mensaje bajo el título y el resumen redundante en móvil.
- Ofrecer enlaces en tarjetas de resumen y próximos elementos y adelantar esos bloques al chat.
- Verificar compilación, siete pruebas de fechas/rutas/almacenamiento y la versión publicada en Chrome.
