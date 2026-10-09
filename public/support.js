// Bulle de chat du service client (affichée seulement si l'assistant est activé).
(function () {
  'use strict';
  if (!window.SUPPORT_ENABLED) return;

  var KEY = 'support-chat-v1';
  var history = [];
  try { history = JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch (e) { history = []; }

  function save() {
    try { sessionStorage.setItem(KEY, JSON.stringify(history.slice(-20))); } catch (e) { /* stockage indisponible */ }
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }

  var launcher = el('button', 'chat-launcher');
  launcher.type = 'button';
  launcher.setAttribute('aria-label', 'Ouvrir le chat du service client');
  launcher.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg>';

  var panel = el('section', 'chat-panel');
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Chat du service client');
  var header = el('header', 'chat-header');
  header.appendChild(el('strong', '', 'Une question ?'));
  header.appendChild(el('span', '', 'Réponse immédiate, 7j/7'));
  var close = el('button', 'chat-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Fermer le chat');
  header.appendChild(close);
  var log = el('div', 'chat-log');
  log.setAttribute('aria-live', 'polite');
  var form = el('form', 'chat-form');
  var input = el('input');
  input.type = 'text';
  input.maxLength = 1000;
  input.placeholder = 'Livraison, suivi de commande, retours…';
  input.setAttribute('aria-label', 'Votre message');
  var send = el('button', 'btn', 'Envoyer');
  send.type = 'submit';
  form.appendChild(input);
  form.appendChild(send);
  panel.appendChild(header);
  panel.appendChild(log);
  panel.appendChild(form);
  panel.appendChild(el('p', 'chat-note', 'Assistant automatique. Pour le suivi, munissez-vous de votre n° de commande et de votre e-mail.'));

  function bubble(role, text) {
    var b = el('div', 'chat-msg chat-' + role, text);
    log.appendChild(b);
    log.scrollTop = log.scrollHeight;
    return b;
  }

  function render() {
    log.innerHTML = '';
    bubble('assistant', 'Bonjour ! Je peux répondre à vos questions sur le bandeau, la livraison, les retours ou suivre votre commande.');
    history.forEach(function (m) { bubble(m.role, m.content); });
  }

  launcher.addEventListener('click', function () {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) { render(); input.focus(); }
  });
  close.addEventListener('click', function () { panel.hidden = true; launcher.focus(); });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    history.push({ role: 'user', content: text });
    save();
    bubble('user', text);
    var typing = bubble('assistant', '…');
    typing.classList.add('chat-typing');
    send.disabled = true;
    fetch('/api/support', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history }),
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        var answer = res.reply || res.error || 'Désolé, une erreur est survenue.';
        typing.remove();
        if (res.reply) { history.push({ role: 'assistant', content: answer }); save(); }
        else { history.pop(); save(); }
        bubble('assistant', answer);
      })
      .catch(function () {
        typing.remove();
        history.pop();
        save();
        bubble('assistant', 'Connexion impossible. Réessayez dans un instant.');
      })
      .then(function () { send.disabled = false; input.focus(); });
  });

  document.body.appendChild(panel);
  document.body.appendChild(launcher);
  document.body.classList.add('has-chat');
})();
