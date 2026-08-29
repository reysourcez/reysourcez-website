/* ============================================================
   Reysourcez nav dropdown ("Business Analysis" menu in the header)
   ------------------------------------------------------------
   The menu shows on :hover in styles.css — that's enough for mouse
   users and needs no JS. This file adds what hover can't cover:
   click/tap to open (touch devices), Enter/Space to open (native
   <button> behavior — no extra code needed for that part), Escape
   to close, click-outside to close, and closing once focus moves
   past the last item.
   ============================================================ */

function rzInitNavDropdowns() {
  document.querySelectorAll('.nav-dropdown').forEach((dropdown) => {
    const toggle = dropdown.querySelector('.nav-dropdown-toggle');
    if (!toggle) return;

    function close() {
      dropdown.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
    }
    function open() {
      dropdown.classList.add('is-open');
      toggle.setAttribute('aria-expanded', 'true');
    }

    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dropdown.classList.contains('is-open')) close(); else open();
    });

    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target)) close();
    });

    dropdown.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { close(); toggle.focus(); }
    });

    // Tabbing past the last link should close it too, not leave it
    // hanging open once focus has moved elsewhere on the page.
    dropdown.addEventListener('focusout', () => {
      setTimeout(() => {
        if (!dropdown.contains(document.activeElement)) close();
      }, 0);
    });
  });
}

document.addEventListener('DOMContentLoaded', rzInitNavDropdowns);
