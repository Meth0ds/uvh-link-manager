# Fuente de los QR

`manrope.ttf` es la instancia estática de Manrope Medium (peso 500) del archivo
variable oficial `ofl/manrope/Manrope[wght].ttf` de Google Fonts. Se distribuye
bajo la licencia OFL adjunta, conservando los avisos de autoría dentro del TTF.

La instancia se creó con FontTools 4.60.1 (`instantiateVariableFont`, eje
`wght=500`, `updateFontNames=True`). Tener una fuente estática evita que un
exportador interprete el peso variable por defecto como ExtraLight: SVG, PNG y
PDF usan los mismos contornos legibles. Manrope se incrusta también en el PDF.

Fuente original: https://github.com/google/fonts/tree/main/ofl/manrope
