// Events-Rad auf der Startseite (Vorbild: SWSH-Carousel).
// Eine Box mit dem Bild des aktiven Events; rechts drehen sich die Event-Titel auf einem
// Kreisbogen. Oben die vergangenen Events, darunter die kommenden – Start beim nächsten Event.
import { esc, eventAnchor, shortDate, splitEvents, type PublicEvent } from "./public-events";

const FALLBACK_IMG = "/images/gruppe-ausfahrt.jpg";

interface DialItem {
  title: string;
  kicker: string;
  meta: string;
  href: string;
  cta: string;
  img: string;
}

/** Reihenfolge: vergangene (älteste oben) → kommende (aufsteigend) → „Mehr folgt“ */
function dialItems(all: PublicEvent[]): { items: DialItem[]; start: number } {
  const { upcoming, past } = splitEvents(all, 8);
  const meta = (e: PublicEvent) => [shortDate(e.dateISO), e.time, e.location].filter(Boolean).join(" · ");
  const items: DialItem[] = [
    ...past.slice().reverse().map((e) => ({
      title: e.title,
      kicker: "Vergangenes Event",
      meta: meta(e),
      href: `/events#${eventAnchor(e.id)}`,
      cta: e.hasMedia ? "Fotos & Videos" : "Zum Event",
      img: e.image || FALLBACK_IMG,
    })),
    ...upcoming.map((e, i) => ({
      title: e.title,
      kicker: i === 0 ? "Nächstes Event" : "Kommendes Event",
      meta: meta(e),
      href: `/events#${eventAnchor(e.id)}`,
      cta: e.registration ? "Zur Anmeldung" : "Zum Event",
      img: e.image || FALLBACK_IMG,
    })),
    {
      title: "Mehr folgt",
      kicker: "Bald",
      meta: "Neue Events kündigen wir zuerst im Strava Club an.",
      href: "/events",
      cta: "Alle Events",
      img: FALLBACK_IMG,
    },
  ];
  return { items, start: past.length };
}

/** Inneres HTML der Box – im Build und im Browser gleich */
export function dialHTML(all: PublicEvent[]): string {
  const { items, start } = dialItems(all);
  const s = items[start];
  const bgs = items
    .map((it, i) => `<img class="evd-bg${i === start ? " is-active" : ""}" src="${esc(it.img)}" alt="" ${i === start ? 'fetchpriority="high"' : 'loading="lazy"'} />`)
    .join("");
  const list = items
    .map(
      (it, i) => `<li data-i="${i}" data-title="${esc(it.title)}" data-kicker="${esc(it.kicker)}" data-meta="${esc(it.meta)}"
  data-href="${esc(it.href)}" data-cta="${esc(it.cta)}" data-img="${esc(it.img)}"${i === start ? ' aria-current="true"' : ""}><button type="button" tabindex="-1">${esc(it.title)}</button></li>`,
    )
    .join("");
  return `<div class="evd-bgs" aria-hidden="true">${bgs}</div>
<div class="evd-shade" aria-hidden="true"></div>
<div class="evd-head">
  <h2 id="evd-title" class="evd-title"><a href="/events">Events</a></h2>
  <p class="evd-sub"><a href="/events">Alle Events – plus Fotos &amp; Videos →</a></p>
</div>
<div class="evd-card" aria-hidden="true"><img src="${esc(s.img)}" alt="" /></div>
<ol class="evd-list" data-start="${start}" aria-label="Events – mit Pfeiltasten wechseln">${list}</ol>
<div class="evd-info" aria-live="polite">
  <p class="evd-kicker">${esc(s.kicker)}</p>
  <p class="evd-name">${esc(s.title)}</p>
  <p class="evd-meta">${esc(s.meta)}</p>
  <a class="btn evd-cta" href="${esc(s.href)}">${esc(s.cta)} →</a>
</div>
<div class="evd-nav">
  <button type="button" data-step="-1" aria-label="Vorheriges Event">↑</button>
  <button type="button" data-step="1" aria-label="Nächstes Event">↓</button>
</div>`;
}

/** Steuerung: Mausrad / Trackpad, Ziehen, Klick, Pfeiltasten. Gibt eine Aufräumfunktion zurück. */
export function initDial(box: HTMLElement): () => void {
  const list = box.querySelector<HTMLOListElement>(".evd-list");
  if (!list) return () => {};
  const lis = [...list.querySelectorAll<HTMLLIElement>("li")];
  const bgs = [...box.querySelectorAll<HTMLImageElement>(".evd-bg")];
  const card = box.querySelector<HTMLImageElement>(".evd-card img")!;
  const info = {
    kicker: box.querySelector<HTMLElement>(".evd-kicker")!,
    name: box.querySelector<HTMLElement>(".evd-name")!,
    meta: box.querySelector<HTMLElement>(".evd-meta")!,
    cta: box.querySelector<HTMLAnchorElement>(".evd-cta")!,
  };
  const n = lis.length;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let pos = Number(list.dataset.start) || 0;
  let target = pos;
  let active = -1;
  let raf = 0;

  // Geometrie: Titel sitzen auf einem Kreisbogen, das aktive ganz links
  const geo = () => {
    const h = list.clientHeight;
    return { step: Math.max(40, Math.min(78, h * 0.1)), radius: h * 0.95, w: list.clientWidth };
  };

  const render = () => {
    const { step, radius, w } = geo();
    const angle = step / radius;
    lis.forEach((li, i) => {
      const d = i - pos;
      const a = d * angle;
      const hidden = Math.abs(a) > 1.25;
      li.style.visibility = hidden ? "hidden" : "";
      if (hidden) return;
      const y = Math.sin(a) * radius;
      const x = (1 - Math.cos(a)) * radius;
      const ad = Math.abs(d);
      const op = ad < 1 ? 1 - ad * 0.6 : Math.max(0.08, 0.4 - (ad - 1) * 0.07);
      li.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translateY(-50%)`;
      li.style.opacity = op.toFixed(3);
      li.style.maxWidth = `${Math.max(80, w - x - 24).toFixed(0)}px`;
    });
    const now = Math.min(n - 1, Math.max(0, Math.round(pos)));
    if (now !== active) setActive(now);
  };

  const setActive = (i: number) => {
    active = i;
    const li = lis[i];
    lis.forEach((l, k) => (k === i ? l.setAttribute("aria-current", "true") : l.removeAttribute("aria-current")));
    bgs.forEach((b, k) => b.classList.toggle("is-active", k === i));
    if (bgs[i]?.loading === "lazy") bgs[i].loading = "eager";
    card.src = li.dataset.img!;
    card.parentElement!.classList.remove("is-swap");
    void card.offsetWidth;
    card.parentElement!.classList.add("is-swap");
    info.kicker.textContent = li.dataset.kicker!;
    info.name.textContent = li.dataset.title!;
    info.meta.textContent = li.dataset.meta!;
    info.cta.href = li.dataset.href!;
    info.cta.textContent = `${li.dataset.cta} →`;
  };

  const tick = () => {
    const diff = target - pos;
    if (reduce || Math.abs(diff) < 0.001) pos = target;
    else pos += diff * 0.14;
    render();
    raf = pos === target ? 0 : requestAnimationFrame(tick);
  };
  const go = (t: number, snap = true) => {
    target = Math.min(n - 1, Math.max(0, snap ? Math.round(t) : t));
    if (!raf) raf = requestAnimationFrame(tick);
  };

  // Mausrad / Trackpad: dreht das Rad, solange die Box gut sichtbar ist. Am Anfang/Ende
  // scrollt die Seite ganz normal weiter – niemand bleibt hängen.
  let visible = false;
  const io = new IntersectionObserver(([e]) => (visible = e.intersectionRatio >= 0.75), { threshold: [0, 0.75, 1] });
  io.observe(box);
  let snapTimer: ReturnType<typeof setTimeout> | undefined;
  const onWheel = (e: WheelEvent) => {
    if (!visible || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    const dy = e.deltaY * (e.deltaMode === 1 ? 16 : 1);
    if ((dy < 0 && target <= 0) || (dy > 0 && target >= n - 1)) return;
    e.preventDefault();
    go(target + dy / (geo().step * 2.2), false);
    clearTimeout(snapTimer);
    snapTimer = setTimeout(() => go(target), 140);
  };
  box.addEventListener("wheel", onWheel, { passive: false });

  // Ziehen auf der Titel-Spalte; kurzer Klick = Event wählen bzw. öffnen.
  // Maus: hoch/runter ziehen. Finger: seitlich wischen (hoch/runter scrollt weiter die Seite).
  let drag: { x: number; y: number; t: number; touch: boolean; moved: boolean } | null = null;
  const onDown = (e: PointerEvent) => {
    drag = { x: e.clientX, y: e.clientY, t: target, touch: e.pointerType !== "mouse", moved: false };
    if (!drag.touch) list.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    if (!drag) return;
    const d = drag.touch ? e.clientX - drag.x : e.clientY - drag.y;
    if (Math.abs(d) > 6) drag.moved = true;
    if (drag.moved) go(drag.t - d / (drag.touch ? geo().step * 1.4 : geo().step), false);
  };
  const onUp = (e: PointerEvent) => {
    if (!drag) return;
    const wasDrag = drag.moved;
    drag = null;
    if (wasDrag) return go(target);
    const li = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLLIElement>(".evd-list li");
    if (!li) return;
    const i = Number(li.dataset.i);
    if (i === active) location.href = li.dataset.href!;
    else go(i);
  };
  list.addEventListener("pointerdown", onDown);
  list.addEventListener("pointermove", onMove);
  list.addEventListener("pointerup", onUp);
  list.addEventListener("pointercancel", () => {
    if (drag?.moved) go(target);
    drag = null;
  });

  // Pfeil-Buttons + Tastatur
  box.querySelectorAll<HTMLButtonElement>("[data-step]").forEach((b) =>
    b.addEventListener("click", () => go(active + Number(b.dataset.step))),
  );
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowRight") go(active + 1);
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") go(active - 1);
    else return;
    e.preventDefault();
  };
  box.addEventListener("keydown", onKey);

  const ro = new ResizeObserver(() => render());
  ro.observe(box);
  render();

  return () => {
    io.disconnect();
    ro.disconnect();
    cancelAnimationFrame(raf);
    box.removeEventListener("wheel", onWheel);
    box.removeEventListener("keydown", onKey);
  };
}
