# Recorridos automáticos

Desde la raíz del repositorio:

```sh
bun web/apps/client/scripts/test-gameplay.ts
```

Las pruebas recorren el juego con sus scripts, colisiones y secuencias originales en
el núcleo WASM. No abren una ventana ni reproducen imágenes o sonidos de Lisa: no
hace falta jugar manualmente para verificar la progresión implementada.

El runner usa la biblioteca local activa importada por el wizard. No descarga,
extrae, copia ni publica recursos del juego. También se puede elegir una biblioteca:

```sh
PT_TEST_PSARC=/ruta/chunk1.psarc PT_TEST_QAR=/ruta/texture.qar \
  bun web/apps/client/scripts/test-gameplay.ts
```

Requiere las dependencias instaladas y el núcleo compilado con `bun run build:wasm`.
Si faltan los recursos o el WASM, devuelve un error antes de ejecutar las pruebas;
no presenta pruebas omitidas por falta de recursos como una validación correcta.

## Seleccionar cobertura

```sh
# Validar recursos y selección sin ejecutar recorridos
bun web/apps/client/scripts/test-gameplay.ts --check

# Regresiones focalizadas
bun web/apps/client/scripts/test-gameplay.ts --suite fast

# Tres recorridos completos de la progresión implementada
bun web/apps/client/scripts/test-gameplay.ts --suite route

# Toda la cobertura de esta entrega (predeterminado)
bun web/apps/client/scripts/test-gameplay.ts --suite full
```

| Suite   | Comprobaciones                                                                                                                                                                                                            |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fast`  | Colisión de puertas, fragmentos del mundo y del menú, zoom, efectos de recogida, reloj concurrente, luces de secuencias, cancelación y reintento de etapas, almacén de guardado.                                          |
| `route` | Tres sesiones f010 → f005 → f020 → f030 → f040 → entrada de f060; aparición de Lisa en el susto de f030, aparición/desaparición de f040, llantos y cambios de luces, finalización de secuencias y liberación de recursos. |
| `full`  | Todo lo anterior, intro, actores y mecánicas de f020, recorrido de las primeras vueltas y restauración de guardado.                                                                                                       |

Se reutilizan los mismos tests de integración, sin mantener un segundo guion de
juego. Se ejecutan en un único proceso sin activar concurrencia entre tests para
no multiplicar la carga de archivos originales. Cada test tiene un límite de
cinco minutos; un fallo devuelve un código distinto de cero. Las tres sesiones
del recorrido también comparan las asignaciones nativas entre ciclos.

## Límites de la evidencia

Estas comprobaciones cubren las apariciones y mecánicas implementadas, incluida
la intro y los estados lógicos de Lisa en f030/f040. La entrada de f060 se reabre con luces, insectos y apertura del baño; la recogida
de la linterna, el resto del baño y f050 aún no se certifican. El estado visible de los actores se verifica en el runtime;
esto no sustituye comparar píxeles renderizados, WebGPU, audio audible, bloqueo del
ratón o presentación del menú en un navegador. Esas revisiones son una capa
separada y no se declaran aprobadas por este comando.

Las futuras apariciones de Lisa deben añadir aserciones de creación, visibilidad,
activación, finalización y limpieza al recorrido antes de ampliar esta cobertura.

## Guardado y reapertura

`bun run test:gameplay` ejecuta la suite completa desde la raíz. El guardado usa
`localStorage` del mismo navegador y origen (host/puerto), sin incluir recursos del
PKG. Conserva la vuelta alcanzada y los fragmentos recogidos; al volver se reanuda
al inicio de esa vuelta, no en mitad de una animación. Cerrar, salir al wizard o
recargar no borra el progreso. Reiniciar, tras confirmación, crea una partida nueva.

Se comprueban las escrituras tras transferencias y recogidas, la reconstrucción de
f020/f030/f040 en instancias nuevas de WASM, piezas ya recogidas ocultas y el
recorrido restaurado f040 → f060, conservando los fragmentos. Una copia anterior permite recuperar
un guardado dañado; los errores de almacenamiento se muestran y permiten reintentar.
Si ninguna copia se puede leer, no se sobrescribe con una partida nueva.

El guardado de f060 ya se reabre y ejecuta gc_p03_070. f060.test.ts verifica
luces, cucarachas y apertura del baño mediante los puntos de la ruta nativa;
no certifica el recorrido interior posterior ni comparación visual. La salida
a f050 permanece bloqueada hasta integrar el resto de esta vuelta.

### Perfil de fotogramas sin controlar el escritorio

El módulo servido `app.js` exporta `performanceReport()` y `resetPerformanceReport()`.
En una sesión de diagnóstico, importar ese módulo desde la misma ruta del juego permite
leer el informe después del recorrido, sin activar `?dev` ni cambiar el guardado.
Guarda las últimas 3600 muestras activas, agrupadas por floor/fase; informa intervalos
RAF p50/p95/p99, peor frame, tiempo CPU máximo y umbrales 33/50/100 ms.
No incluye pausas/pestañas ocultas ni confunde el delta limitado de simulación con el
intervalo real. No mide tiempo GPU; una causa GPU requiere perfiles adicionales.
Registrar resolución, equipo y ajustes junto al informe. Limpiar el informe antes de
cada ruta para separar carga fría y repetición. No se requiere un nuevo recurso HTTP.
