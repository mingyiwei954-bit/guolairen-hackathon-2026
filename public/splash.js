'use strict';

(() => {
  const SPLASH_TOTAL_MS = 4000;
  const SPLASH_FADE_MS = 1200;
  const SPLASH_FADE_START_MS = SPLASH_TOTAL_MS - SPLASH_FADE_MS;
  const SAFETY_BUFFER_MS = 150;
  const splash = document.getElementById('welcome-splash');

  if (!splash) return;

  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let finished = false;
  let startTimer = 0;
  let safetyTimer = 0;

  const finish = () => {
    if (finished) return;
    finished = true;
    window.clearTimeout(startTimer);
    window.clearTimeout(safetyTimer);
    splash.removeEventListener('transitionend', onTransitionEnd);
    const content = document.getElementById('phone-content');
    splash.remove();
    content?.removeAttribute('inert');
    content?.removeAttribute('aria-hidden');
    document.body.classList.remove('splash-active', 'splash-fading');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#f8f8f5');
  };

  function onTransitionEnd(event) {
    if (event.target === splash && event.propertyName === 'opacity') finish();
  }

  const startFade = () => {
    if (finished) return;
    document.body.classList.add('splash-fading');
    splash.addEventListener('transitionend', onTransitionEnd);
    splash.classList.add('is-fading');
    if (reducedMotion) {
      requestAnimationFrame(finish);
      return;
    }
    safetyTimer = window.setTimeout(finish, SPLASH_FADE_MS + SAFETY_BUFFER_MS);
  };

  startTimer = window.setTimeout(startFade, reducedMotion ? SPLASH_TOTAL_MS : SPLASH_FADE_START_MS);
})();
