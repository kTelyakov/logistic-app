export const STATE_COUNT = 6

export const VERTEX_SHADER = `#version 300 es
precision highp float;
precision highp int;

layout(location = 0) in vec2 aCorner;   // угол квада в [-1, 1]
layout(location = 1) in float aX;       // метры, ось X на восток
layout(location = 2) in float aY;       // метры, ось Y на север
layout(location = 3) in float aHeading; // градусы по часовой от севера
layout(location = 4) in uint aState;    // код состояния
layout(location = 5) in float aSeen;    // last_seen в секундах относительно базы

uniform vec2 uCenter;      // мировой центр вида
uniform float uScale;      // пикселей в метре
uniform vec2 uViewport;    // размер области, пиксели CSS
uniform float uSizePx;     // размер маркера, пиксели CSS
uniform float uServerNow;  // время сервера, секунды относительно той же базы
uniform float uStaleAfter; // порог устаревания, секунды
uniform vec3 uColors[${STATE_COUNT}];

out vec2 vCorner;
out vec3 vColor;
out float vStale;

void main() {
  float h = radians(aHeading);
  // направление вперёд и вправо в экранных координатах (Y вниз)
  vec2 forward = vec2(sin(h), -cos(h));
  vec2 right = vec2(cos(h), sin(h));
  vec2 offset = (aCorner.x * right - aCorner.y * forward) * (uSizePx * 0.5);

  vec2 px = vec2(
    uViewport.x * 0.5 + (aX - uCenter.x) * uScale,
    uViewport.y * 0.5 - (aY - uCenter.y) * uScale
  ) + offset;
  gl_Position = vec4(px.x / uViewport.x * 2.0 - 1.0, 1.0 - px.y / uViewport.y * 2.0, 0.0, 1.0);

  vCorner = aCorner;
  vColor = uColors[min(aState, uint(${STATE_COUNT - 1}))];
  // Устаревание считает шейдер по времени сервера: CPU не обходит машины
  vStale = (uServerNow - aSeen) > uStaleAfter ? 1.0 : 0.0;
}
`

export const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vCorner;
in vec3 vColor;
in float vStale;
out vec4 outColor;

// Размер квада 1.3 от стрелки: запас под кольцо устаревшей машины
void main() {
  vec2 p = vCorner / 1.3;
  // Стрелка: остриё вверху, основание внизу
  float side = abs(p.x) - 0.8 * (p.y + 1.0) / 1.9;
  float arrow = max(side, p.y - 0.9);
  float shape = 1.0 - smoothstep(-0.03, 0.06, arrow);

  vec3 color = vColor;
  float alpha = shape;
  if (vStale > 0.5) {
    // Устаревшая: приглушённый цвет и кольцо, чтобы не терялась и не выглядела живой
    color = mix(vColor, vec3(0.55, 0.6, 0.66), 0.65);
    alpha = shape * 0.55;
    float ring = 1.0 - smoothstep(0.05, 0.13, abs(length(p) - 1.0));
    alpha = max(alpha, ring * 0.9);
    color = mix(color, vec3(0.8, 0.84, 0.9), ring);
  }
  outColor = vec4(color * alpha, alpha); // предумноженная альфа
}
`
