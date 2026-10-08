// Generates assets/logo.svg: a chili pepper with a glossy highlight over a gear —
// Pepper (the Wayfarers mechanic) as a workshop mark. Run after editing:
//   node scripts/make-logo.mjs
import { writeFileSync } from "node:fs";

// A gear silhouette as a polygon: alternating tooth flanks and root gaps.
function gear(cx, cy, R, r, teeth) {
  const step = (Math.PI * 2) / teeth;
  const hwOut = step * 0.22; // half-width of a tooth at the outer radius
  const hwIn = step * 0.32; // half-width of a root gap at the inner radius
  const at = (radius, angle) =>
    `${(cx + radius * Math.cos(angle)).toFixed(1)},${(cy + radius * Math.sin(angle)).toFixed(1)}`;
  const pts = [];
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    pts.push(at(R, a - hwOut), at(R, a + hwOut));
    const mid = a + step / 2;
    pts.push(at(r, mid - hwIn), at(r, mid + hwIn));
  }
  return `M ${pts.join(" L ")} Z`;
}

// The pod is drawn in a local frame whose centroid sits at (270, 250); the group
// transform rotates it ~22 degrees (leaning right) and re-centers it on the badge.
const PLACE = "translate(256 256) rotate(22) translate(-270 -250)";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Pepper">
  <!-- Workshop badge: warm paper ground, like the extension's popup -->
  <rect width="512" height="512" rx="112" fill="#FFF8EC"/>
  <g transform="${PLACE}">
    <!-- Gear: the machine shop, behind the pepper's shoulder -->
    <path d="${gear(372, 124, 102, 68, 8)}" fill="#33302B"/>

    <!-- Chili pod: wide shoulder, crescent lean, pointed tip -->
    <g transform="translate(-14 0)">
      <path d="M 244 96
               C 312 100, 354 160, 362 220
               C 370 282, 358 342, 334 384
               C 326 408, 300 414, 286 396
               C 256 336, 222 264, 216 200
               C 210 144, 222 102, 244 96 Z"
            fill="#D2493C" stroke="#B23A30" stroke-width="9" stroke-linejoin="round"/>
      <!-- Glossy highlight along the left edge -->
      <path d="M 240 134 C 228 182, 230 250, 260 306"
            stroke="#E8837A" stroke-width="17" stroke-linecap="round" fill="none" opacity="0.9"/>
    </g>
    <!-- Glossy highlight along the left edge -->
    <path d="M 232 132 C 220 180, 222 250, 252 306"
          stroke="#E8837A" stroke-width="16" stroke-linecap="round" fill="none" opacity="0.9"/>
    <!-- Stem and leaf -->
    <path d="M 240 94 C 238 68, 228 52, 212 44" stroke="#4F8A4A" stroke-width="20" stroke-linecap="round" fill="none"/>
    <path d="M 214 44 C 192 32, 168 38, 158 56 C 174 72, 198 74, 214 62 Z" fill="#4F8A4A"/>
  </g>
</svg>
`;

writeFileSync(new URL("../assets/logo.svg", import.meta.url), svg);
console.log("wrote assets/logo.svg");
