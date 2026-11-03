// Events-Rad auf der Startseite (Vorbild: SWSH-Carousel).
// Eine Box mit dem Bild (oder Reel) des aktiven Events; rechts drehen sich die Event-Titel auf
// einem Kreisbogen. Oben die vergangenen Events, darunter die kommenden – Start beim nächsten Event.
// Beim Scrollen rastet die Box ein: runter geht es erst nach dem letzten kommenden Event weiter,
// hoch erst nach dem ältesten vergangenen.
import type Lenis from "lenis";
import { esc, eventAnchor, splitEvents, type PublicEvent } from "./public-events.ts";

const FALLBACK_IMG = "/images/gruppe-ausfahrt.jpg";

export type SeatStatus = Record<string, { capacity: number; taken: number; remaining: number; open: boolean }>;

interface DialItem {
  id: string;
  title: string;
  kicker: string;
  date: string; // groß, z. B. "12.12."
  meta: string; // Wochentag · Uhrzeit · Ort
  href: string;
  cta: string;
  img: string;
  video: string;
  kind: "past" | "upcoming" | "tbd";
  reg: boolean;
}

const weekday = (iso: string) =>
  new Intl.DateTimeFormat("de-DE", { weekday: "long", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
const bigDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;

/** Reihenfolge: vergangene (älteste oben) → kommende (aufsteigend) → „Mehr folgt“ */
function dialItems(all: PublicEvent[]) {
  const { upcoming, past } = splitEvents(all, 8);
  const meta = (e: PublicEvent) => [weekday(e.dateISO), e.time, e.location].filter(Boolean).join(" · ");
  const video = (e: PublicEvent) => (e.reelVideo && e.reelVideo.startsWith("/api/event-video?") ? e.reelVideo : "");
  const items: DialItem[] = [
    ...past.slice().reverse().map((e): DialItem => ({
      id: e.id,
      title: e.title,
      kicker: `Vergangenes Event · ${e.dateISO.slice(0, 4)}`,
      date: bigDate(e.dateISO),
      meta: meta(e),
      href: `/events#${eventAnchor(e.id)}`,
      cta: e.hasMedia ? "Fotos & Videos" : "Zum Event",
      img: e.image || FALLBACK_IMG,
      video: video(e),
      kind: "past",
      reg: !!e.registration,
    })),
    ...upcoming.map((e, i): DialItem => ({
      id: e.id,
      title: e.title,
      kicker: i === 0 ? "Nächstes Event" : "Kommendes Event",
      date: bigDate(e.dateISO),
      meta: meta(e),
      href: `/events#${eventAnchor(e.id)}`,
      cta: e.registration ? "Zur Anmeldung" : "Zum Event",
      img: e.image || FALLBACK_IMG,
      video: video(e),
      kind: "upcoming",
      reg: !!e.registration,
    })),
    {
      id: "",
      title: "Mehr folgt",
      kicker: "In Planung",
      date: "tbd.",
      meta: "Neue Events kündigen wir zuerst im Strava Club an.",
      href: "/events",
      cta: "Alle Events",
      img: FALLBACK_IMG,
      video: "",
      kind: "tbd",
      reg: false,
    },
  ];
  // Start beim nächsten Event; nach unten geht es bis zum letzten kommenden Event
  const start = past.length;
  const down = upcoming.length ? past.length + upcoming.length - 1 : Math.max(0, past.length - 1);
  return { items, start: Math.min(start, items.length - 1), down };
}

/** Zeile mit Teilnehmerzahl (leer, wenn es nichts anzuzeigen gibt) */
function seatsHTML(kind: string, reg: boolean, s?: SeatStatus[string]): string {
  if (kind === "upcoming" && !reg) return `<span class="evd-seats-free">Kostenlos · ohne Anmeldung</span>`;
  if (!reg || !s) return "";
  if (kind === "past") return `<strong>${s.taken}</strong> Teilnehmer:innen`;
  const pct = Math.min(100, Math.round((s.taken / Math.max(1, s.capacity)) * 100));
  const label = s.remaining === 0 ? "ausgebucht" : `von ${s.capacity} Plätzen vergeben`;
  return `<strong>${s.taken}</strong> ${label}<span class="evd-bar" aria-hidden="true"><i style="width:${pct}%"></i></span>`;
}

/** Inneres HTML der Box – im Build und im Browser gleich */
export function dialHTML(all: PublicEvent[], seats: SeatStatus = {}): string {
  const { items, start, down } = dialItems(all);
  const s = items[start];
  const bgs = items
    .map((it, i) => `<img class="evd-bg${i === start ? " is-active" : ""}" src="${esc(it.img)}" alt="" ${i === start ? 'fetchpriority="high"' : 'loading="lazy"'} />`)
    .join("");
  const list = items
    .map(
      (it, i) => `<li data-i="${i}" data-id="${esc(it.id)}" data-kind="${it.kind}" data-reg="${it.reg ? 1 : 0}" data-title="${esc(it.title)}"
  data-kicker="${esc(it.kicker)}" data-date="${esc(it.date)}" data-meta="${esc(it.meta)}" data-href="${esc(it.href)}" data-cta="${esc(it.cta)}"
  data-img="${esc(it.img)}" data-video="${esc(it.video)}"${i === start ? ' aria-current="true"' : ""}><button type="button" tabindex="-1">${esc(it.title)}</button></li>`,
    )
    .join("");
  const line = (cls: string, html: string) => `<span class="evd-l ${cls}"><span>${html}</span></span>`;
  return `<div class="evd-bgs" aria-hidden="true">${bgs}<video class="evd-video" muted loop playsinline preload="none"></video></div>
<div class="evd-shade" aria-hidden="true"></div>
<div class="evd-head">
  <h2 id="evd-title" class="evd-title"><a href="/events">Events</a></h2>
  <p class="evd-sub"><a href="/events">Alle Events – plus Fotos &amp; Videos →</a></p>
</div>
<div class="evd-card" aria-hidden="true"><img src="${esc(s.img)}" alt="" /></div>
<ol class="evd-list" data-start="${start}" data-down="${down}" aria-label="Events – mit Pfeiltasten wechseln">${list}</ol>
<div class="evd-info" aria-live="polite">
  ${line("evd-kicker", esc(s.kicker))}
  ${line("evd-date", esc(s.date))}
  ${line("evd-name", esc(s.title))}
  ${line("evd-meta", esc(s.meta))}
  ${line("evd-seats", seatsHTML(s.kind, s.reg, seats[s.id]))}
  <span class="evd-l evd-cta-wrap"><a class="btn evd-cta" href="${esc(s.href)}">${esc(s.cta)} →</a></span>
</div>
<div class="evd-nav">
  <button type="button" data-step="-1" aria-label="Vorheriges Event">↑</button>
  <button type="button" data-step="1" aria-label="Nächstes Event">↓</button>
</div>
<i hidden data-dial-end></i>`; // Endmarke für die Edge Function (live-html.ts)
}

/** Steuerung. Gibt ein Objekt mit Aufräumfunktion und Platz-Update zurück. */
export function initDial(
  box: HTMLElement,
  scroll: { lenis: Lenis | null; hold: (on: boolean) => void } = { lenis: null, hold: () => {} },
): { stop: () => void; setSeats: (s: SeatStatus) => void } {
  const list = box.querySelector<HTMLOListElement>(".evd-list");
  if (!list) return { stop: () => {}, setSeats: () => {} };
  const lis = [...list.querySelectorAll<HTMLLIElement>("li")];
  const bgs = [...box.querySelectorAll<HTMLImageElement>(".evd-bg")];
  const video = box.querySelector<HTMLVideoElement>(".evd-video")!;
  const card = box.querySelector<HTMLImageElement>(".evd-card img")!;
  const infoBox = box.querySelector<HTMLElement>(".evd-info")!;
  const el = (c: string) => box.querySelector<HTMLElement>(`.${c} > *`)!;
  const info = { kicker: el("evd-kicker"), date: el("evd-date"), name: el("evd-name"), meta: el("evd-meta"), seats: el("evd-seats"), cta: el("evd-cta-wrap") as HTMLAnchorElement };
  const n = lis.length;
  const down = Number(list.dataset.down) || 0;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let seats: SeatStatus = {};
  let pos = Number(list.dataset.start) || 0;
  let target = pos;
  let active = -1;
  let raf = 0;

  // ---------- Darstellung ----------
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

  // Infos unten links: alte Zeilen gleiten nach oben raus, neue von unten rein
  let swapTimer: ReturnType<typeof setTimeout> | undefined;
  const fillInfo = (li: HTMLLIElement) => {
    const id = li.dataset.id!;
    info.kicker.textContent = li.dataset.kicker!;
    info.date.textContent = li.dataset.date!;
    info.name.textContent = li.dataset.title!;
    info.meta.textContent = li.dataset.meta!;
    info.seats.innerHTML = seatsHTML(li.dataset.kind!, li.dataset.reg === "1", seats[id]);
    info.cta.href = li.dataset.href!;
    info.cta.textContent = `${li.dataset.cta} →`;
  };
  const swapInfo = (li: HTMLLIElement, first: boolean) => {
    clearTimeout(swapTimer);
    if (first || reduce) return fillInfo(li);
    infoBox.classList.remove("is-in");
    infoBox.classList.add("is-out");
    swapTimer = setTimeout(() => {
      fillInfo(li);
      infoBox.classList.remove("is-out");
      void infoBox.offsetWidth;
      infoBox.classList.add("is-in");
    }, 260);
  };

  // Hintergrund: Reel (falls im Admin hinterlegt) sonst Bild
  let videoTimer: ReturnType<typeof setTimeout> | undefined;
  const showVideo = (src: string) => {
    clearTimeout(videoTimer);
    video.classList.remove("is-playing");
    video.pause();
    if (!src || reduce) return;
    videoTimer = setTimeout(() => {
      if (video.getAttribute("src") !== src) video.src = src;
      video.play().catch(() => {});
    }, 350); // kurz warten, damit schnelles Durchdrehen nicht jedes Video lädt
  };
  video.addEventListener("playing", () => video.classList.add("is-playing"));

  const setActive = (i: number) => {
    const first = active === -1;
    active = i;
    const li = lis[i];
    lis.forEach((l, k) => (k === i ? l.setAttribute("aria-current", "true") : l.removeAttribute("aria-current")));
    bgs.forEach((b, k) => b.classList.toggle("is-active", k === i));
    if (bgs[i]?.loading === "lazy") bgs[i].loading = "eager";
    card.src = li.dataset.img!;
    card.parentElement!.classList.remove("is-swap");
    void card.offsetWidth;
    card.parentElement!.classList.add("is-swap");
    swapInfo(li, first);
    showVideo(li.dataset.video!);
  };

  let lastMove = 0;
  const tick = () => {
    const diff = target - pos;
    if (reduce || Math.abs(diff) < 0.001) pos = target;
    else pos += diff * 0.14;
    render();
    raf = pos === target ? 0 : requestAnimationFrame(tick);
  };
  const go = (t: number, snap = true, max = n - 1) => {
    const next = Math.min(max, Math.max(0, snap ? Math.round(t) : t));
    if (next !== target) lastMove = performance.now();
    target = next;
    if (!raf) raf = requestAnimationFrame(tick);
  };

  // ---------- Einrasten beim Scrollen ----------
  const lenis = scroll.lenis;
  let locked = false;
  let lastInput = 0;
  let lastWheel = 0;
  let prevY = scrollY;
  const lockY = () => box.getBoundingClientRect().top + scrollY - Math.max(0, (innerHeight - box.offsetHeight) / 2);
  const lock = (y: number) => {
    locked = true;
    scroll.hold(true);
    if (lenis) {
      lenis.scrollTo(y, { immediate: true, force: true });
      lenis.stop();
    } else window.scrollTo(0, y);
    prevY = y;
  };
  const unlock = () => {
    locked = false;
    scroll.hold(false);
    lenis?.start();
  };
  const onScroll = () => {
    const y = scrollY;
    if (!locked && performance.now() - lastInput < 700) {
      const L = lockY();
      if (prevY < L && y >= L && Math.round(target) < down) lock(L);
      else if (prevY > L && y <= L && Math.round(target) > 0) lock(L);
    }
    prevY = locked ? prevY : y;
  };
  addEventListener("scroll", onScroll, { passive: true });

  // Mausrad / Trackpad: im eingerasteten Zustand dreht es das Rad. Am Ende braucht es eine
  // kurze Pause (neue Bewegung), dann scrollt die Seite weiter – Trackpad-Schwung reißt nicht durch.
  let snapTimer: ReturnType<typeof setTimeout> | undefined;
  const onWheel = (e: WheelEvent) => {
    const now = performance.now();
    lastInput = now;
    if (!locked) return;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return e.preventDefault();
    e.preventDefault();
    const dy = e.deltaY * (e.deltaMode === 1 ? 16 : 1);
    const gap = now - lastWheel;
    lastWheel = now;
    const atEnd = dy > 0 ? target >= down : target <= 0;
    if (atEnd) {
      if (gap > 200 && now - lastMove > 350) unlock();
      return;
    }
    go(target + dy / (geo().step * 2.2), false, Math.max(down, Math.round(target)));
    clearTimeout(snapTimer);
    snapTimer = setTimeout(() => go(target, true, Math.max(down, Math.round(target))), 140);
  };
  addEventListener("wheel", onWheel, { passive: false, capture: true });

  // Finger: im eingerasteten Zustand dreht hoch/runter wischen das Rad
  let touch: { y: number; t: number; startedAtEnd: number } | null = null;
  const onTouchStart = (e: TouchEvent) => {
    lastInput = performance.now();
    if (!locked) return;
    touch = { y: e.touches[0].clientY, t: target, startedAtEnd: target >= down ? 1 : target <= 0 ? -1 : 0 };
  };
  const onTouchMove = (e: TouchEvent) => {
    lastInput = performance.now();
    if (!locked || !touch) return;
    e.preventDefault();
    const dy = touch.y - e.touches[0].clientY; // nach oben wischen = weiter
    if (touch.startedAtEnd === 1 && dy > 30) return unlock();
    if (touch.startedAtEnd === -1 && dy < -30) return unlock();
    go(touch.t + dy / (geo().step * 1.3), false, Math.max(down, Math.round(touch.t)));
  };
  const onTouchEnd = () => {
    if (touch && locked) go(target, true, Math.max(down, Math.round(target)));
    touch = null;
  };
  addEventListener("touchstart", onTouchStart, { passive: true });
  addEventListener("touchmove", onTouchMove, { passive: false });
  addEventListener("touchend", onTouchEnd);

  // Tastatur: Seiten-Tasten heben die Sperre auf; Pfeile drehen das Rad, wenn die Box fokussiert ist
  const onDocKey = (e: KeyboardEvent) => {
    if (locked && ["PageDown", "PageUp", "Home", "End", " "].includes(e.key)) unlock();
  };
  addEventListener("keydown", onDocKey);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowRight") go(active + 1);
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") go(active - 1);
    else return;
    e.preventDefault();
  };
  box.addEventListener("keydown", onKey);

  // Ziehen auf der Titel-Spalte (Maus: hoch/runter, Finger: seitlich); kurzer Klick = wählen bzw. öffnen
  let drag: { x: number; y: number; t: number; touch: boolean; moved: boolean } | null = null;
  list.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY, t: target, touch: e.pointerType !== "mouse", moved: false };
    if (!drag.touch) list.setPointerCapture(e.pointerId);
  });
  list.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const d = drag.touch ? e.clientX - drag.x : e.clientY - drag.y;
    if (Math.abs(d) > 6) drag.moved = true;
    if (drag.moved) go(drag.t - d / (drag.touch ? geo().step * 1.4 : geo().step), false);
  });
  list.addEventListener("pointerup", (e) => {
    if (!drag) return;
    const wasDrag = drag.moved;
    drag = null;
    if (wasDrag) return go(target);
    const li = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLLIElement>(".evd-list li");
    if (!li) return;
    const i = Number(li.dataset.i);
    if (i === active) location.href = li.dataset.href!;
    else go(i);
  });
  list.addEventListener("pointercancel", () => {
    if (drag?.moved) go(target);
    drag = null;
  });
  box.querySelectorAll<HTMLButtonElement>("[data-step]").forEach((b) =>
    b.addEventListener("click", () => go(active + Number(b.dataset.step))),
  );

  // Video nur abspielen, solange die Box zu sehen ist
  const io = new IntersectionObserver(([e]) => {
    if (!e.isIntersecting) video.pause();
    else if (video.getAttribute("src") && lis[active]?.dataset.video) video.play().catch(() => {});
  });
  io.observe(box);
  const ro = new ResizeObserver(() => render());
  ro.observe(box);
  render();

  return {
    stop: () => {
      if (locked) unlock();
      io.disconnect();
      ro.disconnect();
      cancelAnimationFrame(raf);
      clearTimeout(swapTimer);
      clearTimeout(videoTimer);
      video.pause();
      removeEventListener("scroll", onScroll);
      removeEventListener("wheel", onWheel, { capture: true });
      removeEventListener("touchstart", onTouchStart);
      removeEventListener("touchmove", onTouchMove);
      removeEventListener("touchend", onTouchEnd);
      removeEventListener("keydown", onDocKey);
      box.removeEventListener("keydown", onKey);
    },
    setSeats: (s: SeatStatus) => {
      seats = s;
      if (active >= 0) {
        const li = lis[active];
        info.seats.innerHTML = seatsHTML(li.dataset.kind!, li.dataset.reg === "1", seats[li.dataset.id!]);
      }
    },
  };
}
