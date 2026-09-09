Traduce la web con los proveedores que elijas

LinguaLens es una extensión de traducción para navegadores diseñada para la flexibilidad. A diferencia de las herramientas vinculadas a un único proveedor cloud, LinguaLens te permite decidir dónde se ejecuta cada traducción: en tu propio equipo con LLMs locales, a través de las principales APIs cloud, mediante cualquier puerta de enlace compatible con OpenAI, o a través de una plantilla de API HTTP personalizable. Establece un proveedor por defecto, añade una cadena de respaldo opcional, y la traducción continúa incluso cuando tu servicio principal no está disponible.

POR QUÉ LINGUALENS

• Trae tu propio backend — Sin dependencia de un único servicio de traducción.
• Opción local primero — Usa Ollama o LM Studio para que el texto sensible permanezca en tu equipo.
• Cloud cuando lo necesites — OpenAI, DeepSeek, DeepL, Google Cloud Translation y más.
• Endpoints compatibles con OpenAI — Funciona con cualquier puerta de enlace o proxy que exponga /v1/chat/completions.
• API HTTP personalizada — Configura método, cabeceras, plantilla de cuerpo JSON y ruta de respuesta para sistemas propietarios.
• Flujo de trabajo resiliente — Proveedores de respaldo ordenados si el predeterminado falla durante la sesión.
• Modelo de privacidad honesto — LinguaLens no ejecuta servidores de traducción propios; tú decides quién recibe tu texto.
• Interfaz multilingüe — 9 idiomas de interfaz: English, 中文 (simplificado/tradicional), 日本語, 한국어, Français, Deutsch, Español, Русский.

PROVEEDORES DE TRADUCCIÓN

Local
• Ollama (preajuste por defecto) — se ejecuta en localhost:11434
• LM Studio — Usa la API local nativa de LM Studio

Preajustes cloud
• OpenAI, DeepSeek, DeepL (Gratuito y Pro), Google Cloud Translation

Avanzado
• Compatible con OpenAI — Cualquier URL base proporcionada por el usuario que exponga /v1/chat/completions
• API personalizada — Plantilla de solicitud HTTP totalmente configurable

Verifica la conectividad de cada proveedor desde Configuración antes de guardar. Las claves API (cuando son necesarias) se almacenan localmente en el almacenamiento del navegador.

CARACTERÍSTICAS

Traducción de selección
Selecciona texto en cualquier página web, incluidos los documentos PDF abiertos en el navegador. Elige entre cuatro modos de activación: un icono flotante cerca de tu selección (por defecto), traducción instantánea al seleccionar, mantener pulsada una tecla modificadora para activar, o desactivar el activador. Abre el panel para ver resultados, reintentar si falla, copiar la traducción o cerrarlo. Fija el panel para mantenerlo abierto durante varias selecciones. También disponible desde el menú contextual, o pulsa Alt+T para traducir la selección actual en un solo paso. Cambia el proveedor de traducción activo en cualquier momento desde la cabecera del panel. En páginas donde los scripts de contenido no pueden ejecutarse (páginas internas del navegador, tiendas de extensiones), el clic derecho en Traducir enruta la selección al panel lateral, que se abre automáticamente.

Traducción bilingüe de página completa
Convierte artículos, documentos y páginas largas en lectura bilingüe en línea o por sustitución sin salir del sitio. Alterna entre modos en cualquier momento desde la barra de estado. Inicia desde el popup ("Traducir esta página"), el menú contextual de la página, o Alt+Shift+T. Una barra de estado muestra el progreso y permite detener la traducción, restaurar el texto original o cambiar el modo de visualización.

Modos de traducción de página
• Calidad — Fragmentos más grandes, mejor contexto para traducción con LLM
• Velocidad — Fragmentos más pequeños, actualizaciones progresivas más rápidas

Traductor popup
Haz clic en el icono de la barra de herramientas para pegar o escribir texto, elige un idioma de destino y traduce al instante. Salta a Configuración o inicia la traducción completa de la página en la pestaña activa.

Panel lateral
Abre un espacio de trabajo de traducción dedicado desde el popup. Establece los idiomas de origen y destino, intercámbialos, consulta los resultados y explora el historial de traducciones recientes almacenado localmente en tu dispositivo. Requiere Chromium 114 o superior.

Configuración e inicio
En la primera instalación, Configuración se abre automáticamente con una breve guía de configuración. Configura idiomas, proveedor predeterminado, orden de respaldo, plantilla de prompt LLM y opciones por proveedor, como desactivar la salida «thinking» en modelos compatibles para obtener traducciones más rápidas y limpias.

Rendimiento
La caché de traducción integrada reduce las llamadas repetidas a la API para texto idéntico durante la navegación.

ATAJOS DE TECLADO

Alt+T — Traducir selección
Alt+Shift+T — Traducir página completa
Alt+M — Cambiar modo de activación de selección (icono → instantáneo → tecla mod. → desactivado)

Si los atajos entran en conflicto con otras extensiones, reasigna los atajos en la configuración de atajos de extensiones de tu navegador.

PRIMEROS PASOS

1. Instala LinguaLens. Configuración se abre en la primera ejecución.
2. Desplázate hasta Proveedores de traducción. Activa al menos un backend.
3. Establece la URL base, el modelo y la clave API si es necesario. Haz clic en Verificar y luego en Guardar configuración.
4. Abre cualquier página https normal y prueba la traducción de selección o de página completa.

Consejo para Ollama: ejecuta `ollama pull llama3` e inicia Ollama con la variable de entorno OLLAMA_ORIGINS configurada al origen de tu extensión si el navegador no puede conectarse localmente.

PRIVACIDAD

LinguaLens no ejecuta sus propios servidores de traducción. El texto que traduces se envía únicamente a los proveedores que actives. La configuración y las claves API permanecen en tu dispositivo. Consulta la URL de la política de privacidad en esta ficha. Revisa las políticas de terceros para cualquier API cloud que utilices.

LIMITACIONES

• La traducción de página completa no funciona en páginas restringidas (páginas internas del navegador, tienda de extensiones, etc.); la traducción de selección se enruta al panel lateral (Chromium 114+)
• Requiere al menos un proveedor configurado y funcional para traducir
• El panel lateral requiere Chromium 114+
• Las páginas muy largas pueden requerir tiempo y múltiples llamadas a la API

SOPORTE

Problemas y comentarios: https://github.com/q-jade/lingualens/issues
Página del proyecto: https://github.com/q-jade/lingualens

Lee noticias extranjeras, documentación técnica, investigaciones y foros con el flujo de traducción que tú controlas.
