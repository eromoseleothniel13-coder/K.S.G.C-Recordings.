/* =========================================================
   K.S.G.C RECORDINGS - PUBLIC WEBSITE
   ========================================================= */

let loadedPublicRecordings = [];
let publicRecordingPage = 0;
let playerReturnFocus = null;
let playerAudioContext = null;
let playerAnimationFrame = 0;

const PUBLIC_RECORDINGS_PER_PAGE = 4;

function addPasswordVisibilityToggles(root = document) {

    root.querySelectorAll('input[type="password"]').forEach(function(input) {

        if (input.parentElement.classList.contains("password-visibility-wrap")) {
            return;
        }

        const wrapper = document.createElement("div");
        wrapper.className = "password-visibility-wrap";
        input.parentNode.insertBefore(wrapper, input);
        wrapper.appendChild(input);

        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "password-visibility-toggle";
        toggle.textContent = "Show";
        toggle.setAttribute("aria-label", "Show password");
        toggle.setAttribute("aria-pressed", "false");

        toggle.addEventListener("click", function() {
            const isVisible = input.type === "text";
            input.type = isVisible ? "password" : "text";
            toggle.textContent = isVisible ? "Show" : "Hide";
            toggle.setAttribute(
                "aria-label",
                isVisible ? "Show password" : "Hide password"
            );
            toggle.setAttribute("aria-pressed", String(!isVisible));
        });

        wrapper.appendChild(toggle);
    });
}

addPasswordVisibilityToggles();


/* =========================================================
   SCROLL TO RECORDINGS
   ========================================================= */

function scrollToRecordings() {

    const recordingsSection =
        document.getElementById("recordings");

    if (recordingsSection) {

        recordingsSection.scrollIntoView({
            behavior: "smooth"
        });

    }

}

function initializeHeroVideoBackground() {
    const canvas = document.querySelector(".hero-video-background");

    if (!canvas) {
        return;
    }

    const context = canvas.getContext("2d");

    if (!context) {
        console.error("Could not initialize the home page background animation.");
        return;
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const particles = Array.from({ length: 42 }, (_, index) => ({
        x: ((index * 67.7) % 100) / 100,
        y: ((index * 39.1) % 100) / 100,
        radius: 0.6 + ((index * 13) % 10) / 10,
        speed: 0.012 + ((index * 7) % 10) / 1000,
        phase: index * 1.7
    }));
    let width = 0;
    let height = 0;
    let animationFrame = 0;

    function resizeCanvas() {
        const bounds = canvas.getBoundingClientRect();
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

        width = bounds.width;
        height = bounds.height;
        canvas.width = Math.round(width * pixelRatio);
        canvas.height = Math.round(height * pixelRatio);
        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        drawBackground(0);
    }

    function drawBackground(timestamp) {
        const time = reducedMotion.matches ? 0 : timestamp / 1000;
        const gradient = context.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, "#06172a");
        gradient.addColorStop(0.52, "#0b2d4d");
        gradient.addColorStop(1, "#071b33");
        context.fillStyle = gradient;
        context.fillRect(0, 0, width, height);

        const glowPoints = [
            { x: 0.2 + Math.sin(time * 0.22) * 0.12, y: 0.18, color: "77, 169, 224" },
            { x: 0.78 + Math.sin(time * 0.17 + 1.8) * 0.12, y: 0.16, color: "242, 201, 76" },
            { x: 0.5 + Math.cos(time * 0.14) * 0.16, y: 0.08, color: "121, 183, 226" }
        ];

        glowPoints.forEach(point => {
            const x = point.x * width;
            const y = point.y * height;
            const glow = context.createRadialGradient(x, y, 0, x, y, width * 0.42);
            glow.addColorStop(0, `rgba(${point.color}, 0.2)`);
            glow.addColorStop(1, `rgba(${point.color}, 0)`);
            context.fillStyle = glow;
            context.fillRect(0, 0, width, height);
        });

        for (let index = 0; index < 3; index += 1) {
            const phase = time * 0.18 + index * 2.2;
            const sourceX = width * (0.18 + index * 0.32 + Math.sin(phase) * 0.1);
            const targetX = sourceX + Math.sin(phase + 0.8) * width * 0.22;
            const beam = context.createLinearGradient(sourceX, 0, targetX, height);
            beam.addColorStop(0, index === 1
                ? "rgba(242, 201, 76, 0.16)"
                : "rgba(133, 196, 238, 0.15)");
            beam.addColorStop(1, "rgba(133, 196, 238, 0)");
            context.beginPath();
            context.moveTo(sourceX - width * 0.035, 0);
            context.lineTo(sourceX + width * 0.035, 0);
            context.lineTo(targetX + width * 0.2, height);
            context.lineTo(targetX - width * 0.2, height);
            context.closePath();
            context.fillStyle = beam;
            context.fill();
        }

        particles.forEach(particle => {
            const drift = reducedMotion.matches ? 0 : time * particle.speed;
            const x = ((particle.x + drift) % 1) * width;
            const y = (particle.y + Math.sin(time * 0.35 + particle.phase) * 0.035) * height;
            const opacity = 0.18 + (Math.sin(time * 0.8 + particle.phase) + 1) * 0.16;
            context.beginPath();
            context.arc(x, y, particle.radius, 0, Math.PI * 2);
            context.fillStyle = `rgba(255, 239, 190, ${opacity})`;
            context.fill();
        });
    }

    function animate(timestamp) {
        drawBackground(timestamp);
        animationFrame = window.requestAnimationFrame(animate);
    }

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    reducedMotion.addEventListener("change", resizeCanvas);
    document.addEventListener("visibilitychange", function() {
        if (document.hidden) {
            window.cancelAnimationFrame(animationFrame);
        } else if (!reducedMotion.matches) {
            animationFrame = window.requestAnimationFrame(animate);
        }
    });

    if (!reducedMotion.matches) {
        animationFrame = window.requestAnimationFrame(animate);
    }
}


/* =========================================================
   LOAD RECORDINGS
   ========================================================= */

async function loadPublicRecordings() {

    const recordingGrid =
        document.getElementById("recordingGrid");

    if (!recordingGrid) {
        return;
    }


    try {

        const response =
            await fetch("/api/recordings");


        if (!response.ok) {

            throw new Error(
                "Unable to load recordings."
            );

        }


        const data =
            await response.json();


        const recordings =
            Array.isArray(data)
                ? data
                : data.recordings || [];

        loadedPublicRecordings = recordings;

        displayPublicRecordings(recordings);

        const sharedRecordingId =
            new URLSearchParams(window.location.search).get("recording");

        if (sharedRecordingId) {
            const sharedRecording = recordings.find(function(recording) {
                return String(recording.id) === sharedRecordingId;
            });

            if (sharedRecording) {
                openRecording(sharedRecordingId);
            } else {
                setShareStatus("This recording link could not be found.");
            }
        }


    } catch (error) {

        console.error(
            "Error loading recordings:",
            error
        );


        recordingGrid.innerHTML = `

            <div class="empty-recordings">

                <div class="empty-icon">
                    ⚠️
                </div>

                <h3>
                    Unable to Load Recordings
                </h3>

                <p>
                    Please make sure the K.S.G.C Recordings
                    server is running and try again.
                </p>

            </div>

        `;

    }

}


/* =========================================================
   DISPLAY RECORDINGS
   ========================================================= */

function displayPublicRecordings(recordings) {

    const recordingGrid =
        document.getElementById("recordingGrid");

    const searchInput =
        document.getElementById("searchPublicRecordings");

    const sortSelect =
        document.getElementById("sortPublicRecordings");

    const pagination =
        document.getElementById("recordingPagination");

    const previousButton =
        document.getElementById("previousRecordings");

    const nextButton =
        document.getElementById("nextRecordings");

    const pageInfo =
        document.getElementById("recordingPageInfo");


    if (!recordingGrid) {
        return;
    }

    const searchTerm =
        searchInput
            ? searchInput.value.trim().toLocaleLowerCase()
            : "";

    const matchingRecordings =
        Array.isArray(recordings)
            ? recordings.filter(function(recording) {
                return String(recording.title || "")
                    .toLocaleLowerCase()
                    .includes(searchTerm);
            })
            : [];

    if (
        Array.isArray(recordings) &&
        recordings.length > 0 &&
        matchingRecordings.length === 0
    ) {
        if (pagination) {
            pagination.hidden = true;
        }

        recordingGrid.innerHTML = `
            <div class="empty-recordings">
                <div class="empty-icon">⌕</div>
                <h3>No matching messages</h3>
                <p>Try another message name.</p>
            </div>
        `;
        return;
    }


    if (
        !Array.isArray(recordings) ||
        recordings.length === 0
    ) {
        if (pagination) {
            pagination.hidden = true;
        }

        recordingGrid.innerHTML = `

            <div class="empty-recordings">

                <div class="empty-icon">
                    🎥
                </div>

                <h3>
                    No Recordings Available Yet
                </h3>

                <p>
                    New K.S.G.C recordings will appear
                    here when they are uploaded from
                    the Admin Portal.
                </p>

            </div>

        `;

        return;

    }


    const sortOrder =
        sortSelect ? sortSelect.value : "recent";

    matchingRecordings.sort(function(a, b) {

        if (sortOrder === "name") {
            return String(a.title || "K.S.G.C Recording")
                .localeCompare(
                    String(b.title || "K.S.G.C Recording"),
                    undefined,
                    { sensitivity: "base" }
                );
        }

        const dateA = getRecordingTimestamp(a);
        const dateB = getRecordingTimestamp(b);

        if (Number.isNaN(dateA)) {
            return Number.isNaN(dateB) ? 0 : 1;
        }

        if (Number.isNaN(dateB)) {
            return -1;
        }

        return sortOrder === "oldest"
            ? dateA - dateB
            : dateB - dateA;

    });

    const pageCount =
        Math.ceil(matchingRecordings.length / PUBLIC_RECORDINGS_PER_PAGE);

    publicRecordingPage =
        Math.min(publicRecordingPage, pageCount - 1);

    const startIndex =
        publicRecordingPage * PUBLIC_RECORDINGS_PER_PAGE;

    const visibleRecordings =
        matchingRecordings.slice(
            startIndex,
            startIndex + PUBLIC_RECORDINGS_PER_PAGE
        );

    if (pagination && previousButton && nextButton && pageInfo) {
        pagination.hidden = pageCount <= 1;
        previousButton.disabled = publicRecordingPage === 0;
        nextButton.disabled = publicRecordingPage >= pageCount - 1;
        pageInfo.textContent =
            `${startIndex + 1}-${Math.min(startIndex + PUBLIC_RECORDINGS_PER_PAGE, matchingRecordings.length)} of ${matchingRecordings.length}`;
    }


    recordingGrid.innerHTML =
        visibleRecordings.map(function(recording, visibleIndex) {

            const title =
                escapeHtml(
                    recording.title ||
                    "K.S.G.C Recording"
                );

            const recordingId =
                escapeHtml(recording.id);

            const titleId =
                `recordingTitle-${startIndex + visibleIndex}`;


            const description =
                escapeHtml(
                    recording.description ||
                    ""
                );


            const date =
                escapeHtml(
                    formatRecordingDate(recording.date)
                );

            const speakerName =
                escapeHtml(recording.speakerName || "");


            const type =
                getRecordingType(recording);


            const thumbnailUrl =
                recording.thumbnailUrl ||
                "";


            const thumbnail =
                thumbnailUrl

                ? `

                    <img
                        src="${thumbnailUrl}"
                        alt=""
                        loading="lazy"
                    >

                  `

                : `

                    <div class="thumbnail-placeholder">
                        ▶
                    </div>

                  `;


            return `

                <article
                    class="recording-card"
                    data-recording-id="${recordingId}"
                    aria-labelledby="${titleId}"
                >

                    <div class="thumbnail">
                        ${thumbnail}
                    </div>


                    <div class="card-content">

                        <h3 id="${titleId}">
                            ${title}
                        </h3>


                        <p>
                            ${type}
                            ${
                                date
                                    ? ` • ${date}`
                                    : ""
                            }
                        </p>

                        ${
                            speakerName
                                ? `<p class="recording-speaker">Speaker: ${speakerName}</p>`
                                : ""
                        }

                        ${
                            description

                            ? `
                                <p>
                                    ${description}
                                </p>
                              `

                            : ""
                        }


                        <button
                            type="button"
                            class="open-recording-button"
                            data-open-recording
                            aria-label="${type === "Audio" ? "Listen to" : "Watch"} ${title}"
                        >

                            ${
                                type === "Audio"
                                    ? "Listen"
                                    : "Watch"
                            }

                        </button>

                        <button
                            type="button"
                            class="share-recording-button"
                            data-share-recording
                            aria-label="Share ${title}"
                        >
                            Share
                        </button>

                    </div>

                </article>

            `;

        }).join("");

}


function initializeRecordingActions() {
    const recordingGrid = document.getElementById("recordingGrid");

    if (!recordingGrid) {
        return;
    }

    recordingGrid.addEventListener("click", function(event) {
        const button = event.target.closest("button");
        const card = button && button.closest("[data-recording-id]");

        if (!button || !card) {
            return;
        }

        const recording = loadedPublicRecordings.find(function(item) {
            return String(item.id) === card.dataset.recordingId;
        });

        if (!recording) {
            setShareStatus("This recording could not be found. Refresh the page and try again.");
            return;
        }

        if (button.hasAttribute("data-open-recording")) {
            openRecording(recording.id);
        } else if (button.hasAttribute("data-share-recording")) {
            shareRecording(recording);
        }
    });
}


let shareStatusTimeout;

function setShareStatus(message) {
    const status = document.getElementById("shareStatus");

    if (!status) {
        return;
    }

    status.textContent = message;
    status.hidden = false;
    window.clearTimeout(shareStatusTimeout);
    shareStatusTimeout = window.setTimeout(function() {
        status.hidden = true;
        status.textContent = "";
    }, 5000);
}


async function shareRecording(recording) {
    const shareUrl = new URL(window.location.pathname, window.location.origin);
    shareUrl.searchParams.set("recording", recording.id);
    const title = recording.title || "K.S.G.C Recording";

    if (navigator.share) {
        try {
            await navigator.share({
                title,
                text: `Listen to ${title} from K.S.G.C Recordings.`,
                url: shareUrl.href
            });
            setShareStatus("Recording link shared.");
            return;
        } catch (error) {
            if (error.name === "AbortError") {
                return;
            }
        }
    }

    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(shareUrl.href);
        } else {
            const linkInput = document.createElement("textarea");
            linkInput.value = shareUrl.href;
            linkInput.setAttribute("readonly", "");
            linkInput.style.position = "fixed";
            linkInput.style.opacity = "0";
            document.body.appendChild(linkInput);
            linkInput.select();

            let copied = false;
            try {
                copied = document.execCommand("copy");
            } finally {
                linkInput.remove();
            }

            if (!copied) {
                throw new Error("Copy command was not available.");
            }
        }

        setShareStatus("Recording link copied to clipboard.");
    } catch (error) {
        setShareStatus("Unable to copy the recording link. Check your browser permissions and try again.");
    }
}


function getRecordingTimestamp(recording) {

    const value =
        recording.date ||
        recording.createdAt ||
        "";

    const dateParts =
        /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));

    const date = dateParts
        ? new Date(
            Number(dateParts[1]),
            Number(dateParts[2]) - 1,
            Number(dateParts[3])
        )
        : new Date(value);

    return date.getTime();

}


function formatRecordingDate(value) {

    if (!value) {
        return "";
    }

    const dateParts =
        /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));

    const date = dateParts
        ? new Date(
            Number(dateParts[1]),
            Number(dateParts[2]) - 1,
            Number(dateParts[3])
        )
        : new Date(value);

    if (Number.isNaN(date.getTime())) {
        return String(value);
    }

    return date.toLocaleDateString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric"
    });

}


/* =========================================================
   GET RECORDING TYPE
   ========================================================= */

function getRecordingType(recording) {

    const mimeType =
        recording.type ||
        "";


    if (
        mimeType.startsWith("audio/")
    ) {

        return "Audio";

    }


    if (
        mimeType.startsWith("video/")
    ) {

        return "Video";

    }


    const file =
        recording.recordingUrl ||
        recording.recording ||
        recording.file ||
        "";


    const extension =
        file
            .split(".")
            .pop()
            .toLowerCase();


    const audioExtensions = [

        "mp3",
        "wav",
        "m4a",
        "aac",
        "ogg",
        "flac"

    ];


    if (
        audioExtensions.includes(extension)
    ) {

        return "Audio";

    }


    return "Video";

}


/* =========================================================
   OPEN RECORDING
   ========================================================= */

function openRecording(id) {

    const recording =
        loadedPublicRecordings.find(function(item) {
            return String(item.id) === String(id);
        });

    if (!recording) {
        alert("Recording could not be found. Refresh the page and try again.");
        return;
    }

    requestRecordingUnlock(recording);

}


function requestRecordingUnlock(recording) {
    const returnFocus = document.activeElement;

    const existingDialog =
        document.getElementById("recordingUnlockOverlay");

    if (existingDialog) {
        existingDialog.remove();
    }

    const title =
        recording.title || "K.S.G.C Recording";

    const dialog =
        document.createElement("div");

    dialog.id = "recordingUnlockOverlay";
    dialog.className = "recording-unlock-overlay";
    dialog.innerHTML = `
        <section
            class="recording-unlock-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="recordingUnlockTitle"
        >
            <button
                type="button"
                class="recording-unlock-close"
                aria-label="Close password dialog"
            >×</button>
            <div class="recording-unlock-icon" aria-hidden="true">🔒</div>
            <p class="recording-unlock-label">PASSWORD PROTECTED</p>
            <h2 id="recordingUnlockTitle">${escapeHtml(title)}</h2>
            <p class="recording-unlock-description">
                Enter the current password to play this recording.
            </p>
            <form class="recording-unlock-form">
                <label for="recordingAccessPassword">Recording password</label>
                <input
                    id="recordingAccessPassword"
                    name="password"
                    type="password"
                    inputmode="numeric"
                    autocomplete="one-time-code"
                    maxlength="8"
                    required
                >
                <p class="recording-unlock-error" role="alert" hidden></p>
                <button class="recording-unlock-submit" type="submit">
                    Unlock recording
                </button>
            </form>
            <p class="recording-unlock-help">
                Need the current password?
                <a
                    href="https://wa.me/2349030199016?text=${encodeURIComponent(`Hello, please send me the current password for "${title}".`)}"
                    target="_blank"
                    rel="noopener noreferrer"
                >Chat with us on WhatsApp</a>
            </p>
        </section>
    `;

    document.body.appendChild(dialog);
    addPasswordVisibilityToggles(dialog);

    const form =
        dialog.querySelector(".recording-unlock-form");

    const passwordInput =
        dialog.querySelector("#recordingAccessPassword");

    const errorMessage =
        dialog.querySelector(".recording-unlock-error");

    const submitButton =
        dialog.querySelector(".recording-unlock-submit");

    function closeDialog() {
        dialog.remove();
        document.removeEventListener("keydown", handleEscape);

        if (returnFocus && typeof returnFocus.focus === "function" && returnFocus.isConnected) {
            returnFocus.focus();
        }
    }

    function handleEscape(event) {
        if (event.key === "Escape") {
            closeDialog();
            return;
        }

        if (event.key === "Tab") {
            const focusableElements = Array.from(dialog.querySelectorAll(
                'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
            ));
            const firstElement = focusableElements[0];
            const lastElement = focusableElements[focusableElements.length - 1];

            if (event.shiftKey && document.activeElement === firstElement) {
                event.preventDefault();
                lastElement.focus();
            } else if (!event.shiftKey && document.activeElement === lastElement) {
                event.preventDefault();
                firstElement.focus();
            }
        }
    }

    dialog.querySelector(".recording-unlock-close")
        .addEventListener("click", closeDialog);

    dialog.addEventListener("click", function(event) {
        if (event.target === dialog) {
            closeDialog();
        }
    });

    document.addEventListener("keydown", handleEscape);

    form.addEventListener("submit", async function(event) {

        event.preventDefault();
        errorMessage.hidden = true;
        submitButton.disabled = true;
        submitButton.textContent = "Checking password...";

        try {

            const response = await fetch(
                `/api/recordings/${encodeURIComponent(recording.id)}/unlock`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        password: passwordInput.value
                    })
                }
            );

            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(
                    result.message || "Unable to unlock this recording."
                );
            }

            closeDialog();

            openPlayer(
                `/api/recordings/${encodeURIComponent(recording.id)}/media`,
                title,
                getRecordingType(recording),
                recording.thumbnailUrl || ""
            );

        } catch (error) {

            errorMessage.textContent =
                error.message || "Unable to unlock this recording.";
            errorMessage.hidden = false;
            submitButton.disabled = false;
            submitButton.textContent = "Unlock recording";

        }

    });

    passwordInput.focus();

}


/* =========================================================
   OPEN PLAYER
   ========================================================= */

function openPlayer(
    file,
    title,
    type,
    thumbnailUrl = ""
) {
    playerReturnFocus = document.activeElement;

    const existingPlayer =
        document.getElementById(
            "recordingPlayerOverlay"
        );


    if (existingPlayer) {
        window.cancelAnimationFrame(playerAnimationFrame);
        if (playerAudioContext) {
            playerAudioContext.close().catch(error => {
                console.error("Could not close the previous audio player context:", error);
            });
            playerAudioContext = null;
        }
        existingPlayer.remove();
    }


    const overlay =
        document.createElement("div");


    overlay.id =
        "recordingPlayerOverlay";


    overlay.innerHTML = `

        <div class="recording-player-overlay">

            <div
                class="recording-player-box"
                role="dialog"
                aria-modal="true"
                aria-labelledby="recordingPlayerTitle"
                tabindex="-1"
            >


                <div class="recording-player-header">

                    <h2 id="recordingPlayerTitle">
                        ${escapeHtml(title)}
                    </h2>


                    <button
                        type="button"
                        class="recording-player-close"
                        aria-label="Close recording player"
                        onclick="closePlayer()"
                    >
                        ✕
                    </button>

                </div>


                <div class="recording-player-content">


                    ${
                        type === "Audio"

                        ? `

                            <div class="recording-audio-stage">
                                <div class="audio-bubble-field" aria-hidden="true">
                                    <span class="audio-bubble"></span>
                                    <span class="audio-bubble"></span>
                                    <span class="audio-bubble"></span>
                                    <span class="audio-bubble"></span>
                                    <span class="audio-bubble"></span>
                                    <span class="audio-bubble"></span>
                                    <span class="audio-bubble"></span>
                                    <span class="audio-bubble"></span>
                                    <span class="audio-bubble"></span>
                                    <span class="audio-bubble"></span>
                                    <span class="audio-bubble"></span>
                                    <span class="audio-bubble"></span>
                                </div>
                                <div class="audio-disc-turntable">
                                    <div class="audio-disc">
                                        <div class="audio-disc-label">
                                            ${thumbnailUrl
                                                ? `<img src="${escapeHtml(thumbnailUrl)}" alt="" class="audio-disc-thumbnail">`
                                                : `<span class="audio-disc-placeholder">K.S.G.C</span>`
                                            }
                                        </div>
                                        <span class="audio-disc-center" aria-hidden="true"></span>
                                    </div>
                                </div>
                                <div class="audio-voice-visualizer" aria-hidden="true">
                                    ${Array.from({ length: 32 }, () => '<span class="audio-voice-bar"></span>').join("")}
                                </div>
                                <audio
                                    controls
                                    autoplay
                                    controlsList="nodownload noplaybackrate"
                                    oncontextmenu="return false"
                                    class="recording-audio-player"
                                >
                                    <source src="${file}">
                                    Your browser cannot play this audio file.
                                </audio>
                            </div>

                          `

                        : `

                            <video
                                controls
                                autoplay
                                playsinline
                                preload="metadata"
                                controlsList="nodownload noplaybackrate"
                                disablepictureinpicture
                                disableremoteplayback
                                oncontextmenu="return false"
                                class="recording-video-player"
                            >

                                <source
                                    src="${file}"
                                >

                                Your browser cannot
                                play this video file.

                            </video>

                          `

                    }


                </div>

            </div>

        </div>

    `;


    document.body.appendChild(overlay);
    overlay.querySelector(".recording-player-close").focus();

    const audio = overlay.querySelector(".recording-audio-player");
    if (audio) {
        initializeAudioVisualization(audio, overlay);
    }


    overlay.addEventListener(
        "click",
        function(event) {

            const background =
                overlay.querySelector(
                    ".recording-player-overlay"
                );


            if (
                event.target === background
            ) {

                closePlayer();

            }

        }
    );


    document.addEventListener(
        "keydown",
        playerEscapeHandler
    );

}


function initializeAudioVisualization(audio, overlay) {
    const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;
    const bars =
        Array.from(overlay.querySelectorAll(".audio-voice-bar"));
    let analyser;
    let frequencyData;
    let timeDomainData;

    function renderVoiceLevel() {
        if (!analyser || audio.paused || audio.ended) {
            return;
        }

        analyser.getByteFrequencyData(frequencyData);
        analyser.getFloatTimeDomainData(timeDomainData);
        const maxBin =
            Math.max(2, Math.floor(frequencyData.length * 0.72));
        const meanSquare = timeDomainData.reduce(
            (total, sample) => total + sample * sample,
            0
        ) / timeDomainData.length;
        const voiceLevel = Math.sqrt(meanSquare);
        const isQuiet = audio.muted || audio.volume === 0 || voiceLevel < 0.012;

        bars.forEach((bar, index) => {
            const start =
                Math.floor(Math.pow(index / bars.length, 2) * maxBin);
            const end = Math.max(
                start + 1,
                Math.floor(Math.pow((index + 1) / bars.length, 2) * maxBin)
            );
            let total = 0;

            for (let bin = start; bin < end; bin += 1) {
                total += frequencyData[bin];
            }

            const average = total / (end - start);
            const level = isQuiet
                ? 0
                : Math.max(0, Math.min(1, (average - 12) / 120)) *
                  Math.min(1, (voiceLevel - 0.012) * 12);

            bar.style.setProperty(
                "--voice-level",
                String(0.06 + level * (0.16 + ((index * 17) % 7) / 100) * 5)
            );
            bar.style.opacity = isQuiet
                ? "0.35"
                : String(0.4 + level * 0.6);
        });

        playerAnimationFrame =
            window.requestAnimationFrame(renderVoiceLevel);
    }

    audio.addEventListener("play", async function() {
        const disc = overlay.querySelector(".audio-disc");
        const visualizer =
            overlay.querySelector(".audio-voice-visualizer");

        if (disc) {
            disc.classList.add("is-spinning");
        }
        if (visualizer) {
            visualizer.classList.add("is-active");
        }

        if (!AudioContextClass) {
            console.error("Audio visualization is not supported by this browser.");
            return;
        }

        try {
            if (!playerAudioContext) {
                playerAudioContext = new AudioContextClass();
                analyser = playerAudioContext.createAnalyser();
                analyser.fftSize = 256;
                analyser.smoothingTimeConstant = 0.72;
                frequencyData =
                    new Uint8Array(analyser.frequencyBinCount);
                timeDomainData =
                    new Float32Array(analyser.fftSize);

                const source =
                    playerAudioContext.createMediaElementSource(audio);
                source.connect(analyser);
                analyser.connect(playerAudioContext.destination);
            } else if (!analyser) {
                throw new Error("Audio visualizer could not be initialized.");
            }

            await playerAudioContext.resume();
            window.cancelAnimationFrame(playerAnimationFrame);
            renderVoiceLevel();
        } catch (error) {
            console.error("Could not start audio visualization:", error);
        }
    });

    audio.addEventListener("pause", function() {
        const disc = overlay.querySelector(".audio-disc");
        const visualizer =
            overlay.querySelector(".audio-voice-visualizer");

        if (disc) {
            disc.classList.remove("is-spinning");
        }
        if (visualizer) {
            visualizer.classList.remove("is-active");
        }

        window.cancelAnimationFrame(playerAnimationFrame);
        bars.forEach(bar => {
            bar.style.setProperty("--voice-level", "0.06");
            bar.style.opacity = "0.35";
        });
    });

    audio.addEventListener("ended", function() {
        window.cancelAnimationFrame(playerAnimationFrame);
    });
}


/* =========================================================
   CLOSE PLAYER
   ========================================================= */

function closePlayer() {

    const player =
        document.getElementById(
            "recordingPlayerOverlay"
        );


    if (player) {

        window.cancelAnimationFrame(playerAnimationFrame);
        if (playerAudioContext) {
            playerAudioContext.close().catch(error => {
                console.error("Could not close the audio player context:", error);
            });
            playerAudioContext = null;
        }

        player.remove();

    }

    if (
        playerReturnFocus &&
        playerReturnFocus.isConnected &&
        typeof playerReturnFocus.focus === "function"
    ) {
        playerReturnFocus.focus();
    }


    document.removeEventListener(
        "keydown",
        playerEscapeHandler
    );

}


/* =========================================================
   ESCAPE KEY
   ========================================================= */

function playerEscapeHandler(event) {

    if (event.key === "Escape") {

        closePlayer();

        return;
    }

    if (event.key === "Tab") {
        const player = document.getElementById("recordingPlayerOverlay");

        if (!player) {
            return;
        }

        const focusableElements = Array.from(player.querySelectorAll(
            'button:not([disabled]), input:not([disabled]), audio[controls], video[controls], [tabindex]:not([tabindex="-1"])'
        ));
        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (event.shiftKey && document.activeElement === firstElement) {
            event.preventDefault();
            lastElement.focus();
        } else if (!event.shiftKey && document.activeElement === lastElement) {
            event.preventDefault();
            firstElement.focus();
        }

    }

}


/* =========================================================
   ESCAPE HTML
   ========================================================= */

function escapeHtml(value) {

    return String(value)

        .replace(
            /&/g,
            "&amp;"
        )

        .replace(
            /</g,
            "&lt;"
        )

        .replace(
            />/g,
            "&gt;"
        )

        .replace(
            /"/g,
            "&quot;"
        )

        .replace(
            /'/g,
            "&#039;"
        );

}


/* =========================================================
   INITIAL LOAD
   ========================================================= */

document.addEventListener(
    "DOMContentLoaded",
    function() {

        initializeHeroVideoBackground();
        initializeOfflineOverlay();
        initializeScrollReveal();
        initializePublicRecordingSearch();
        initializeRecordingActions();
        loadPublicRecordings();

    }
);


function initializePublicRecordingSearch() {

    const searchInput =
        document.getElementById("searchPublicRecordings");

    if (searchInput) {
        searchInput.addEventListener("input", function() {
            publicRecordingPage = 0;
            displayPublicRecordings(loadedPublicRecordings);
        });
    }

    const sortSelect =
        document.getElementById("sortPublicRecordings");

    if (sortSelect) {
        sortSelect.addEventListener("change", function() {
            publicRecordingPage = 0;
            displayPublicRecordings(loadedPublicRecordings);
        });
    }

    const previousButton =
        document.getElementById("previousRecordings");

    if (previousButton) {
        previousButton.addEventListener("click", function() {
            if (publicRecordingPage > 0) {
                publicRecordingPage -= 1;
                displayPublicRecordings(loadedPublicRecordings);
            }
        });
    }

    const nextButton =
        document.getElementById("nextRecordings");

    if (nextButton) {
        nextButton.addEventListener("click", function() {
            publicRecordingPage += 1;
            displayPublicRecordings(loadedPublicRecordings);
        });
    }

}


function initializeScrollReveal() {

    if (
        window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
        !("IntersectionObserver" in window)
    ) {
        return;
    }


    const revealSelector =
        "main > section, main > .login-card, .dashboard-stats > .stat-card, .recording-card, .management-card, footer";

    const observer =
        new IntersectionObserver(
            function(entries) {

                entries.forEach(function(entry) {

                    if (entry.isIntersecting) {
                        entry.target.classList.add("is-visible");
                        observer.unobserve(entry.target);
                    }

                });

            },
            {
                threshold: 0
            }
        );

    function observeRevealElements(root) {

        if (
            root.nodeType === Node.ELEMENT_NODE &&
            root.matches(revealSelector) &&
            !root.classList.contains("scroll-reveal")
        ) {
            root.classList.add("scroll-reveal");
            observer.observe(root);
        }

        if (root.querySelectorAll) {
            root.querySelectorAll(revealSelector).forEach(function(element) {

                if (!element.classList.contains("scroll-reveal")) {
                    element.classList.add("scroll-reveal");
                    observer.observe(element);
                }

            });
        }

    }

    observeRevealElements(document.body);
    document.body.classList.add("scroll-reveal-ready");

    const mutations =
        new MutationObserver(function(records) {

            records.forEach(function(record) {
                record.addedNodes.forEach(observeRevealElements);
            });

        });

    mutations.observe(document.body, {
        childList: true,
        subtree: true
    });

}


function initializeOfflineOverlay() {

    const overlay = document.createElement("div");
    overlay.className = "offline-overlay";
    overlay.hidden = navigator.onLine;
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-live", "polite");
    overlay.innerHTML = `
        <div class="offline-message">
            <div class="offline-spinner" aria-hidden="true"></div>
            <span class="offline-eyebrow">CONNECTION STATUS</span>
            <h2 class="offline-title">Connection lost</h2>
            <p class="offline-description">
                Check your Wi-Fi or mobile data. We'll reconnect automatically
                when your connection is back.
            </p>
            <div class="offline-waiting">
                <span class="offline-status-dot" aria-hidden="true"></span>
                Waiting to reconnect
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    window.addEventListener("offline", function() {
        overlay.hidden = false;
    });

    window.addEventListener("online", function() {
        overlay.hidden = true;
    });

}