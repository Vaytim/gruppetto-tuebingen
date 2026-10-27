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
 * Hintergrundvideo sicher starten: Manche Browser (z. B. Safari im Stromsparmodus)
 * blockieren den automatischen Start trotz "muted". Dann startet das Video bei der
 * ersten Berührung, dem ersten Klick oder Scrollen. Außerhalb des Bildes pausiert es.
 */
export function ensureAutoplay(v: HTMLVideoElement) {
  if (reduced()) {
    v.pause();
    return;
  }
  v.muted = true;
  v.defaultMuted = true;
  v.playsInline = true;
  let inView = true;
  const tryPlay = () => {
    if (inView && !document.hidden && v.paused) v.play().catch(() => {});
  };
  const onGesture = () => {
    tryPlay();
    if (!v.paused) gestures.forEach((g) => window.removeEventListener(g, onGesture));
  };
  const gestures = ["pointerdown", "touchstart", "keydown", "scroll", "wheel"];
  gestures.forEach((g) => window.addEventListener(g, onGesture, { passive: true }));
  new IntersectionObserver(([e]) => {
    inView = e.isIntersecting;
    if (inView) tryPlay();
    else v.pause();
  }).observe(v);
  document.addEventListener("visibilitychange", () => (document.hidden ? v.pause() : tryPlay()));
  if (v.readyState >= 2) tryPlay();
  else v.addEventListener("loadeddata", tryPlay, { once: true });
  tryPlay();
}

/**
 * Reel-Vorschau: Von allen Karten mit Reel-Video spielt immer nur eine – die, die am
 * meisten im Bild ist (bei Gleichstand die mittigere). Sie wird größer, die anderen
 * treten zurück. Mit der Maus kann man eine andere Karte per Hovern "vorziehen".
 * Videos werden erst geladen, wenn ihre Karte an der Reihe ist.
 */
export function initReelHover(root: HTMLElement | Document = document) {
  const MIN_RATIO = 0.6; // mind. 60 % der Karte sichtbar
  const canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const autoplay = !reduced();
  const ratios = new Map<HTMLElement, number>();
  let auto: HTMLElement | null = null;
  let hovered: HTMLElement | null = null;
  let current: HTMLElement | null = null;

  const videoOf = (card: HTMLElement) => card.querySelector<HTMLVideoElement>("video.slide-reel");
  const play = (card: HTMLElement) => {
    const v = videoOf(card);
    if (!v) return;
    v.muted = true;
    v.defaultMuted = true;
    v.playsInline = true;
    if (!v.getAttribute("src") && v.dataset.src) {
      v.preload = "auto";
      v.src = v.dataset.src;
    }
    card.classList.add("reel-focus");
    // Video erst einblenden, wenn wirklich Bilder kommen – bis dahin bleibt das Foto stehen
    const show = () => current === card && card.classList.add("reel-playing");
    v.addEventListener("playing", show, { once: true });
    if (!document.hidden) v.play().catch(() => {});
  };
  const stop = (card: HTMLElement) => {
    card.classList.remove("reel-focus", "reel-playing");
    videoOf(card)?.pause();
  };
  const update = () => {
    if (current && !current.isConnected) current = null;
    if (hovered && !hovered.isConnected) hovered = null;
    const next = hovered ?? (autoplay ? auto : null);
    if (next === current) return;
    if (current) stop(current);
    current = next;
    if (current) play(current);
  };
  const pick = () => {
    let best: HTMLElement | null = null;
    let bestScore = -Infinity;
    ratios.forEach((ratio, card) => {
      if (!card.isConnected) return void ratios.delete(card);
      if (ratio < MIN_RATIO) return;
      const b = card.getBoundingClientRect();
      const offCenter = Math.hypot(
        (b.left + b.width / 2 - window.innerWidth / 2) / window.innerWidth,
        (b.top + b.height / 2 - window.innerHeight / 2) / window.innerHeight,
      );
      // Die aktuelle Karte bekommt einen kleinen Bonus, damit es nicht hin und her springt
      const score = ratio - offCenter * 0.5 + (card === auto ? 0.08 : 0);
      if (score > bestScore) {
        best = card;
        bestScore = score;
      }
    });
    auto = best;
    update();
  };

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((en) => {
        const card = en.target as HTMLElement;
        if (en.isIntersecting) ratios.set(card, en.intersectionRatio);
        else ratios.delete(card);
      });
      pick();
    },
    { threshold: [0, 0.2, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] },
  );
  const host = root instanceof Document ? root.body : root;
  const scan = () => {
    host.querySelectorAll<HTMLElement>(".slide.has-reel").forEach((c) => io.observe(c));
    pick();
  };
  scan();
  new MutationObserver(scan).observe(host, { childList: true, subtree: true });

  // Beim seitlichen Wischen ändert sich die Mitte, ohne dass eine Schwelle überschritten wird
  let raf = 0;
  const onMove = () => {
    if (!raf) raf = requestAnimationFrame(() => ((raf = 0), pick()));
  };
  window.addEventListener("scroll", onMove, { passive: true });
  host.addEventListener("scroll", onMove, { passive: true, capture: true });
  window.addEventListener("resize", onMove);

  document.addEventListener("visibilitychange", () => {
    const v = current && videoOf(current);
    if (!v) return;
    if (document.hidden) v.pause();
    else v.play().catch(() => {});
  });

  if (canHover) {
    host.addEventListener("mouseover", (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>(".slide.has-reel");
      if (card && card !== hovered) {
        hovered = card;
        update();
      }
    });
    host.addEventListener("mouseout", (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>(".slide.has-reel");
      const to = (e as MouseEvent).relatedTarget as Node | null;
      if (card && card === hovered && !(to && card.contains(to))) {
        hovered = null;
        update();
      }
    });
  }
}
