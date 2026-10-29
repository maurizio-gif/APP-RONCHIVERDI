// Assembla composition/index.html + composition/compositions/*.html dalle scene di build/scenes/.
// Uso: node build/build.mjs   (da brag-output/)
import { mkdirSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sceneFile, FONTS } from './lib.mjs';
import { ORDER } from './order.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const COMP = join(AQUI, '..', 'composition');
const SKILL = '/root/.claude/skills/synced/6984d61d-26d7-450e-bd73-be36bf394125_4cc283da-eada-4dc9-9861-34ed5067d574/brag/assets';
mkdirSync(join(COMP, 'compositions'), { recursive: true });

// ── le scene ────────────────────────────────────────────────────────────────
const scene = [];
let t = 0;
for (const nome of ORDER) {
  let s;
  if (/^ca\d$/.test(nome)) {
    const { card } = await import('./scenes/cards.mjs');
    s = card(nome);
  } else {
    const m = await import(`./scenes/${nome}.mjs`);
    s = await m.default();
  }
  s.start = +t.toFixed(2);
  t = +(t + s.dur).toFixed(2);
  scene.push(s);
}
const TOTALE = t;
if (process.env.TABELLA) for (const s of scene) console.log(`${s.id.padEnd(5)} ${s.start.toFixed(1).padStart(6)} → ${(s.start + s.dur).toFixed(1).padStart(6)}  (${s.dur}s)`);
console.log(`Scene: ${scene.length}, durata totale ${TOTALE.toFixed(1)} s (${Math.floor(TOTALE / 60)}:${String(Math.round(TOTALE % 60)).padStart(2, '0')})`);

for (const s of scene) {
  writeFileSync(join(COMP, 'compositions', `${s.id}.html`), sceneFile(s));
}

// ── audio ───────────────────────────────────────────────────────────────────
const usati = new Set();
const copia = (rel) => {
  if (usati.has(rel)) return;
  const da = join(SKILL, rel);
  if (!existsSync(da)) throw new Error(`File audio mancante: ${rel}`);
  const a = join(COMP, 'assets', rel);
  mkdirSync(dirname(a), { recursive: true });
  copyFileSync(da, a);
  usati.add(rel);
};

// Le tracce bundled hanno picchi alti e poca densità: si normalizzano (EBU R128) una volta, in un file locale, così il volume si governa con un numero solo.
const LUFS_TRACCIA = -21;
const normalizza = (rel) => {
  const stem = rel.split('/').pop().replace('.mp3', '');
  const out = `music/${stem}.norm.mp3`;
  const a = join(COMP, 'assets', out);
  if (!existsSync(a)) {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(COMP, 'assets', rel), '-af', `loudnorm=I=${LUFS_TRACCIA}:TP=-2:LRA=9`, '-ar', '48000', '-c:a', 'libmp3lame', '-b:a', '192k', a]);
  }
  return out;
};
const music = [];
// Una traccia per tratto, con dissolvenza incrociata sui confini di capitolo (le schede-capitolo indicate in CAMBI).
const CAMBI = ['s05'];
const confini = CAMBI.map((c) => scene.find((s) => s.id === c).start);
const TRACCE = [
  ['music/happy-beats-business-moves-vol-12-by-ende-dot-app.mp3', 117.4], // pulita: processo, vendita, codice, CRM
  ['music/happy-beats-business-moves-vol-9-by-ende-dot-app.mp3', 113.6], // da Chiron in poi
];
const XF = 4;
const MUSICA_VOL = +(process.env.MUSICA_VOL ?? 1);
const SFX_GAIN = +(process.env.SFX_GAIN ?? 1.0);
const punti = [0, ...confini];
punti.forEach((inizio, i) => {
  const prossimo = i < punti.length - 1 ? punti[i + 1] : TOTALE;
  const start = i === 0 ? 0 : inizio - XF / 2;
  const fine = i < punti.length - 1 ? prossimo + XF / 2 : TOTALE;
  const [file, durFile] = TRACCE[i];
  if (fine - start > durFile + 0.01) console.warn(`  ⚠ traccia ${i} troppo corta: serve ${(fine - start).toFixed(1)} s, ha ${durFile} s`);
  const dur = Math.min(fine - start, durFile);
  copia(file);
  const norm = normalizza(file);
  music.push({
    id: `music-${i + 1}`,
    src: `assets/${norm}`,
    start: +start.toFixed(2),
    dur: +dur.toFixed(2),
    vol: MUSICA_VOL,
    fadeIn: i === 0 ? 2.5 : XF,
    fadeOut: i === punti.length - 1 ? 5 : XF,
  });
});

// Effetti: ogni scena elenca {t, f, v}; qui diventano assoluti e distribuiti su corsie senza sovrapposizioni.
const sfx = [];
for (const s of scene) for (const e of s.sfx || []) sfx.push({ ...e, abs: s.start + e.t });
sfx.sort((a, b) => a.abs - b.abs);
const corsie = []; // fine dell'ultimo clip per corsia
const durataFile = (rel) => {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(COMP, 'assets', rel)]).toString().trim();
  return Math.max(0.01, +(+out).toFixed(2));
};
const audioSfx = sfx.map((e, i) => {
  copia(`sfx/${e.f}`);
  let c = corsie.findIndex((fine) => fine <= e.abs);
  if (c < 0) {
    c = corsie.length;
    corsie.push(0);
  }
  const dd = durataFile(`sfx/${e.f}`);
  corsie[c] = e.abs + dd;
  return `<audio id="sfx-${String(i + 1).padStart(3, '0')}" data-start="${e.abs.toFixed(2)}" data-duration="${dd}" data-track-index="${20 + c}" data-volume="${+((e.v ?? 0.5) * SFX_GAIN).toFixed(2)}" src="assets/sfx/${e.f}"></audio>`;
});

const audioMusic = music.map(
  (m) =>
    `<audio id="${m.id}" data-start="${m.start}" data-duration="${m.dur}" data-track-index="${10 + (+m.id.split('-')[1] % 2)}" data-volume="${m.vol}" data-fade-in="${m.fadeIn}" data-fade-out="${m.fadeOut}" src="${m.src}"></audio>`
);

// ── index.html ──────────────────────────────────────────────────────────────
const hosts = scene
  .map(
    (s, i) =>
      `<div id="${s.id}" data-composition-id="${s.id}" data-composition-src="compositions/${s.id}.html" data-start="${s.start}" data-duration="${s.dur}" data-track-index="1" data-width="1920" data-height="1080" data-track-kind="graphics"></div>`
  )
  .join('\n      ');

const index = `<!doctype html>
<html lang="it">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="assets/vendor/gsap.min.js"></script>
    <link rel="stylesheet" href="assets/css/app.css" />
    <link rel="stylesheet" href="assets/css/film.css" />
    <style>${FONTS}</style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${TOTALE}" data-width="1920" data-height="1080">
      ${hosts}
      ${audioMusic.join('\n      ')}
      ${audioSfx.join('\n      ')}
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`;
writeFileSync(join(COMP, 'index.html'), index);
console.log(`Musica: ${music.length} tracce · effetti: ${audioSfx.length} su ${corsie.length} corsie`);
