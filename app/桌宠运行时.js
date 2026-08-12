(function () {
  "use strict";
  function createGangdanerPet(root, manifest) {
    let active = null, media = null;
    function setState(key) {
      const state = manifest.states[key]; if (!state) return false;
      const video = /\.(webm|mp4)(\?|$)/i.test(state.file);
      if (!media || (media.tagName === "VIDEO") !== video) { media?.remove(); media = document.createElement(video ? "video" : "img"); media.className = "gangdaner-pet-video"; media.draggable = false; root.appendChild(media); }
      media.src = state.file; active = key; root.dataset.state = key;
      if (video) { media.loop = state.loop !== false; media.muted = true; media.autoplay = true; media.playsInline = true; media.play().catch(() => {}); }
      return true;
    }
    setState(manifest.defaultState || Object.keys(manifest.states)[0]);
    return { setState, getState: () => active, get media() { return media; } };
  }
  window.createGangdanerPet = createGangdanerPet;
})();
