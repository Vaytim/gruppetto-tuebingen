// Bewegung auf der Website: weiches Scrollen (Lenis), "tanzende" Karten und
// der horizontale Wipe für die kommenden Events (Vorbild: Riders-&-Ambassadors-Slider
// auf aboutyoupangea-festival.de/sports).
import Lenis from "lenis";

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let lenis: Lenis | null = null;
let velocity = 0;
let lastY = 0;

/** Weiches Scrollen für die ganze Seite. Bei "Bewegung reduzieren" bleibt das normale Scrollen. */
export function initSmoothScroll(): Lenis | null {
  if (lenis || reduced()) return lenis;
  // Tempo des weichen Scrollens:
  //  lerp            → wie stark die Seite "nachgleitet" (kleiner = langsamer/weicher, vorher 0.09)
  //  wheelMultiplier → wie weit ein Mausrad-/Trackpad-Schritt scrollt (1 = normal)
  lenis = new Lenis({ autoRaf: true, lerp: 0.05, wheelMultiplier: 0.75, touchMultiplier: 0.9, anchors: { duration: 1.6 } });
  lenis.on("scroll", (l: Lenis) => (velocity = l.velocity));
  // Menü offen → Seite darunter nicht scrollen
  new MutationObserver(() => {
    if (document.body.classList.contains("menu-open")) lenis?.stop();
    else lenis?.start();
  }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  return lenis;
}

export const getLenis = () => lenis;

/** Zu einer absoluten Scrollposition (weich, wenn Lenis aktiv ist) */
export function scrollToY(y: number, immediate = false) {
  if (lenis) lenis.scrollTo(y, { immediate });
  else window.scrollTo({ top: y, behavior: immediate ? "auto" : "smooth" });
}

// Ohne Lenis: Geschwindigkeit aus dem normalen Scrollen schätzen
window.addEventListener(
  "scroll",
  () => {
    if (lenis) return;
    velocity = window.scrollY - lastY;
    lastY = window.scrollY;
  },
  { passive: true },
);

// Eine gemeinsame Schleife: Scroll-Geschwindigkeit → weich gedämpfter "Tanz"-Wert
let dance = 0;
let loopStarted = false;
function startDanceLoop() {
  if (loopStarted) return;
  loopStarted = true;
  const loop = () => {
    requestAnimationFrame(loop);
    velocity *= 0.9; // klingt ab, sobald nicht mehr gescrollt wird (Scroll-Events setzen sie neu)
    const target = Math.max(-60, Math.min(60, velocity));
    dance += (target - dance) * 0.08;
    if (Math.abs(dance) < 0.005) dance = 0;
  };
  requestAnimationFrame(loop);
}

/**
 * Karten leicht schräg stellen und beim Scrollen "mittanzen" lassen –
 * je schneller gescrollt wird, desto mehr wackeln sie, danach beruhigen sie sich.
 */
export function danceCards(container: HTMLElement, selector = ".slide") {
  const tilts = [1.6, -0.6, 0.9, -1.4, 0.4, -1.1, 1.2, -0.3];
  const apply = () =>
    container.querySelectorAll<HTMLElement>(selector).forEach((el, i) => {
      el.style.setProperty("--tilt", `${tilts[i % tilts.length]}deg`);
      el.dataset.danceSign = i % 2 ? "-1" : "1";
    });
  apply();
  new MutationObserver(apply).observe(container, { childList: true });
  if (reduced()) return;

  startDanceLoop();
  let visible = false;
  let lastApplied = NaN;
  new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(container);
  const tick = () => {
    requestAnimationFrame(tick);
    if (!visible || dance === lastApplied) return;
    lastApplied = dance;
    container.querySelectorAll<HTMLElement>(selector).forEach((el, i) => {
      const s = Number(el.dataset.danceSign ?? 1);
      el.style.setProperty("--dance-rot", `${(dance * 0.045 * s).toFixed(3)}deg`);
      el.style.setProperty("--dance-y", `${(dance * 0.35 * (i % 3 === 1 ? -1 : 1)).toFixed(2)}px`);
    });
  };
  requestAnimationFrame(tick);
}

/**
 * Horizontaler Wipe: Der Abschnitt bleibt beim Scrollen stehen (sticky) und die
 * Karten wandern nach links, bis alle kommenden Events durch sind – erst dann
 * geht es weiter nach unten.
 */
export function initWipe(runway: HTMLElement) {
  const viewport = runway.querySelector<HTMLElement>(".wipe-viewport")!;
  const strip = runway.querySelector<HTMLElement>(".wipe-strip")!;
  let distance = 0;

  const contentWidth = () => {
    const last = strip.lastElementChild as HTMLElement | null;
    if (!last) return 0;
    const padR = parseFloat(getComputedStyle(strip).paddingRight) || 0;
    return last.offsetLeft + last.offsetWidth + padR;
  };

  const update = () => {
    if (!distance) {
      strip.style.transform = "";
      return;
    }
    const p = Math.min(1, Math.max(0, -runway.getBoundingClientRect().top / distance));
    strip.style.transform = `translate3d(${(-p * distance).toFixed(1)}px,0,0)`;
    runway.style.setProperty("--wipe-progress", p.toFixed(4));
  };

  const measure = () => {
    distance = Math.max(0, contentWidth() - viewport.clientWidth);
    runway.classList.toggle("is-wiping", distance > 0); // passen alle Karten ins Bild → kein Festhalten
    runway.style.height = distance > 0 ? `${viewport.offsetHeight + distance}px` : "";
    update();
  };

  window.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", measure);
  new ResizeObserver(measure).observe(strip);
  new MutationObserver(measure).observe(strip, { childList: true });
  // Bilder laden nach → Höhe ändert sich
  strip.addEventListener("load", measure, true);
  measure();

  return {
    measure,
    /** Fenster so scrollen, dass die Karte links im Bild steht */
    scrollToCard(card: HTMLElement, immediate = false) {
      measure();
      const pad = parseFloat(getComputedStyle(strip).paddingLeft) || 0;
      const runwayTop = runway.getBoundingClientRect().top + window.scrollY;
      const x = Math.min(distance, Math.max(0, card.offsetLeft - pad));
      scrollToY(runwayTop + x, immediate);
    },
    /** Pfeile: eine Karte vor/zurück */
    step(dir: number) {
      const card = strip.firstElementChild as HTMLElement | null;
      const gap = parseFloat(getComputedStyle(strip).columnGap) || 0;
      const w = card ? card.offsetWidth + gap : viewport.clientWidth * 0.8;
      scrollToY(window.scrollY + dir * w);
    },
  };
}

/**
 * Reel-Vorschau: Fährt man über eine Karte mit Reel-Video, wird sie größer und das
 * Video spielt stumm ab. Auf Touch-Geräten (kein Hovern) spielt es, sobald die Karte
 * gut sichtbar ist. Das Video wird erst bei Bedarf geladen.
 */
export function initReelHover(root: HTMLElement | Document = document) {
  const canHover = window.matchMedia("(hover: hover)").matches;
  const start = (card: HTMLElement) => {
    const v = card.querySelector<HTMLVideoElement>("video.slide-reel");
    if (!v) return;
    if (!v.src && v.dataset.src) v.src = v.dataset.src;
    card.classList.add("reel-playing");
    v.play().catch(() => {});
  };
  const stop = (card: HTMLElement) => {
    const v = card.querySelector<HTMLVideoElement>("video.slide-reel");
    card.classList.remove("reel-playing");
    v?.pause();
  };

  if (canHover) {
    root.addEventListener("mouseover", (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>(".slide.has-reel");
      if (card && !card.classList.contains("reel-playing")) start(card);
    });
    root.addEventListener("mouseout", (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>(".slide.has-reel");
      const to = (e as MouseEvent).relatedTarget as Node | null;
      if (card && !(to && card.contains(to))) stop(card);
    });
    return;
  }

  // Touch: abspielen, solange die Karte zu mind. 70 % sichtbar ist
  const io = new IntersectionObserver(
    (entries) => entries.forEach((en) => (en.intersectionRatio >= 0.7 ? start : stop)(en.target as HTMLElement)),
    { threshold: [0, 0.7] },
  );
  const scan = () => document.querySelectorAll<HTMLElement>(".slide.has-reel").forEach((c) => io.observe(c));
  scan();
  new MutationObserver(scan).observe(root instanceof Document ? root.body : root, { childList: true, subtree: true });
}
