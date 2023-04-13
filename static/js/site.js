"use strict";

var styleDark;
var styleLight;

function setToTheme(dark) {
  if (dark) {
    styleDark.removeAttribute("disabled");
    styleLight.setAttribute("disabled", "");
    localStorage.setItem("theme", "dark");
  }
  else {
    styleLight.removeAttribute("disabled");
    styleDark.setAttribute("disabled", "");
    localStorage.setItem("theme", "light");
  }
  styleDark.removeAttribute("media");
  styleLight.removeAttribute("media");
}

function isCurrentlyDark() {
  const readTheme = localStorage.getItem("theme");
  return readTheme === "dark" || (readTheme !== "light" && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
}

function documentReadyCallback() {
  styleDark = document.getElementById("style-dark");
  styleLight = document.getElementById("style-light");

  setToTheme(isCurrentlyDark());

  document.getElementById("dark-mode").addEventListener("click", () => {
    setToTheme(!isCurrentlyDark());
  });

  if (typeof mermaid !== "undefined") {
    mermaid.initialize({ startOnLoad: true });
  }

  if (typeof chartXkcd !== "undefined") {
    document.querySelectorAll(".chart").forEach((el, i) => {
      el.setAttribute("id", `chart-${i}`);

      let svg = document.getElementById(`chart-${i}`);
      let { type, ...chartData } = JSON.parse(el.textContent);
      new chartXkcd[type](svg, chartData);
    });
  }

  if (typeof Galleria !== "undefined") {
    document.querySelectorAll(".galleria").forEach((el, i) => {
      el.setAttribute("id", `galleria-${i}`);

      let { images } = JSON.parse(el.textContent);

      for (let image of images) {
        el.insertAdjacentHTML("beforeend",
          `<a href="${image.src}"><img src="${image.src}" data-title="${image.title}" data-description="${image.description}"></a>`
        );
      }

      Galleria.run(".galleria");
    });
  }

  if (typeof mapboxgl !== "undefined") {
    document.querySelectorAll(".map").forEach((el, i) => {
      el.setAttribute("id", `map-${i}`);

      mapboxgl.accessToken = el.querySelector(".mapbox-access-token").textContent.trim();
      let zoom = el.querySelector(".mapbox-zoom").textContent.trim();

      let map = new mapboxgl.Map({
        container: `map-${i}`,
        style: "mapbox://styles/mapbox/light-v10",
        center: [-96, 37.8],
        zoom: zoom,
      });

      map.addControl(new mapboxgl.NavigationControl());

      let geojson = JSON.parse(el.querySelector(".mapbox-geojson").textContent.trim());

      const center = [0, 0];

      geojson.features.forEach(function (marker) {
        center[0] += marker.geometry.coordinates[0];
        center[1] += marker.geometry.coordinates[1];

        new mapboxgl.Marker()
          .setLngLat(marker.geometry.coordinates)
          .setPopup(
            new mapboxgl.Popup({ offset: 25 }) // add popups
              .setHTML(
                "<h3>" +
                marker.properties.title +
                "</h3><p>" +
                marker.properties.description +
                "</p>"
              )
          )
          .addTo(map);
      });

      center[0] = center[0] / geojson.features.length;
      center[1] = center[1] / geojson.features.length;

      map.setCenter(center);
    });
  }

  if (typeof renderMathInElement !== "undefined") {
    renderMathInElement(document.body, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '$', right: '$', display: false },
        { left: '\\(', right: '\\)', display: false },
        { left: '\\[', right: '\\]', display: true }
      ]
    });
  }
};

if (document.readyState === 'loading') {  // Loading hasn't finished yet
  document.addEventListener('DOMContentLoaded', documentReadyCallback);
} else {  // `DOMContentLoaded` has already fired
  documentReadyCallback();
}
