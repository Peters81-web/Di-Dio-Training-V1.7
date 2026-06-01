/**
 * app-nav.js
 * Comportamento della navbar unificata (.app-nav).
 * Single source of truth: sostituisce i toggle JS duplicati di
 * app-core.js, dashboard.js, planner.html inline, stats.html inline,
 * ai-trainer.html inline.
 *
 * Responsabilità:
 *   - Toggle del menu mobile (apre/chiude su click hamburger)
 *   - Chiusura su click fuori, ESC, click su link interno, resize a desktop
 *   - Highlight del link corrispondente alla pagina corrente (.is-active)
 *   - Shadow più marcato sulla navbar al primo scroll (.is-scrolled)
 *   - Tutto wrapped in IIFE per evitare leak di scope globale
 *
 * Idempotente: include un flag per evitare doppio-init se lo script
 * dovesse essere caricato due volte.
 */
(function () {
  'use strict';

  if (window.__appNavInitialized) return;
  window.__appNavInitialized = true;

  function init() {
    const nav    = document.querySelector('.app-nav');
    if (!nav) return; // pagina senza navbar (login/register) — esci pulito

    const toggle = nav.querySelector('.app-nav-toggle');
    const menu   = nav.querySelector('.app-nav-menu');

    // ── 1. Highlight link corrente ────────────────────────────
    // Match esatto del pathname (es. '/dashboard'), con tolleranza per
    // '/' e per trailing slash.
    if (menu) {
      const currentPath = (window.location.pathname || '/').replace(/\/+$/, '') || '/';
      menu.querySelectorAll('a.app-nav-link[href]').forEach((a) => {
        const hrefPath = (a.getAttribute('href') || '').split('?')[0].replace(/\/+$/, '') || '/';
        if (hrefPath === currentPath) a.classList.add('is-active');
      });
    }

    // ── 2. Toggle menu mobile ─────────────────────────────────
    if (toggle && menu) {
      const setOpen = (open) => {
        nav.classList.toggle('is-open', open);
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        toggle.setAttribute('aria-label', open ? 'Chiudi menu' : 'Apri menu');
      };

      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        setOpen(!nav.classList.contains('is-open'));
      });

      // Chiusura su click fuori
      document.addEventListener('click', (e) => {
        if (!nav.contains(e.target)) setOpen(false);
      });

      // Chiusura su ESC
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && nav.classList.contains('is-open')) {
          setOpen(false);
          toggle.focus();
        }
      });

      // Chiusura su click di un LINK ancora (<a>) — non sui <button> che
      // possono aprire panel laterali (es. #notificationsBtn) o che fanno
      // il loro lavoro senza voler chiudere la navbar.
      menu.addEventListener('click', (e) => {
        const link = e.target.closest('a.app-nav-link');
        if (link) setOpen(false);
      });

      // Reset stato passando da mobile a desktop
      let prevWidth = window.innerWidth;
      window.addEventListener('resize', () => {
        const w = window.innerWidth;
        if (prevWidth <= 768 && w > 768) setOpen(false);
        prevWidth = w;
      });
    }

    // ── 3. Shadow on scroll (sottile feedback profondità) ─────
    const setScrolled = () => {
      nav.classList.toggle('is-scrolled', window.scrollY > 4);
    };
    setScrolled();
    window.addEventListener('scroll', setScrolled, { passive: true });

    // ── 4. Credito autore in fondo a ogni pagina ──────────────
    injectCredit();
  }

  // Inserisce un footer discreto con il credito dell'autore.
  // DRY: definito una volta qui, app-nav.js è caricato su tutte le
  // pagine principali → il credito appare ovunque senza duplicare HTML.
  function injectCredit() {
    if (document.querySelector('.app-credit')) return; // evita doppioni
    const footer = document.createElement('footer');
    footer.className = 'app-credit';
    const year = new Date().getFullYear();
    footer.innerHTML =
      'Vortex Stride &middot; Realizzato da <strong>Di Dio Pietro</strong> &middot; &copy; ' + year;
    document.body.appendChild(footer);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
