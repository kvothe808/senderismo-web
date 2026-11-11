# senderismo-web

Página de la app Senderismo (GitHub Pages: https://kvothe808.github.io/senderismo-web/).

- `index.html`: presentación de la app.
- `privacidad.html`: política de privacidad (la pide Google para el acceso a Drive).
- `editor/`: **editor de rutas para el ordenador** (https://kvothe808.github.io/senderismo-web/editor/).
  Dibuja o cambia una ruta y la guarda en GPX para pasarla a la app como «Ruta por hacer».
  - `editor.js`, `editor.css`, `index.html`: la página.
  - `lib/`: la lógica de la app (km, desnivel, editar, paradas, GPX), **generada** desde
    `senderismo-app/src/lib` con `sh scripts/build-web-editor.sh ../senderismo-web`. No editar a mano.
  - Usa Leaflet (unpkg), mapas de OpenStreetMap, OpenTopoMap e IGN, caminos de BRouter, altitudes de
    Open-Meteo y búsqueda de Nominatim. No guarda nada fuera del navegador (borrador en localStorage).
