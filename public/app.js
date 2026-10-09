(function () {
  'use strict';

  var data = JSON.parse(document.getElementById('shop-data').textContent);
  var euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
  var fmt = function (cents) { return euro.format(cents / 100); };
  var basePrice = data.offers[0].price;

  var params = new URLSearchParams(location.search);
  var preferred = data.variants.some(function (v) { return v.id === params.get('couleur'); }) ? params.get('couleur') : data.variants[0].id;
  var state = { offer: (data.offers.find(function (o) { return o.badge; }) || data.offers[0]).id, variants: [] };

  var offersEl = document.getElementById('offers');
  var pickersEl = document.getElementById('color-pickers');
  var labelEl = document.getElementById('checkout-label');
  var btn = document.getElementById('checkout-btn');
  var errorEl = document.getElementById('form-error');
  var stickyPrice = document.getElementById('sticky-price');

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k === 'class') node.className = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function currentOffer() {
    return data.offers.find(function (o) { return o.id === state.offer; });
  }

  function renderOffers() {
    offersEl.innerHTML = '';
    data.offers.forEach(function (o) {
      var saving = basePrice * o.qty - o.price;
      var label = el('label', { class: 'offer' + (o.id === state.offer ? ' selected' : '') }, [
        el('input', { type: 'radio', name: 'offer', value: o.id }),
        el('span', { class: 'offer-radio', 'aria-hidden': 'true' }),
        el('span', {}, [el('span', { class: 'offer-title', text: o.label }), el('br'), el('span', { class: 'offer-note', text: o.note })]),
        el('span', { class: 'offer-price' }, [
          document.createTextNode(fmt(o.price)),
          o.qty > 1 ? el('span', { class: 'offer-unit', text: fmt(Math.round(o.price / o.qty)) + ' / bandeau' }) : null,
          saving > 0 ? el('span', { class: 'offer-save', text: 'Économisez ' + fmt(saving) }) : null,
        ]),
        o.badge ? el('span', { class: 'offer-badge', text: o.badge }) : null,
      ]);
      var input = label.querySelector('input');
      input.checked = o.id === state.offer;
      input.addEventListener('change', function () {
        state.offer = o.id;
        renderOffers();
        renderPickers();
        renderTotal();
      });
      offersEl.appendChild(label);
    });
  }

  function renderPickers() {
    var offer = currentOffer();
    var previous = state.variants.slice();
    state.variants = [];
    for (var i = 0; i < offer.qty; i++) state.variants.push(previous[i] || previous[0] || preferred);
    document.getElementById('colors-legend').textContent = offer.qty > 1 ? 'Couleurs' : 'Couleur';
    pickersEl.innerHTML = '';
    state.variants.forEach(function (selected, index) {
      var group = el('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Couleur du bandeau ' + (index + 1) });
      data.variants.forEach(function (v) {
        var b = el('button', { type: 'button', class: 'swatch', role: 'radio', 'aria-checked': String(v.id === selected) }, [
          el('span', { class: 'swatch-dot', style: 'background:' + v.hex }),
          document.createTextNode(v.label),
        ]);
        b.addEventListener('click', function () {
          state.variants[index] = v.id;
          group.querySelectorAll('.swatch').forEach(function (s) { s.setAttribute('aria-checked', 'false'); });
          b.setAttribute('aria-checked', 'true');
        });
        group.appendChild(b);
      });
      var row = el('div', { class: 'color-row' }, [
        offer.qty > 1 ? el('span', { class: 'color-row-label', text: 'Bandeau ' + (index + 1) }) : null,
        group,
      ]);
      pickersEl.appendChild(row);
    });
  }

  function renderTotal() {
    var offer = currentOffer();
    labelEl.textContent = 'Commander — ' + fmt(offer.price);
    if (stickyPrice) stickyPrice.textContent = 'dès ' + fmt(Math.round(data.offers[data.offers.length - 1].price / data.offers[data.offers.length - 1].qty)) + ' · livraison offerte';
  }

  document.getElementById('order-form').addEventListener('submit', function (event) {
    event.preventDefault();
    errorEl.hidden = true;
    btn.disabled = true;
    labelEl.textContent = 'Redirection vers le paiement sécurisé…';
    var offer = currentOffer();
    if (window.track) window.track('InitiateCheckout', { value: offer.price / 100, currency: 'EUR', num_items: offer.qty });
    fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offer: state.offer, variants: state.variants }),
    })
      .then(function (res) { return res.json().then(function (body) { return { ok: res.ok, body: body }; }); })
      .then(function (r) {
        if (!r.ok || !r.body.url) throw new Error(r.body.error || 'Erreur inattendue');
        location.href = r.body.url;
      })
      .catch(function (err) {
        errorEl.textContent = err.message || 'Impossible de lancer le paiement. Réessayez.';
        errorEl.hidden = false;
        btn.disabled = false;
        renderTotal();
      });
  });

  // Galerie
  var main = document.getElementById('gallery-main');
  document.querySelectorAll('.thumb').forEach(function (t) {
    t.addEventListener('click', function () {
      main.src = t.getAttribute('data-src');
      document.querySelectorAll('.thumb').forEach(function (x) { x.classList.remove('active'); });
      t.classList.add('active');
    });
  });

  // Avis clients (réels uniquement)
  function stars(n) {
    var full = Math.round(n);
    return '★★★★★'.slice(0, full) + '☆☆☆☆☆'.slice(0, 5 - full);
  }
  if (data.reviews.count > 0) {
    var line = document.getElementById('rating-line');
    line.appendChild(el('span', { class: 'stars-inline', text: stars(data.reviews.average) }));
    line.appendChild(document.createTextNode(String(data.reviews.average).replace('.', ',') + '/5 · ' + data.reviews.count + (data.reviews.count > 1 ? ' avis vérifiés' : ' avis vérifié')));
    line.hidden = false;
  }
  fetch('/api/reviews')
    .then(function (r) { return r.json(); })
    .then(function (res) {
      var box = document.getElementById('reviews');
      if (!res.count) {
        box.appendChild(el('div', { class: 'reviews-empty', text: 'Les premiers avis de nos clients arrivent bientôt. Commandez aujourd\'hui et donnez le vôtre après quelques nuits !' }));
        return;
      }
      document.getElementById('reviews-title').textContent = String(res.average).replace('.', ',') + '/5 sur ' + res.count + (res.count > 1 ? ' avis vérifiés' : ' avis vérifié');
      res.reviews.slice(0, 9).forEach(function (r) {
        box.appendChild(el('article', { class: 'review' }, [
          el('span', { class: 'stars-inline', text: stars(r.rating), 'aria-label': r.rating + ' sur 5' }),
          r.title ? el('h3', { text: r.title }) : null,
          el('p', { text: r.body }),
          el('footer', {}, [document.createTextNode(r.name + ' · '), el('span', { class: 'verified', text: 'Achat vérifié' })]),
        ]));
      });
    })
    .catch(function () {});

  // Barre d'achat mobile : visible quand le formulaire n'est plus à l'écran.
  var sticky = document.getElementById('sticky-buy');
  if (sticky && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      sticky.hidden = entries[0].isIntersecting;
    }).observe(document.getElementById('order-form'));
  }

  renderOffers();
  renderPickers();
  renderTotal();
  if (window.track) window.track('ViewContent', { value: basePrice / 100, currency: 'EUR' });
})();
