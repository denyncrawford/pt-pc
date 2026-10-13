# Prototipo local WebGPU / WASM

Este directorio añade un laboratorio independiente al port nativo. **No es una
compilación web del juego completo.** WebGPU dibuja la escena; WASM decodifica
geometría FMDL y reutiliza `src/engine/core/strcode.cpp` del motor para el cifrado
individual de entradas FPK. No incluye archivos de P.T.

## Ejecutar el build incluido

Sirve `web/dist` por HTTP local, por ejemplo:

```sh
python3 -m http.server 8080 --bind 127.0.0.1 --directory web/dist
```

Abre http://127.0.0.1:8080 en un navegador con WebGPU. No abras el HTML con
`file://`. La escena inicial es un pasillo sintético con linterna aproximada.
Pulsa «Activar cámara», usa WASD y ratón; Q/E permite subir o bajar y Esc suelta
el ratón. No hay colisiones. «Encuadrar» sitúa la cámara frente al modelo.

## Archivos locales necesarios

- **Ahora: `chunk1.psarc`**, de la copia extraída CUSA01127. El visor lee el
  índice, busca paquetes `hallway`, sigue referencias FPK/FPKD existentes y
  ofrece los modelos FMDL encontrados en un selector. También acepta FPK/FPKD
  o FMDL individuales. Ningún asset se sube; no se solicita un servidor externo.
- **Siguiente fase: `texture.qar` y `pathid_list_ps4.bin`** para añadir las
  texturas y resolver las rutas del juego. Este prototipo no los consume todavía.
- Un PKG sin extraer **no es compatible** con el visor. No necesita `eboot.bin`,
  módulos de PS4 ni archivos de instalación.

El importador usa `File.slice()` para leer regiones del PSARC y
`DecompressionStream('deflate')` para los bloques zlib. No carga el PSARC entero
en memoria. Sí carga y descomprime un paquete o modelo a la vez, con límite de
128 MiB por entrada; la búsqueda está limitada a 128 paquetes. El paquete se
vuelve a leer al seleccionar un modelo para no retener todos los paquetes.

## Compilar y verificar

Con Emscripten 6.0.12 activado:

```sh
bash web/build.sh
node --test web/tests/import.test.js
```

Los tests usan archivos sintéticos, sin assets comerciales, y comprueban la
ruta PSARC comprimido → FPK → FMDL → WASM, posiciones y normales float32/float16,
cifrado individual con StrCode64, índices y entradas truncadas o fuera de rango.

## Límites y siguiente hito

- Modelos individuales con posiciones/normales, iluminación de prueba y cámara.
- No reconstruye todavía las instancias, jerarquías y transformaciones FOX2.
  Por ello seleccionar un modelo del pasillo no equivale a cargar todo el mapa.
- No hay texturas originales, materiales Fox, sombras, animación/esqueleto,
  sonido, scripts, colisiones ni guardado. Los modelos animados se muestran
  como geometría estática en sus coordenadas almacenadas.
- El parser admite posiciones/normales float32 y float16 e índices uint16;
  devuelve un error explícito ante otros formatos relevantes.
- Validado el importador con un dump local CUSA01127: 113 modelos FMDL
  decodificados por WASM sin errores. La arquitectura shsb_hous001.fmdl tiene
  32.670 vértices y 29.669 triángulos y se selecciona por defecto.
  Pendiente validar visualmente, reconstruir FOX2, texturas y materiales.

El código conserva la licencia MIT del repositorio; los recursos del juego no
están cubiertos por esa licencia ni se distribuyen aquí.
