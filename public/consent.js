// Bandeau cookies (RGPD) + chargement des pixels publicitaires après consentement.
// Les identifiants viennent de /analytics-config.js (variables META_PIXEL_ID, TIKTOK_PIXEL_ID, GA4_ID).
(function () {
  'use strict';

  var cfg = window.ANALYTICS || {};
  var hasTrackers = cfg.metaPixelId || cfg.tiktokPixelId || cfg.ga4Id;
  var KEY = 'cookie-consent-v1';
  var banner = document.getElementById('cookie-banner');
  var loaded = false;

  function getConsent() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function setConsent(value) {
    try { localStorage.setItem(KEY, value); } catch (e) { /* navigation privée */ }
  }

  function loadScript(src) {
    var s = document.createElement('script');
    s.async = true;
    s.src = src;
    document.head.appendChild(s);
  }

  function loadTrackers() {
    if (loaded || !hasTrackers) return;
    loaded = true;
    if (cfg.metaPixelId) {
      var f = (window.fbq = function () { f.callMethod ? f.callMethod.apply(f, arguments) : f.queue.push(arguments); });
      if (!window._fbq) window._fbq = f;
      f.push = f; f.loaded = true; f.version = '2.0'; f.queue = [];
      loadScript('https://connect.facebook.net/en_US/fbevents.js');
      window.fbq('init', cfg.metaPixelId);
      window.fbq('track', 'PageView');
    }
    if (cfg.tiktokPixelId) {
      var ttq = (window.ttq = window.ttq || []);
      ['page', 'track', 'identify'].forEach(function (m) {
        ttq[m] = function () { ttq.push([m].concat([].slice.call(arguments))); };
      });
      loadScript('https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=' + encodeURIComponent(cfg.tiktokPixelId) + '&lib=ttq');
      ttq.page();
    }
    if (cfg.ga4Id) {
      window.dataLayer = window.dataLayer || [];
      window.gtag = function () { window.dataLayer.push(arguments); };
      loadScript('https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(cfg.ga4Id));
      window.gtag('js', new Date());
      window.gtag('config', cfg.ga4Id);
    }
    flush();
  }

  var queue = [];
  var NAMES = {
    ViewContent: { tt: 'ViewContent', ga: 'view_item' },
    InitiateCheckout: { tt: 'InitiateCheckout', ga: 'begin_checkout' },
    Purchase: { tt: 'CompletePayment', ga: 'purchase' },
  };

  function send(name, params) {
    var n = NAMES[name] || { tt: name, ga: name };
    if (window.fbq) window.fbq('track', name, params, params.transaction_id ? { eventID: params.transaction_id } : undefined);
    if (window.ttq && window.ttq.track) window.ttq.track(n.tt, params);
    if (window.gtag) window.gtag('event', n.ga, params);
  }

  function flush() {
    while (queue.length) send.apply(null, queue.shift());
  }

  window.track = function (name, params) {
    if (!hasTrackers) return;
    queue.push([name, params || {}]);
    if (loaded) flush();
  };

  function showBanner() { if (banner && hasTrackers) banner.hidden = false; }

  if (banner) {
    banner.addEventListener('click', function (e) {
      var choice = e.target.getAttribute && e.target.getAttribute('data-consent');
      if (!choice) return;
      setConsent(choice);
      banner.hidden = true;
      if (choice === 'accept') loadTrackers();
      else if (loaded) location.reload();
    });
  }
  document.querySelectorAll('[data-cookie-settings]').forEach(function (b) {
    b.addEventListener('click', function () {
      if (banner) banner.hidden = false;
    });
  });

  var consent = getConsent();
  if (consent === 'accept') loadTrackers();
  else if (!consent) showBanner();

  if (window.PURCHASE) {
    var p = window.PURCHASE;
    window.track('Purchase', { value: p.value, currency: p.currency, transaction_id: p.transaction_id, num_items: p.quantity });
  }
})();
