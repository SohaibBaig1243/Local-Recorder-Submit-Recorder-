// recorder-private-optimized.js
// Fixed & tested version with Finish → Download toggle and Record Again reset

(function () {
  // ----- Embedded detection -----
  function detectEmbeddedMode() {
    try {
      const isInIframe = window.self !== window.top;
      const isSmallViewport =
        window.innerHeight < 600 || window.innerWidth < 800;
      let isCrossOrigin = false;
      try {
        isCrossOrigin =
          window.parent.location.origin !== window.location.origin;
      } catch {
        isCrossOrigin = true;
      }
      if (isInIframe || isCrossOrigin || isSmallViewport)
        document.body.classList.add("embedded");
    } catch (e) {
      console.log("embedded detect error", e);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    // Hide home screen and go straight to recording
    const homeScreen = document.getElementById("homeScreen");
    if (homeScreen) homeScreen.style.display = "none";

    const recordingScreen = document.getElementById("recordingScreen");
    if (recordingScreen) recordingScreen.style.display = "block";

    if (typeof startRecording === "function") startRecording("video");
  });

  // ----- State & elements -----
  let mediaStream = null,
    mediaRecorder = null,
    recordedChunks = [],
    isRecording = false,
    isPaused = false,
    recordingTimer = null,
    recordingSeconds = 0,
    isFinished = false;

  const homeScreen = document.getElementById("homeScreen");
  const recordingScreen = document.getElementById("recordingScreen");
  const videoPreview = document.getElementById("videoPreview");
  const videoPlayback = document.getElementById("videoPlayback");
  const recordingStatusOverlay = document.getElementById("recordingStatusOverlay");
  const recordingStatusText = document.getElementById("recordingStatusText");
  const recordingTimerElement = document.getElementById("recordingTimer");
  const startButton = document.getElementById("startButton");
  const pauseButton = document.getElementById("pauseButton");
  const resumeButton = document.getElementById("resumeButton");
  const stopButton = document.getElementById("stopButton");

  // ----- Utilities -----
  function showError(msg) {
    const ex = document.querySelector(".error-message");
    if (ex) ex.remove();
    const d = document.createElement("div");
    d.className = "error-message";
    d.style.cssText =
      "position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#ef4444;color:#fff;padding:12px 20px;border-radius:8px;z-index:1000;max-width:90%;text-align:center;";
    d.textContent = msg;
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 5000);
    console.error("Recorder Error:", msg);
  }

  function showSuccessMessage(msg) {
    const ex = document.querySelector(".success-message");
    if (ex) ex.remove();
    const d = document.createElement("div");
    d.className = "success-message";
    d.style.cssText =
      "position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#10b981;color:#fff;padding:12px 24px;border-radius:8px;z-index:1000;max-width:90%;text-align:center;";
    d.textContent = msg;
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 3000);
  }

  function startTimer() {
    updateTimerDisplay();
    recordingTimer = setInterval(() => {
      recordingSeconds++;
      updateTimerDisplay();
    }, 1000);
  }

  function stopTimer() {
    if (recordingTimer) {
      clearInterval(recordingTimer);
      recordingTimer = null;
    }
  }

  function updateTimerDisplay() {
    const m = Math.floor(recordingSeconds / 60);
    const s = recordingSeconds % 60;
    if (recordingTimerElement)
      recordingTimerElement.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function showRecordingOverlay() {
    if (recordingStatusOverlay) {
      recordingStatusOverlay.classList.add("active");
      if (recordingStatusText) recordingStatusText.textContent = "Recording";
    }
  }

  function hideRecordingOverlay() {
    if (recordingStatusOverlay)
      recordingStatusOverlay.classList.remove("active", "paused");
  }

  function resetRecordingState() {
    isRecording = false;
    isPaused = false;
    isFinished = false;
    recordedChunks = [];
    recordingSeconds = 0;

    stopAllStreams();

    startButton.classList.remove("hidden");
    startButton.textContent = "⏺️ Start Recording";
    startButton.disabled = true;

    pauseButton.classList.add("hidden");
    resumeButton.classList.add("hidden");

    stopButton.disabled = true;
    stopButton.textContent = "⏹️ Finish";

    hideRecordingOverlay();

    if (videoPlayback) {
      if (videoPlayback.src) URL.revokeObjectURL(videoPlayback.src);
      videoPlayback.src = "";
      videoPlayback.classList.add("hidden");
    }
    if (videoPreview) videoPreview.classList.add("hidden");

    stopTimer();
    if (recordingTimerElement) recordingTimerElement.textContent = "00:00";
  }

  function stopAllStreams() {
    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => t.stop && t.stop());
      mediaStream = null;
    }
    if (videoPreview && videoPreview.srcObject) videoPreview.srcObject = null;
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      try {
        mediaRecorder.stop();
      } catch (e) {
        console.warn("mediaRecorder stop error (ignored)", e);
      }
    }
    mediaRecorder = null;
  }

  // ----- Media initialization -----
  async function initializeMedia() {
    if (mediaStream) stopAllStreams();

    const constraints = { video: { width: 640, height: 480, facingMode: "user" }, audio: true };
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      if (videoPreview) {
        videoPreview.srcObject = mediaStream;
        videoPreview.classList.remove("hidden");
      }
      startButton.disabled = false;
    } catch (err) {
      showError("Camera/mic access denied or not available.");
      console.error(err);
    }
  }

  // ----- Recording flow -----
  function startRecording(mode) {
    setupRecordingScreen(mode);
    showRecordingScreen();
    initializeMedia();
  }

  function setupRecordingScreen() {
    const icon = document.getElementById("recordingIcon");
    if (icon) icon.textContent = "🎥";
    const title = document.getElementById("recordingTypeTitle");
    if (title) title.textContent = "Video Recording";
  }

  function showRecordingScreen() {
    homeScreen.style.display = "none";
    recordingScreen.style.display = "block";
  }

  function goHome() {
    stopAllStreams();
    resetRecordingState();
    homeScreen.style.display = "flex";
    recordingScreen.style.display = "none";
  }

  async function toggleRecording() {
    if (!isRecording) startRecordingProcess();
    else if (isPaused) resumeRecording();
    else pauseRecording();
  }

  async function startRecordingProcess() {
    resetRecordingState();
    await initializeMedia();
    if (!mediaStream || !mediaStream.active) return showError("No active media stream.");

    const options = { mimeType: "video/webm; codecs=vp8" };
    try { mediaRecorder = new MediaRecorder(mediaStream, options); } 
    catch (err) { return showError("Recording not supported."); }

    recordedChunks = [];
    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) recordedChunks.push(e.data); };
    mediaRecorder.onstop = handleRecordingComplete;
    mediaRecorder.start(500);

    isRecording = true;
    isPaused = false;
    startButton.classList.add("hidden");
    pauseButton.classList.remove("hidden");
    stopButton.disabled = false;
    stopButton.textContent = "⏹️ Finish";
    stopButton.onclick = stopOrDownload;

    showRecordingOverlay();
    startTimer();
  }

  function pauseRecording() {
    if (mediaRecorder && isRecording) {
      mediaRecorder.pause();
      isPaused = true;
      pauseButton.classList.add("hidden");
      resumeButton.classList.remove("hidden");
      recordingStatusText.textContent = "Paused";
      recordingStatusOverlay.classList.add("paused");
      stopTimer();
    }
  }

  function resumeRecording() {
    if (mediaRecorder && isRecording) {
      mediaRecorder.resume();
      isPaused = false;
      resumeButton.classList.add("hidden");
      pauseButton.classList.remove("hidden");
      recordingStatusText.textContent = "Recording";
      recordingStatusOverlay.classList.remove("paused");
      startTimer();
    }
  }

  // ----- Finish / Download toggle -----
  function stopOrDownload() {
    if (!isFinished) {
      if (mediaRecorder && isRecording) mediaRecorder.stop();
      isRecording = false;
      isPaused = false;
      stopTimer();
      hideRecordingOverlay();

      pauseButton.classList.add("hidden");
      resumeButton.classList.add("hidden");

      // Change button to Download
      stopButton.textContent = "💾 Download A Copy!";
      stopButton.onclick = downloadRecording;
      isFinished = true;

      // Show playback
      if (videoPlayback && recordedChunks.length > 0) {
        const url = URL.createObjectURL(new Blob(recordedChunks, { type: "video/webm" }));
        videoPlayback.src = url;
        videoPlayback.classList.remove("hidden");
        videoPreview.classList.add("hidden");
      }

      // Record Again button
      startButton.classList.remove("hidden");
      startButton.textContent = "🔄 Record Again";
      startButton.disabled = false;
      startButton.onclick = startRecordingProcess;
    } else {
      downloadRecording();
    }
  }

  function handleRecordingComplete() {
    const blob = new Blob(recordedChunks, { type: "video/webm" });
    const url = URL.createObjectURL(blob);
    videoPreview.classList.add("hidden");
    videoPlayback.src = url;
    videoPlayback.classList.remove("hidden");
  }

  function downloadRecording() {
    if (!recordedChunks.length) return showError("No recording to download.");
    const blob = new Blob(recordedChunks, { type: "video/webm" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `video_recording_${new Date().toISOString().replace(/:/g, "-")}.webm`;
    a.click();
    showSuccessMessage("Recording downloaded");
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ----- Expose -----
  window.startRecording = startRecording;
  window.toggleRecording = toggleRecording;
  window.stopRecording = stopOrDownload;
  window.downloadRecording = downloadRecording;
  window.goHome = goHome;

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && recordingScreen.style.display === "block" && !isRecording)
      goHome();
    if (e.key === " " && recordingScreen.style.display === "block") {
      e.preventDefault();
      if (!startButton.disabled) toggleRecording();
    }
  });

  window.addEventListener("beforeunload", () => {
    stopAllStreams();
    stopTimer();
  });
})();
