// Personnage « Pompon » : une boule de poussière qui devient un héros du ménage.
// Dessiné en SVG ; la couleur dépend de la personne, l'apparence du niveau atteint.

export const LEVELS = [
  { points: 0, name: 'Grain de poussière' },
  { points: 50, name: 'Pompon' },
  { points: 150, name: 'Petit balai' },
  { points: 300, name: 'Pro du rangement' },
  { points: 600, name: 'Super-héros du ménage' },
  { points: 1000, name: 'Légende du ménage' },
];

export function levelFor(points) {
  let level = 0;
  LEVELS.forEach((l, i) => {
    if (points >= l.points) level = i;
  });
  return level;
}

// Teinte stable par personne (à partir de son identifiant).
export function hueFor(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

function fluff(cx, cy, r, color, bumps) {
  // Corps « duveteux » : un disque entouré de petites bosses.
  let s = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>`;
  for (let i = 0; i < bumps; i += 1) {
    const a = (i / bumps) * Math.PI * 2;
    const x = cx + Math.cos(a) * r * 0.92;
    const y = cy + Math.sin(a) * r * 0.92;
    s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r * 0.24).toFixed(1)}" fill="${color}"/>`;
  }
  return s;
}

export function characterSvg(level, hue = 160) {
  const grey = level === 0;
  const body = grey ? '#9aa3a1' : `hsl(${hue} 62% 62%)`;
  const shade = grey ? '#7d8684' : `hsl(${hue} 55% 48%)`;
  const r = [22, 27, 29, 30, 31, 32][level];
  const cx = 60;
  const cy = 72;
  let s = '';

  // Halo doré pour la légende
  if (level >= 5) {
    s += '<circle cx="60" cy="68" r="50" fill="#f2c94c" opacity="0.25"/>';
    s += '<circle cx="60" cy="68" r="42" fill="#f2c94c" opacity="0.25"/>';
  }

  // Cape (dans le dos)
  if (level >= 4) {
    s += `<path d="M${cx - 22} ${cy - 14} Q${cx - 40} ${cy + 30} ${cx - 30} ${cy + 38} L${cx + 30} ${cy + 38} Q${cx + 40} ${cy + 30} ${cx + 22} ${cy - 14} Z" fill="#d64545"/>`;
  }

  // Corps
  s += fluff(cx, cy + 3, r, shade, 14);
  s += fluff(cx, cy, r, body, 14);

  // Pieds
  if (!grey) {
    s += `<ellipse cx="${cx - 11}" cy="${cy + r + 4}" rx="7" ry="4" fill="${shade}"/>`;
    s += `<ellipse cx="${cx + 11}" cy="${cy + r + 4}" rx="7" ry="4" fill="${shade}"/>`;
  }

  // Bandeau du pro
  if (level === 3) {
    s += `<rect x="${cx - r}" y="${cy - r * 0.62}" width="${r * 2}" height="7" rx="3" fill="#2f7d6d"/>`;
    s += `<path d="M${cx + r - 2} ${cy - r * 0.62 + 3} l9 -5 l-1 9 Z" fill="#2f7d6d"/>`;
  }

  // Yeux
  const ey = cy - 4;
  if (grey) {
    // endormi
    s += `<path d="M${cx - 11} ${ey} q4 3 8 0" stroke="#3b4442" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;
    s += `<path d="M${cx + 3} ${ey} q4 3 8 0" stroke="#3b4442" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;
    s += `<text x="${cx + 18}" y="${cy - 22}" font-size="11" font-family="sans-serif" fill="#6b7774">z</text>`;
    s += `<text x="${cx + 25}" y="${cy - 30}" font-size="8" font-family="sans-serif" fill="#6b7774">z</text>`;
  } else {
    if (level >= 4) {
      // masque de héros
      s += `<rect x="${cx - 19}" y="${ey - 8}" width="38" height="13" rx="6" fill="#1d2624"/>`;
    }
    for (const dx of [-8, 8]) {
      s += `<circle cx="${cx + dx}" cy="${ey}" r="5" fill="#fff"/>`;
      s += `<circle cx="${cx + dx + 1}" cy="${ey + 1}" r="2.6" fill="#1d2624"/>`;
      s += `<circle cx="${cx + dx + 2}" cy="${ey - 1}" r="1" fill="#fff"/>`;
    }
    // joues
    s += `<ellipse cx="${cx - 15}" cy="${ey + 9}" rx="4" ry="2.5" fill="#ff8fa3" opacity="0.7"/>`;
    s += `<ellipse cx="${cx + 15}" cy="${ey + 9}" rx="4" ry="2.5" fill="#ff8fa3" opacity="0.7"/>`;
    // sourire (plus grand avec le niveau)
    const w = 4 + level;
    s += `<path d="M${cx - w} ${ey + 9} q${w} ${4 + level} ${w * 2} 0" stroke="#1d2624" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;
  }

  // Balai tenu devant le corps
  if (level >= 2) {
    s += `<line x1="${cx + 40}" y1="${cy - 30}" x2="${cx + 30}" y2="${cy + 26}" stroke="#8a5a2b" stroke-width="4" stroke-linecap="round"/>`;
    s += `<path d="M${cx + 21} ${cy + 24} L${cx + 39} ${cy + 27} L${cx + 40} ${cy + 44} L${cx + 17} ${cy + 40} Z" fill="#f2c94c" stroke="#d9a92e" stroke-width="1.5"/>`;
    s += `<path d="M${cx + 24} ${cy + 29} L${cx + 23} ${cy + 39} M${cx + 30} ${cy + 30} L${cx + 29} ${cy + 41} M${cx + 36} ${cy + 30} L${cx + 36} ${cy + 42}" stroke="#d9a92e" stroke-width="1.2"/>`;
    s += `<circle cx="${cx + 35}" cy="${cy + 2}" r="5.5" fill="${body}" stroke="${shade}" stroke-width="1.5"/>`;
  }

  // Couronne
  if (level >= 5) {
    const top = cy - r - 14;
    s += `<path d="M${cx - 14} ${top + 14} L${cx - 14} ${top + 2} L${cx - 7} ${top + 9} L${cx} ${top} L${cx + 7} ${top + 9} L${cx + 14} ${top + 2} L${cx + 14} ${top + 14} Z" fill="#f2c94c" stroke="#d9a92e" stroke-width="1.5"/>`;
    s += `<circle cx="${cx}" cy="${top + 9}" r="2" fill="#d64545"/>`;
  }

  // Étincelles
  const sparkle = (x, y, k) =>
    `<path d="M${x} ${y - k} L${x + k * 0.25} ${y - k * 0.25} L${x + k} ${y} L${x + k * 0.25} ${y + k * 0.25} L${x} ${y + k} L${x - k * 0.25} ${y + k * 0.25} L${x - k} ${y} L${x - k * 0.25} ${y - k * 0.25} Z" fill="${level >= 5 ? '#f2c94c' : '#ffffff'}" stroke="${level >= 5 ? '#d9a92e' : '#c9d3d0'}" stroke-width="0.8"/>`;
  if (level >= 3) s += sparkle(22, 34, 7) + sparkle(98, 96, 5);
  if (level >= 5) s += sparkle(100, 28, 6) + sparkle(18, 92, 5);

  return `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${LEVELS[level].name}">${s}</svg>`;
}
