/**
 * Site-wide soundscape: persists position & play state in sessionStorage
 * so playback continues across HTML pages. Lunosa has no nav button but
 * still loads this script so audio keeps playing when visiting that page.
 */
(function () {
  /* Must match an audio file next to the HTML pages (same folder on deploy) */
  var AUDIO_SRC = 'Saturn.mp3';
  var KEY_TIME = 'river_site_audio_t';
  var KEY_PLAYING = 'river_site_audio_playing';
  var KEY_MUTED = 'river_site_audio_muted';

  var audio = new Audio(AUDIO_SRC);
  audio.loop = true;
  audio.preload = 'auto';

  function readStoredTime() {
    var v = parseFloat(sessionStorage.getItem(KEY_TIME) || '0');
    return Number.isFinite(v) && v >= 0 ? v : 0;
  }

  function shouldResumePlayback() {
    return sessionStorage.getItem(KEY_PLAYING) === '1';
  }

  function loadMuted() {
    return sessionStorage.getItem(KEY_MUTED) === '1';
  }

  function persist() {
    try {
      sessionStorage.setItem(KEY_TIME, String(audio.currentTime));
      sessionStorage.setItem(KEY_PLAYING, audio.paused ? '0' : '1');
      sessionStorage.setItem(KEY_MUTED, audio.muted ? '1' : '0');
    } catch (_) {}
  }

  audio.muted = loadMuted();

  audio.addEventListener('loadedmetadata', function () {
    var t = readStoredTime();
    if (t > 0.25 && audio.duration > 0 && t < audio.duration - 0.25) {
      audio.currentTime = t;
    }
  });

  function syncAll() {
    var navBtn = document.getElementById('navAudioToggle');
    if (navBtn) {
      var playing = !audio.paused;
      navBtn.textContent = playing ? 'Pause audio' : 'Play audio';
      navBtn.setAttribute('aria-pressed', playing ? 'true' : 'false');
      navBtn.setAttribute(
        'aria-label',
        playing ? 'Pause site soundscape' : 'Play site soundscape'
      );
    }
    var continueAudioBtn = document.getElementById('continueAudioBtn');
    if (continueAudioBtn) {
      continueAudioBtn.textContent = audio.paused
        ? 'Continue with Audio'
        : 'Audio Enabled';
    }
    var playPauseBtn = document.getElementById('playPauseBtn');
    if (playPauseBtn) playPauseBtn.textContent = audio.paused ? 'Play' : 'Pause';
    var muteBtn = document.getElementById('muteBtn');
    if (muteBtn) muteBtn.textContent = audio.muted ? 'Unmute' : 'Mute';
  }

  function togglePlay() {
    if (audio.paused) {
      return audio.play().then(function () {
        persist();
        syncAll();
      }).catch(function (e) {
        console.warn('Audio play blocked', e);
        syncAll();
      });
    }
    audio.pause();
    persist();
    syncAll();
  }

  document.getElementById('navAudioToggle')?.addEventListener('click', togglePlay);
  document.getElementById('continueAudioBtn')?.addEventListener('click', togglePlay);
  document.getElementById('playPauseBtn')?.addEventListener('click', togglePlay);

  document.getElementById('muteBtn')?.addEventListener('click', function () {
    audio.muted = !audio.muted;
    persist();
    syncAll();
  });

  audio.addEventListener('play', syncAll);
  audio.addEventListener('pause', syncAll);
  audio.addEventListener('volumechange', syncAll);

  var lastTick = 0;
  audio.addEventListener('timeupdate', function () {
    var now = Date.now();
    if (now - lastTick < 800) return;
    lastTick = now;
    persist();
  });

  window.addEventListener('pagehide', persist);
  window.addEventListener('beforeunload', persist);

  var resumeDone = false;
  audio.addEventListener(
    'canplay',
    function () {
      if (resumeDone) return;
      resumeDone = true;
      if (shouldResumePlayback()) {
        audio.play().catch(function () {});
      }
      syncAll();
    },
    { once: true }
  );

  syncAll();

  window.RiverSiteAudio = { audio: audio, syncAll: syncAll, persist: persist, togglePlay: togglePlay };
})();
