# JapanRefactor

Extensión de google que convierte YouTube en una herramienta para aprender japonés: subtítulos con furigana y traducción al español, palabras marcadas por colores según las conozcas, Compatible con extensiones tipo Yomitan

## Funciones

- **Subtítulos dobles:** japonés con furigana y, debajo, la traducción al español (se muestra u oculta con el botón **ES**).
- **Palabras por colores:** morado = desconocida, naranja = para aprender, blanco = conocida. Las conocidas no muestran furigana; aparece al pasar el ratón.
- **Palabras completas y expresiones:** las palabras se agrupan como en Yomitan (タメ口, お話, して → する) y se detectan expresiones como 気を付けて o かもしれない, que también se pueden marcar.
- **Subtítulos automáticos palabra a palabra:** cada palabra aparece cuando se dice, no antes.
- **Pausa al pasar el ratón** por los subtítulos (se puede desactivar).
- **Flechas** a la izquierda del video: frase anterior, repetir frase y frase siguiente.
- **Texto seleccionable**, para usar Yomitan u otros diccionarios emergentes.
- **Interruptor ON/OFF** junto al minutero y una **tuerca** con opciones: opacidad del fondo, tamaño de letra y pausa con el ratón.

## Uso

Abre en YouTube un video con subtítulos en japonés (manuales o automáticos). La extensión activa los subtítulos sola; el español es la traducción de YouTube.

| Acción | Resultado |
|---|---|
| Clic en una palabra | Conocida (blanco) |
| Clic derecho en una palabra | Para aprender (naranja) |
| Repetir el mismo clic | Vuelve a desconocida (morado) |
| Alt+clic o Alt+clic derecho en una expresión subrayada | Marca la expresión entera |
| Seleccionar varias palabras | Botones **Conocida** / **Para aprender** para marcar esa frase |
| Flechas ‹ ↻ › a la izquierda del video | Frase anterior / repetir / siguiente |

Las palabras se guardan en el propio navegador y se mantienen al cerrarlo o reiniciar el PC.

## Instalación

Funciona en navegadores basados en Chromium: Chrome, Brave, Edge, Opera, Vivaldi.

### Desde el código

Requisitos: [Node.js](https://nodejs.org/) 20 o superior.

```bash
git clone https://github.com/MiguelAC3/Ja-Es-Subtitulos-para-youtube.git
cd Ja-Es-Subtitulos-para-youtube
npm install
npm run build
```

Esto genera la carpeta `dist/`, que es la extensión. Para cargarla:

1. Abre `chrome://extensions` (o `brave://extensions`, `edge://extensions`).
2. Activa el **Modo de desarrollador** (arriba a la derecha).
3. Pulsa **Cargar descomprimida** y elige la carpeta `dist/`.
4. Abre un video de YouTube con subtítulos en japonés.

### Con la extensión ya compilada

Si tienes la carpeta `dist/` ya compilada (por ejemplo, en un ZIP), no hace falta Node.js: descomprímela en una ubicación fija y cárgala como en los pasos 1–3.

> **Importante:** no muevas ni borres la carpeta después de cargarla. El navegador la lee desde ahí, y si la cargas desde otra ubicación la trata como otra extensión y pierdes las palabras guardadas.

### Actualizar

```bash
git pull
npm install
npm run build
```

Después pulsa ⟳ en la página de extensiones y recarga las pestañas de YouTube (F5).

## Desarrollo

| Comando | Qué hace |
|---|---|
| `npm run build` | Compila la extensión en `dist/` |
| `npm run typecheck` | Comprueba los tipos de TypeScript |

Estructura:

- `src/inject/`: se ejecuta en la página de YouTube y obtiene los subtítulos del reproductor.
- `src/content/`: interfaz, furigana (kuromoji), agrupación de palabras y expresiones (JMdict) y palabras guardadas.
- `src/shared/`: formato de los subtítulos, común a ambas partes.
- `scripts/build-jmdict.mjs` y `data/jmdict.tsv.gz`: índice compacto de JMdict que usa la extensión.

Para actualizar JMdict, descarga el `jmdict-eng-*.json` más reciente de [jmdict-simplified](https://github.com/scriptin/jmdict-simplified/releases) y ejecuta:

```bash
node scripts/build-jmdict.mjs ruta/a/jmdict-eng-X.json
```

## Privacidad

Todo se guarda en el almacenamiento local del navegador. La extensión no envía datos a ningún servidor; solo descarga de YouTube los subtítulos del video que estás viendo.

## Créditos y licencias

- **Código:** licencia MIT (ver [LICENSE](LICENSE)).
- **[JMdict](https://www.edrdg.org/jmdict/j_jmdict.html):** © Electronic Dictionary Research and Development Group, licencia [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). El archivo `data/jmdict.tsv.gz` deriva de JMdict a través de [jmdict-simplified](https://github.com/scriptin/jmdict-simplified) y se distribuye bajo esa misma licencia.
- **[kuromoji.js](https://github.com/takuyaa/kuromoji.js):** licencia Apache-2.0, con el diccionario IPADIC.
- **[Material Icons](https://fonts.google.com/icons):** licencia Apache-2.0.

Inspirada en [Language Reactor](https://www.languagereactor.com/). No está afiliada a Language Reactor, YouTube ni Google.
