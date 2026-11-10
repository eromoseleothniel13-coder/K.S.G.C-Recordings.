"use strict";

function waitForMediaEvent(mediaElement, eventName) {
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            mediaElement.removeEventListener(eventName, handleSuccess);
            mediaElement.removeEventListener("error", handleError);
        };
        const handleSuccess = () => {
            cleanup();
            resolve();
        };
        const handleError = () => {
            cleanup();
            reject(new Error("The selected recording could not be processed by this browser."));
        };

        mediaElement.addEventListener(eventName, handleSuccess, { once: true });
        mediaElement.addEventListener("error", handleError, { once: true });
    });
}

window.reduceRecordingNoise = async function(file, onProgress) {
    if (typeof onProgress !== "function") {
        throw new TypeError("A progress callback is required for noise reduction.");
    }

    const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass || !window.MediaRecorder) {
        throw new Error("Automatic noise reduction is not supported by this browser. Use a supported browser.");
    }

    const isVideo = file.type.startsWith("video/");
    const processingStage = isVideo
        ? "Reducing background noise from video..."
        : "Removing noise from audio...";
    const mediaElement = document.createElement(isVideo ? "video" : "audio");
    const objectUrl = URL.createObjectURL(file);
    const audioContext = new AudioContextClass();
    let mediaRecorder;
    let processedStream;
    let progressTimer;

    onProgress(processingStage, 0);
    mediaElement.preload = "auto";
    mediaElement.playsInline = true;
    mediaElement.muted = isVideo;
    const metadataLoaded = waitForMediaEvent(mediaElement, "loadedmetadata");
    mediaElement.src = objectUrl;

    try {
        await metadataLoaded;

        if (!Number.isFinite(mediaElement.duration) || mediaElement.duration <= 0) {
            throw new Error("The selected recording has no readable duration.");
        }

        const source = audioContext.createMediaElementSource(mediaElement);
        const highPass = audioContext.createBiquadFilter();
        const lowPass = audioContext.createBiquadFilter();
        const analyser = audioContext.createAnalyser();
        const noiseGate = audioContext.createGain();
        const compressor = audioContext.createDynamicsCompressor();
        const processedAudio = audioContext.createMediaStreamDestination();

        highPass.type = "highpass";
        highPass.frequency.value = 80;
        lowPass.type = "lowpass";
        lowPass.frequency.value = Math.min(10000, audioContext.sampleRate * 0.45);
        compressor.threshold.value = -38;
        compressor.knee.value = 24;
        compressor.ratio.value = 8;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.25;
        analyser.fftSize = 512;
        noiseGate.gain.value = 1;

        source.connect(highPass);
        highPass.connect(lowPass);
        lowPass.connect(analyser);
        analyser.connect(noiseGate);
        noiseGate.connect(compressor);
        compressor.connect(processedAudio);

        const tracks = [...processedAudio.stream.getAudioTracks()];

        if (isVideo) {
            const captureVideo =
                mediaElement.captureStream || mediaElement.mozCaptureStream;

            if (!captureVideo) {
                throw new Error("This browser cannot preserve video while reducing its audio noise. Use a supported browser.");
            }

            const videoStream = captureVideo.call(mediaElement);
            tracks.push(...videoStream.getVideoTracks());
        }

        processedStream = new MediaStream(tracks);
        const mimeTypes = isVideo
            ? ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
            : ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm"];
        const mimeType = mimeTypes.find(type =>
            MediaRecorder.isTypeSupported(type)
        );

        mediaRecorder = mimeType
            ? new MediaRecorder(processedStream, { mimeType })
            : new MediaRecorder(processedStream);

        const chunks = [];
        const recordingComplete = new Promise((resolve, reject) => {
            mediaRecorder.addEventListener("dataavailable", event => {
                if (event.data.size > 0) {
                    chunks.push(event.data);
                }
            });
            mediaRecorder.addEventListener("error", () => {
                reject(new Error("The browser could not encode the noise-reduced recording."));
            }, { once: true });
            mediaRecorder.addEventListener("stop", () => {
                resolve(new Blob(chunks, {
                    type: mediaRecorder.mimeType || (isVideo ? "video/webm" : "audio/webm")
                }));
            }, { once: true });
        });

        recordingComplete.catch(() => {});
        await audioContext.resume();
        mediaRecorder.start(1000);

        const audioSamples = new Float32Array(analyser.fftSize);
        let noiseGateClosed = false;
        let lastProgressUpdate = 0;
        progressTimer = window.setInterval(() => {
            analyser.getFloatTimeDomainData(audioSamples);
            const meanSquare =
                audioSamples.reduce((sum, sample) => sum + sample * sample, 0) /
                audioSamples.length;
            const level = Math.sqrt(meanSquare);

            if (level < 0.008) {
                noiseGateClosed = true;
            } else if (level > 0.014) {
                noiseGateClosed = false;
            }

            noiseGate.gain.setTargetAtTime(
                noiseGateClosed ? 0.12 : 1,
                audioContext.currentTime,
                0.03
            );

            if (Date.now() - lastProgressUpdate >= 250) {
                onProgress(
                    processingStage,
                    (mediaElement.currentTime / mediaElement.duration) * 100
                );
                lastProgressUpdate = Date.now();
            }
        }, 50);
        onProgress(processingStage, 0);

        let playbackEnded;
        try {
            playbackEnded = waitForMediaEvent(mediaElement, "ended");
            await mediaElement.play();
            await playbackEnded;
        } catch (error) {
            if (playbackEnded) {
                await playbackEnded.catch(() => {});
            }
            if (mediaRecorder.state !== "inactive") {
                mediaRecorder.stop();
            }
            await recordingComplete.catch(() => {});
            throw error;
        }

        window.clearInterval(progressTimer);
        progressTimer = null;
        onProgress("Noise reduction complete. Preparing upload...", 100);

        if (mediaRecorder.state !== "inactive") {
            mediaRecorder.stop();
        }

        const processedBlob = await recordingComplete;
        const extension = processedBlob.type.includes("ogg") ? ".ogg" : ".webm";
        const outputName = file.name.replace(/\.[^.]+$/, "") + extension;

        return new File([processedBlob], outputName, {
            type: processedBlob.type,
            lastModified: Date.now()
        });
    } finally {
        if (progressTimer) {
            window.clearInterval(progressTimer);
        }
        if (processedStream) {
            processedStream.getTracks().forEach(track => track.stop());
        }
        mediaElement.pause();
        mediaElement.removeAttribute("src");
        URL.revokeObjectURL(objectUrl);
        await audioContext.close();
    }
};
