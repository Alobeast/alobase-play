const squares = document.querySelectorAll(".square");
const meterFill = document.getElementById("meter-fill");
const cpsReadout = document.getElementById("cps-readout");
const winBanner = document.getElementById("win-banner");
const explosion = document.getElementById("explosion");
const reloadControl = document.getElementById("reload-control");
const reloadButton = document.getElementById("reload-button");
const fasterPromptsContainer = document.getElementById("faster-prompts");

const MAX_CPS = 8.5; // clicks/sec needed to reach full speed
const ENERGY_SMOOTHING_UP = 2; // higher = energy climbs toward target faster
const ENERGY_SMOOTHING_DOWN = 0.3; // lower = slower, gentler coast back down
const COLOR_SMOOTHING_UP = 0.4; // lower than ENERGY_SMOOTHING_UP = slower to heat up
const COLOR_SMOOTHING_DOWN = 1.1; // higher than ENERGY_SMOOTHING_DOWN = quicker to cool down
const EASE_EXPONENT = 3.5; // higher = slower kickstart, sharper ramp near max
const COMMON_DEG_PER_SEC = 600; // shared spin speed for every square, at energy = 1
const SPREAD_DEG_PER_UNIT = 5; // extra twist per (index + 1), at energy = 1
const WIN_STROBE_MS = 1300; // full-screen blast takeover before it fades and reveals the wreckage
const WIN_RESET_TRANSITION_MS = 600;

const MAX_PROMPTS = 14; // "Faster!" prompts on screen at energy = 1
const PROMPT_MIN_SCALE = 0.6;
const PROMPT_MAX_SCALE = 2.2;
const PROMPT_FADE_MS = 300;
const PROMPT_EASE_EXPONENT = 3; // higher = later first appearance, quicker disappearance

const FIRE_COLOR_STOPS = [
  [0x9a, 0xa5, 0xb1], // cold steel, at energy = 0 (at rest)
  [0x7a, 0x1f, 0x1f], // dull maroon, at energy = 0.25
  [0xdc, 0x26, 0x26], // red-hot, at energy = 0.5
  [0xf9, 0x73, 0x16], // orange, at energy = 0.75
  [0xfd, 0xe0, 0x47], // blazing yellow, at energy = 1
];

const squareData = Array.from(squares).map((square, index) => ({
  square,
  baseWidth: (index + 1) * 4,
}));

squareData.forEach(({ square, baseWidth }) => {
  square.style.borderWidth = baseWidth + "px";
});

let clickTimes = [];
let energy = 0;
let colorEnergy = 0;
let commonAngle = 0;
let isWinning = false;
let lastFrame = performance.now();
let activePrompts = [];

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpColor(t) {
  const clamped = Math.min(Math.max(t, 0), 1);
  const segments = FIRE_COLOR_STOPS.length - 1;
  const scaled = clamped * segments;
  const index = Math.min(Math.floor(scaled), segments - 1);
  const localT = scaled - index;

  const [r0, g0, b0] = FIRE_COLOR_STOPS[index];
  const [r1, g1, b1] = FIRE_COLOR_STOPS[index + 1];
  const r = Math.round(lerp(r0, r1, localT));
  const g = Math.round(lerp(g0, g1, localT));
  const b = Math.round(lerp(b0, b1, localT));
  return `rgb(${r}, ${g}, ${b})`;
}

// All squares share `commonAngle` (so they're always mutually aligned by
// definition) plus a per-square twist that is a direct function of the
// current energy, not an accumulator. That twist eases back to 0 in lockstep
// with energy, so squares re-converge continuously as part of the same
// slowdown motion, with no separate "settle" correction needed afterward.
function applyVisuals(effectiveEnergy, colorEnergy) {
  const borderRadius = lerp(0, 50, effectiveEnergy) + "%";
  const opacity = lerp(1, 0.1, effectiveEnergy);
  const color = lerpColor(colorEnergy);

  squareData.forEach(({ square, baseWidth }, index) => {
    const spread = (index + 1) * SPREAD_DEG_PER_UNIT * effectiveEnergy;
    const angle = commonAngle + spread;
    const width = lerp(baseWidth, 60, effectiveEnergy);
    square.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`;
    square.style.borderRadius = borderRadius;
    square.style.opacity = opacity;
    square.style.borderWidth = width + "px";
    square.style.borderColor = color;
  });
}

function spawnPrompt() {
  const el = document.createElement("div");
  el.className = "faster-prompt";
  el.textContent = "Faster!";
  el.style.left = 10 + Math.random() * 80 + "%";
  el.style.top = 10 + Math.random() * 80 + "%";

  const rotation = (Math.random() * 2 - 1) * 20;
  fasterPromptsContainer.appendChild(el);
  requestAnimationFrame(() => el.classList.add("is-visible"));
  activePrompts.push({ el, rotation });
}

function despawnPrompt() {
  const prompt = activePrompts.pop();
  if (!prompt) return;
  prompt.el.classList.remove("is-visible");
  setTimeout(() => prompt.el.remove(), PROMPT_FADE_MS);
}

function updatePrompts(promptEnergy) {
  const desiredCount = Math.round(promptEnergy * MAX_PROMPTS);
  while (activePrompts.length < desiredCount) spawnPrompt();
  while (activePrompts.length > desiredCount) despawnPrompt();

  const scale = lerp(PROMPT_MIN_SCALE, PROMPT_MAX_SCALE, promptEnergy);
  activePrompts.forEach(({ el, rotation }) => {
    el.style.transform = `translate(-50%, -50%) rotate(${rotation}deg) scale(${scale})`;
  });
}

function triggerWin() {
  isWinning = true;
  document.body.classList.add("is-winning");
  explosion.style.backgroundColor = "";
  explosion.classList.add("is-visible", "is-exploding");
  winBanner.classList.add("is-visible");

  setTimeout(() => {
    // Freeze on whatever color the strobe last landed on instead of fading
    // it away — the aftermath screen is just that flat color plus the
    // banner/repair control, with the wrecked squares never uncovered.
    explosion.style.backgroundColor = getComputedStyle(explosion).backgroundColor;
    document.body.classList.remove("is-winning");
    explosion.classList.remove("is-exploding");
    reloadControl.classList.add("is-visible");
  }, WIN_STROBE_MS);
}

function repairGame() {
  winBanner.classList.remove("is-visible");
  reloadControl.classList.remove("is-visible");
  explosion.classList.remove("is-visible");
  explosion.style.backgroundColor = "";

  squareData.forEach(({ square }) => {
    square.classList.add("square--resetting");
  });

  clickTimes = [];
  energy = 0;
  colorEnergy = 0;
  commonAngle = 0;
  applyVisuals(0, 0);

  setTimeout(() => {
    squareData.forEach(({ square }) => {
      square.classList.remove("square--resetting");
    });
    isWinning = false;
  }, WIN_RESET_TRANSITION_MS);
}

reloadButton.addEventListener("click", repairGame);

document.addEventListener("click", () => {
  if (isWinning) return;
  clickTimes.push(performance.now());
});

function tick(now) {
  const dt = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;

  clickTimes = clickTimes.filter((t) => now - t <= 1000);
  const cps = clickTimes.length;
  cpsReadout.textContent = `${cps.toFixed(1)} clicks/sec`;

  if (!isWinning) {
    const targetEnergy = Math.min(cps / MAX_CPS, 1);
    const smoothing =
      targetEnergy > energy ? ENERGY_SMOOTHING_UP : ENERGY_SMOOTHING_DOWN;
    energy = lerp(energy, targetEnergy, 1 - Math.exp(-smoothing * dt));
    const effectiveEnergy = Math.pow(energy, EASE_EXPONENT);

    const colorSmoothing =
      targetEnergy > colorEnergy ? COLOR_SMOOTHING_UP : COLOR_SMOOTHING_DOWN;
    colorEnergy = lerp(
      colorEnergy,
      targetEnergy,
      1 - Math.exp(-colorSmoothing * dt)
    );

    commonAngle += COMMON_DEG_PER_SEC * effectiveEnergy * dt;

    const promptEnergy = Math.pow(energy, PROMPT_EASE_EXPONENT);

    applyVisuals(effectiveEnergy, colorEnergy);
    updatePrompts(promptEnergy);
    meterFill.style.width = energy * 100 + "%";

    if (energy >= 0.995) {
      triggerWin();
    }
  }

  requestAnimationFrame(tick);
}

requestAnimationFrame(tick);
