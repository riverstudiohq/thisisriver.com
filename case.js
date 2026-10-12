(function () {
  'use strict';

  /* Flow rows: arrow buttons + drag to scroll */
  document.querySelectorAll('.flow').forEach(function (flow) {
    var track = flow.querySelector('.flow__track');
    var prev = flow.querySelector('[data-flow-prev]');
    var next = flow.querySelector('[data-flow-next]');
    if (!track) return;

    function step() {
      var item = track.querySelector('.screen');
      var gap = parseFloat(getComputedStyle(track).columnGap) || 0;
      return item ? item.getBoundingClientRect().width + gap : track.clientWidth * 0.8;
    }

    function sync() {
      var max = track.scrollWidth - track.clientWidth - 2;
      flow.classList.toggle('is-static', max <= 0);
      if (prev) prev.disabled = track.scrollLeft <= 2;
      if (next) next.disabled = track.scrollLeft >= max;
    }

    if (prev) prev.addEventListener('click', function () { track.scrollBy({ left: -step(), behavior: 'smooth' }); });
    if (next) next.addEventListener('click', function () { track.scrollBy({ left: step(), behavior: 'smooth' }); });
    track.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    sync();

    var startX = 0;
    var startScroll = 0;
    var down = false;
    var moved = false;

    track.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      down = true;
      moved = false;
      startX = e.clientX;
      startScroll = track.scrollLeft;
    });

    window.addEventListener('pointermove', function (e) {
      if (!down) return;
      var dx = e.clientX - startX;
      if (!moved && Math.abs(dx) > 5) {
        moved = true;
        track.classList.add('is-dragging');
      }
      if (moved) track.scrollLeft = startScroll - dx;
    });

    window.addEventListener('pointerup', function () {
      if (!down) return;
      down = false;
      if (moved) {
        track.classList.remove('is-dragging');
        track.scrollBy({ left: 0 });
      }
    });

    /* Swallow the click that ends a drag so it doesn't open the lightbox */
    track.addEventListener('click', function (e) {
      if (moved) {
        e.preventDefault();
        e.stopPropagation();
        moved = false;
      }
    }, true);
  });

  /* Lightbox */
  var box = document.getElementById('lightbox');
  var shots = Array.prototype.slice.call(document.querySelectorAll('.screen__open'));
  if (box && shots.length) {
    var img = box.querySelector('img');
    var cap = box.querySelector('figcaption');
    var index = 0;
    var lastFocus = null;

    function show(i) {
      index = (i + shots.length) % shots.length;
      var src = shots[index].querySelector('img');
      var fig = shots[index].closest('.screen');
      var label = fig.querySelector('.screen__label');
      img.src = src.getAttribute('src');
      img.alt = src.alt;
      cap.textContent = label ? label.textContent : '';
    }

    function open(i) {
      lastFocus = document.activeElement;
      show(i);
      box.classList.add('is-open');
      box.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      box.querySelector('.lightbox__close').focus();
    }

    function close() {
      box.classList.remove('is-open');
      box.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      if (lastFocus) lastFocus.focus();
    }

    shots.forEach(function (btn, i) {
      btn.addEventListener('click', function () { open(i); });
    });
    box.querySelector('.lightbox__close').addEventListener('click', close);
    box.querySelector('[data-lightbox-prev]').addEventListener('click', function () { show(index - 1); });
    box.querySelector('[data-lightbox-next]').addEventListener('click', function () { show(index + 1); });
    box.addEventListener('click', function (e) {
      if (e.target === box) close();
    });
    document.addEventListener('keydown', function (e) {
      if (!box.classList.contains('is-open')) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') show(index - 1);
      else if (e.key === 'ArrowRight') show(index + 1);
    });
  }
})();
