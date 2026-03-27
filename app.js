const state = {
  defaultVolume: 0.2,
  clipVolume: 1,
  video: null,
  tracks: [],
  ffmpeg: null,
  isExporting: false,
  exportStatus: "",
  exportUrl: null,
};

const elements = {
  appShell: document.querySelector(".app-shell"),
  dropOverlay: document.getElementById("drop-overlay"),
  viewerPanel: document.getElementById("viewer-panel"),
  videoWrap: document.getElementById("video-wrap"),
  videoPreview: document.getElementById("video-preview"),
  clipVolume: document.getElementById("clip-volume"),
  clipVolumeValue: document.getElementById("clip-volume-value"),
  defaultVolume: document.getElementById("default-volume"),
  defaultVolumeValue: document.getElementById("default-volume-value"),
  tracks: document.getElementById("tracks"),
  pickVideo: document.getElementById("pick-video"),
  pickAudio: document.getElementById("pick-audio"),
  muteAll: document.getElementById("mute-all"),
  clearAll: document.getElementById("clear-all"),
  downloadMix: document.getElementById("download-mix"),
  exportStatus: document.getElementById("export-status"),
  controlsPanel: document.querySelector(".controls-panel"),
};

const syncEvents = ["play", "pause", "seeking", "seeked", "timeupdate", "ratechange", "volumechange"];
const ffmpegModuleUrl = "./node_modules/@ffmpeg/ffmpeg/dist/esm/index.js";
const ffmpegClassWorkerUrl = new URL("./node_modules/@ffmpeg/ffmpeg/dist/esm/worker.js", window.location.href).href;
const ffmpegCoreBaseUrl = new URL("./node_modules/@ffmpeg/core/dist/esm/", window.location.href).href;

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

function setSliderFill(input) {
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const value = Number(input.value || min);
  const range = max - min || 1;
  const percent = ((value - min) / range) * 100;
  input.style.setProperty("--range-fill", `${percent}%`);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "";
  }

  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const amount = bytes / 1024 ** index;
  return `${amount.toFixed(amount >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function isMp4(file) {
  return file.type === "video/mp4" || file.name.toLowerCase().endsWith(".mp4");
}

function isAudioFile(file) {
  const lowered = file.name.toLowerCase();
  return file.type === "audio/mpeg" || file.type === "audio/wav" || lowered.endsWith(".mp3") || lowered.endsWith(".wav");
}

function containsFiles(event) {
  return Array.from(event.dataTransfer?.types || []).includes("Files");
}

function updateDefaultVolume() {
  elements.defaultVolumeValue.textContent = formatPercent(state.defaultVolume);
  elements.defaultVolume.value = String(Math.round(state.defaultVolume * 100));
  setSliderFill(elements.defaultVolume);
}

function updateClipVolume() {
  state.clipVolume = Math.max(0, Math.min(state.clipVolume, 1));
  elements.clipVolumeValue.textContent = formatPercent(state.clipVolume);
  elements.clipVolume.value = String(Math.round(state.clipVolume * 100));
  setSliderFill(elements.clipVolume);

  if (state.video) {
    elements.videoPreview.muted = false;
    elements.videoPreview.volume = Math.min(state.clipVolume, 1);
  }
}

function updateTrackCount() {
  return state.tracks.length;
}

function getEnabledTracks() {
  return state.tracks.filter((track) => track.enabled);
}

function updateExportUI() {
  const enabledTracks = getEnabledTracks();
  elements.downloadMix.disabled = !state.video || state.isExporting;

  if (state.exportStatus) {
    elements.exportStatus.textContent = state.exportStatus;
    return;
  }

  if (!state.video) {
    elements.exportStatus.textContent = "";
    return;
  }

  if (!enabledTracks.length) {
    elements.exportStatus.textContent = "No enabled background tracks. Download uses the original clip.";
    return;
  }

  elements.exportStatus.textContent = `${enabledTracks.length} enabled ${enabledTracks.length === 1 ? "track" : "tracks"} ready to mix.`;
}

function setExportStatus(message) {
  state.exportStatus = message;
  updateExportUI();
}

function revokeExportUrl() {
  if (state.exportUrl) {
    URL.revokeObjectURL(state.exportUrl);
    state.exportUrl = null;
  }
}

function revokeMediaUrl(media) {
  if (media?.url) {
    URL.revokeObjectURL(media.url);
  }
}

function pauseTrack(track) {
  track.audio.pause();
}

function updateVideoFrameSize() {
  const { appShell, videoPreview, videoWrap } = elements;

  if (window.innerWidth <= 960 || !videoPreview.videoWidth || !videoPreview.videoHeight) {
    videoWrap.style.removeProperty("--video-frame-height");
    return;
  }

  const shellGap = parseFloat(getComputedStyle(appShell).columnGap || getComputedStyle(appShell).gap || "12");
  const halfShellWidth = (appShell.clientWidth - shellGap) / 2 - 24;
  const halfViewportWidth = window.innerWidth / 2 - 24;
  const availableWidth = Math.max(180, Math.min(halfShellWidth, halfViewportWidth));
  const maxHeight = Math.min(window.innerHeight - 120, 720);
  const widthRatio = availableWidth / videoPreview.videoWidth;
  const heightRatio = maxHeight / videoPreview.videoHeight;
  const scale = Math.min(widthRatio, heightRatio, 1);
  const height = Math.round(videoPreview.videoHeight * scale);

  videoWrap.style.setProperty("--video-frame-height", `${height}px`);
}

function toggleTrackEnabled(track, enabled = !track.enabled) {
  revokeExportUrl();
  track.enabled = enabled;
  syncTrack(track);
  setExportStatus("");
  renderTracks();
}

function muteAllTracks() {
  if (!state.tracks.length) {
    return;
  }

  revokeExportUrl();
  state.tracks.forEach((track) => {
    track.enabled = false;
    syncTrack(track);
  });
  setExportStatus("");
  renderTracks();
}

function clearAllTracks() {
  if (!state.tracks.length) {
    return;
  }

  revokeExportUrl();
  const removedTracks = state.tracks.splice(0, state.tracks.length);
  removedTracks.forEach((track) => {
    pauseTrack(track);
    revokeMediaUrl(track);
  });
  setExportStatus("");
  renderTracks();
}

function syncTrack(track) {
  const video = elements.videoPreview;
  const enabled = track.enabled;
  const visibleVolume = track.volume;
  track.audio.loop = true;
  track.audio.volume = enabled ? visibleVolume : 0;
  track.audio.muted = !enabled || video.muted;
  track.audio.playbackRate = video.playbackRate;

  if (!enabled) {
    pauseTrack(track);
    return;
  }

  if (Math.abs(track.audio.currentTime - video.currentTime) > 0.35) {
    try {
      track.audio.currentTime = video.currentTime;
    } catch (_error) {
      track.audio.currentTime = 0;
    }
  }

  if (video.paused) {
    pauseTrack(track);
    return;
  }

  const playPromise = track.audio.play();
  if (playPromise?.catch) {
    playPromise.catch(() => {
      pauseTrack(track);
    });
  }
}

function syncAllTracks() {
  state.tracks.forEach(syncTrack);
}

function stopAllTracks() {
  state.tracks.forEach((track) => {
    pauseTrack(track);
    track.audio.currentTime = 0;
  });
}

function removeTrack(trackId) {
  const index = state.tracks.findIndex((track) => track.id === trackId);
  if (index === -1) {
    return;
  }

  const [track] = state.tracks.splice(index, 1);
  pauseTrack(track);
  revokeMediaUrl(track);
  revokeExportUrl();
  setExportStatus("");
  renderTracks();
}

function createTrack(file) {
  const id = crypto.randomUUID();
  const url = URL.createObjectURL(file);
  const audio = new Audio(url);
  audio.preload = "auto";

  return {
    id,
    name: file.name,
    url,
    file,
    audio,
    enabled: true,
    volume: state.defaultVolume,
  };
}

function renderTracks() {
  elements.tracks.textContent = "";

  if (!state.tracks.length) {
    const emptyState = document.createElement("p");
    emptyState.className = "empty-state";
    emptyState.innerHTML = 'Drop any <strong>.mp4</strong> and <strong>.mp3</strong>/<strong>.wav</strong> files to add background tracks.';
    elements.tracks.append(emptyState);
    updateTrackCount();
    updateExportUI();
    return;
  }

  const fragment = document.createDocumentFragment();

  state.tracks.forEach((track) => {
    const row = document.createElement("article");
    row.className = `track-row${track.enabled ? "" : " is-disabled"}`;
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-pressed", String(track.enabled));

    const topLine = document.createElement("div");
    topLine.className = "track-topline";

    const muteButton = document.createElement("button");
    muteButton.className = "track-toggle-button";
    muteButton.type = "button";
    muteButton.textContent = track.enabled ? "Mute" : "Muted";
    muteButton.setAttribute("aria-label", `${track.enabled ? "Mute" : "Unmute"} ${track.name}`);
    muteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleTrackEnabled(track);
    });

    const main = document.createElement("div");
    main.className = "track-main";

    const name = document.createElement("p");
    name.className = "track-name";
    name.textContent = track.name;
    main.append(name);

    topLine.append(muteButton, main);

    const controls = document.createElement("div");
    controls.className = "track-controls";

    const slider = document.createElement("input");
    slider.className = "track-slider";
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.value = String(Math.round(track.volume * 100));
    slider.setAttribute("aria-label", `Volume for ${track.name}`);
    setSliderFill(slider);
    slider.addEventListener("input", () => {
      revokeExportUrl();
      track.volume = Number(slider.value) / 100;
      setSliderFill(slider);
      syncTrack(track);
      value.textContent = formatPercent(track.volume);
      setExportStatus("");
    });

    const value = document.createElement("span");
    value.className = "volume-readout";
    value.textContent = formatPercent(track.volume);

    const removeButton = document.createElement("button");
    removeButton.className = "remove-button";
    removeButton.type = "button";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", () => {
      removeTrack(track.id);
    });

    row.addEventListener("click", (event) => {
      if (event.target.closest("button") || event.target.classList.contains("track-slider")) {
        return;
      }

      toggleTrackEnabled(track);
    });

    row.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      if (event.target.closest("button, input")) {
        return;
      }

      event.preventDefault();
      toggleTrackEnabled(track);
    });

    controls.append(slider, value, removeButton);
    row.append(topLine, controls);
    fragment.append(row);
  });

  elements.tracks.append(fragment);
  updateTrackCount();
  updateExportUI();
}

function setVideo(file) {
  revokeExportUrl();
  revokeMediaUrl(state.video);
  const url = URL.createObjectURL(file);
  state.video = { url, name: file.name, file };
  elements.videoPreview.src = url;
  elements.videoPreview.load();
  elements.videoWrap.classList.remove("empty");
  elements.videoPreview.volume = Math.min(state.clipVolume, 1);
  stopAllTracks();
  setExportStatus("");
}

function addAudioTracks(files) {
  revokeExportUrl();
  files.forEach((file) => {
    state.tracks.push(createTrack(file));
  });

  renderTracks();
  syncAllTracks();
  setExportStatus("");
}

function processFiles(fileList) {
  const files = [...fileList];
  const videoFile = files.find(isMp4);
  const audioFiles = files.filter(isAudioFile);

  if (videoFile) {
    setVideo(videoFile);
  }

  if (audioFiles.length) {
    addAudioTracks(audioFiles);
  }
}

function openPicker({ accept, multiple = false }) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept;
  input.multiple = multiple;
  input.addEventListener("change", () => {
    if (input.files?.length) {
      processFiles(input.files);
    }
  });
  input.click();
}

function setDropActive(isActive) {
  elements.dropOverlay.classList.toggle("is-active", isActive);
}

function sanitizeStem(name) {
  return name.replace(/\.[^.]+$/, "").replace(/[^a-z0-9-_]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "clip";
}

async function fileToUint8Array(file) {
  return new Uint8Array(await file.arrayBuffer());
}

async function inputHasAudio(ffmpeg, inputName) {
  const logs = [];
  const onLog = ({ message }) => {
    logs.push(message);
  };

  ffmpeg.on("log", onLog);

  try {
    await ffmpeg.exec(["-i", inputName]);
  } finally {
    ffmpeg.off("log", onLog);
  }

  return logs.some((line) => /Stream #0:.*Audio:/.test(line));
}

async function loadFFmpeg() {
  if (state.ffmpeg) {
    return state.ffmpeg;
  }

  setExportStatus("Loading ffmpeg.wasm...");

  const { FFmpeg } = await import(ffmpegModuleUrl);

  const ffmpeg = new FFmpeg();

  ffmpeg.on("progress", ({ progress }) => {
    if (!state.isExporting) {
      return;
    }

    const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));
    setExportStatus(pct ? `Rendering ${pct}%...` : "Rendering...");
  });

  await ffmpeg.load({
    classWorkerURL: ffmpegClassWorkerUrl,
    coreURL: `${ffmpegCoreBaseUrl}ffmpeg-core.js`,
    wasmURL: `${ffmpegCoreBaseUrl}ffmpeg-core.wasm`,
  });

  state.ffmpeg = ffmpeg;
  setExportStatus("");
  return ffmpeg;
}

async function downloadMix() {
  if (!state.video || state.isExporting) {
    return;
  }

  state.isExporting = true;
  revokeExportUrl();
  updateExportUI();

  try {
    const ffmpeg = await loadFFmpeg();
    const enabledTracks = getEnabledTracks();
    const outputName = `${sanitizeStem(state.video.file.name)}-mix.mp4`;
    const videoInputName = `video-${Date.now()}.mp4`;

    await ffmpeg.writeFile(videoInputName, await fileToUint8Array(state.video.file));
    const videoHasAudio = await inputHasAudio(ffmpeg, videoInputName);

    if (!enabledTracks.length) {
      if (!videoHasAudio || Math.abs(state.clipVolume - 1) < 0.001) {
        setExportStatus("Copying original clip...");
        await ffmpeg.exec([
          "-y",
          "-i",
          videoInputName,
          "-c",
          "copy",
          outputName,
        ]);
      } else {
        setExportStatus("Rendering clip audio...");
        await ffmpeg.exec([
          "-y",
          "-i",
          videoInputName,
          "-filter:a",
          `volume=${Math.max(0, state.clipVolume).toFixed(3)}`,
          "-c:v",
          "copy",
          "-c:a",
          "aac",
          outputName,
        ]);
      }
    } else {
      const audioInputNames = [];

      for (const [index, track] of enabledTracks.entries()) {
        const extension = track.file.name.split(".").pop()?.toLowerCase() || "mp3";
        const inputName = `track-${Date.now()}-${index}.${extension}`;
        audioInputNames.push(inputName);
        await ffmpeg.writeFile(inputName, await fileToUint8Array(track.file));
      }

      const filterParts = [];
      const mixInputs = [];

      if (videoHasAudio) {
        filterParts.push(`[0:a]volume=${Math.max(0, state.clipVolume).toFixed(3)}[base]`);
        mixInputs.push("[base]");
      }

      enabledTracks.forEach((track, index) => {
        const volume = Math.max(0, track.volume).toFixed(3);
        filterParts.push(`[${index + 1}:a]volume=${volume}[a${index}]`);
        mixInputs.push(`[a${index}]`);
      });

      const filterComplex = `${filterParts.join(";")};${mixInputs.join("")}amix=inputs=${mixInputs.length}:duration=longest:dropout_transition=0[mix]`;
      const args = ["-y", "-i", videoInputName];

      audioInputNames.forEach((inputName) => {
        args.push("-stream_loop", "-1", "-i", inputName);
      });

      args.push(
        "-filter_complex",
        filterComplex,
        "-map",
        "0:v:0",
        "-map",
        "[mix]",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-shortest",
        outputName,
      );

      await ffmpeg.exec(args);
    }

    const data = await ffmpeg.readFile(outputName);
    const blob = new Blob([data], { type: "video/mp4" });
    const url = URL.createObjectURL(blob);
    state.exportUrl = url;

    const link = document.createElement("a");
    link.href = url;
    link.download = outputName;
    link.click();

    setExportStatus("Download ready.");
  } catch (error) {
    console.error(error);
    setExportStatus("Export failed. Check the browser console and try again.");
  } finally {
    state.isExporting = false;
    updateExportUI();
  }
}

function attachGlobalDrop() {
  let dragDepth = 0;

  document.addEventListener("dragenter", (event) => {
    if (!containsFiles(event)) {
      return;
    }

    event.preventDefault();
    dragDepth += 1;
    setDropActive(true);
  });

  document.addEventListener("dragover", (event) => {
    if (!containsFiles(event)) {
      return;
    }

    event.preventDefault();
    setDropActive(true);
  });

  document.addEventListener("dragleave", (event) => {
    if (!containsFiles(event)) {
      return;
    }

    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) {
      setDropActive(false);
    }
  });

  document.addEventListener("drop", (event) => {
    if (!containsFiles(event)) {
      return;
    }

    event.preventDefault();
    dragDepth = 0;
    setDropActive(false);

    if (event.dataTransfer?.files?.length) {
      processFiles(event.dataTransfer.files);
    }
  });
}

function attachVideoSync() {
  elements.videoPreview.addEventListener("loadedmetadata", updateVideoFrameSize);
  elements.videoPreview.addEventListener("loadedmetadata", updateClipVolume);
  elements.videoPreview.addEventListener("loadeddata", updateClipVolume);

  syncEvents.forEach((eventName) => {
    elements.videoPreview.addEventListener(eventName, syncAllTracks);
  });

  elements.videoPreview.addEventListener("ended", () => {
    stopAllTracks();
  });
}

function attachKeyboardShortcuts() {
  document.addEventListener("keydown", (event) => {
    if (event.code !== "Space") {
      return;
    }

    const target = event.target;
    const eventPath = typeof event.composedPath === "function" ? event.composedPath() : [];
    const isVideoFocused =
      document.activeElement === elements.videoPreview ||
      target === elements.videoPreview ||
      eventPath.includes(elements.videoPreview);

    if (isVideoFocused) {
      return;
    }

    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLButtonElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      target?.isContentEditable
    ) {
      return;
    }

    if (!state.video) {
      return;
    }

    event.preventDefault();

    if (elements.videoPreview.paused) {
      const playPromise = elements.videoPreview.play();
      if (playPromise?.catch) {
        playPromise.catch(() => {});
      }
      return;
    }

    elements.videoPreview.pause();
  });
}

elements.defaultVolume.addEventListener("input", () => {
  state.defaultVolume = Number(elements.defaultVolume.value) / 100;
  updateDefaultVolume();
});

elements.clipVolume.addEventListener("input", () => {
  revokeExportUrl();
  state.clipVolume = Math.max(0, Math.min(Number(elements.clipVolume.value) / 100, 1));
  updateClipVolume();
  setExportStatus("");
});

elements.pickVideo.addEventListener("click", () => {
  openPicker({ accept: ".mp4,video/mp4" });
});

elements.pickAudio.addEventListener("click", () => {
  openPicker({ accept: ".mp3,.wav,audio/mpeg,audio/wav", multiple: true });
});

elements.muteAll.addEventListener("click", () => {
  muteAllTracks();
});

elements.clearAll.addEventListener("click", () => {
  clearAllTracks();
});

elements.downloadMix.addEventListener("click", () => {
  downloadMix();
});

attachGlobalDrop();
attachVideoSync();
attachKeyboardShortcuts();
updateClipVolume();
updateDefaultVolume();
renderTracks();
updateExportUI();
window.addEventListener("resize", updateVideoFrameSize);

window.addEventListener("beforeunload", () => {
  revokeMediaUrl(state.video);
  state.tracks.forEach((track) => revokeMediaUrl(track));
  revokeExportUrl();
});
