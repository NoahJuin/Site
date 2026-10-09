// Pop-up « code de bienvenue » : une seule fois par visiteur, après 20 s,
// à l'intention de sortie (ordinateur) ou après la moitié de la page (mobile).
(function () {
  'use strict';
  var cfg = window.WELCOME || {};
  if (!cfg.enabled || location.pathname !== '/') return;

  var KEY = 'welcome-popup-v1';
  try { if (localStorage.getItem(KEY)) return; } catch (e) { return; }

  var shown = false;
  function cookieBannerOpen() {
    var b = document.getElementById('cookie-banner');
    return b && !b.hidden;
  }

  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (text) n.textContent = text;
    return n;
  }

  function show() {
    if (shown || cookieBannerOpen() || document.querySelector('.chat-panel:not([hidden])')) return;
    shown = true;
    try { localStorage.setItem(KEY, '1'); } catch (e) { /* ignoré */ }

    var overlay = el('div', { class: 'welcome-overlay' });
    var box = el('div', { class: 'welcome-box', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'welcome-title' });
    var close = el('button', { type: 'button', class: 'welcome-close', 'aria-label': 'Fermer' }, '×');
    var form = el('form', { class: 'welcome-form', novalidate: '' });
    var email = el('input', { type: 'email', required: '', placeholder: 'Votre e-mail', autocomplete: 'email', 'aria-label': 'Votre e-mail' });
    var consentLabel = el('label', { class: 'welcome-consent' });
    var consent = el('input', { type: 'checkbox' });
    consentLabel.appendChild(consent);
    consentLabel.appendChild(document.createTextNode(" J'accepte de recevoir les offres de la boutique (désinscription en un clic)."));
    var submit = el('button', { type: 'submit', class: 'btn btn-cta' }, 'Recevoir mon code');
    var msg = el('p', { class: 'welcome-msg', role: 'status' });

    box.appendChild(close);
    box.appendChild(el('p', { class: 'eyebrow' }, 'Bienvenue'));
    box.appendChild(el('h2', { id: 'welcome-title' }, cfg.text));
    box.appendChild(el('p', { class: 'muted' }, 'Recevez votre code par e-mail, à utiliser au moment du paiement.'));
    form.appendChild(email);
    form.appendChild(consentLabel);
    form.appendChild(submit);
    box.appendChild(form);
    box.appendChild(msg);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    email.focus();

    function dismiss() { overlay.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') dismiss(); }
    close.addEventListener('click', dismiss);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) dismiss(); });
    document.addEventListener('keydown', onKey);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      submit.disabled = true;
      msg.textContent = '';
      fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.value, consent: consent.checked, source: 'popup' }),
      })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (res.ok) {
            form.remove();
            msg.textContent = res.message;
            msg.classList.add('ok');
          } else {
            msg.textContent = res.error || 'Une erreur est survenue.';
            submit.disabled = false;
          }
        })
        .catch(function () { msg.textContent = 'Connexion impossible, réessayez.'; submit.disabled = false; });
    });
  }

  setTimeout(function retry() { if (!shown) { if (cookieBannerOpen()) setTimeout(retry, 5000); else show(); } }, 20000);
  document.addEventListener('mouseout', function (e) {
    if (!e.relatedTarget && e.clientY <= 0) show();
  });
  window.addEventListener('scroll', function onScroll() {
    if (window.innerWidth < 900 && window.scrollY > document.body.scrollHeight * 0.5) {
      window.removeEventListener('scroll', onScroll);
      show();
    }
  }, { passive: true });
})();
