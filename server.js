const express = require("express");
const session = require("express-session");
const FileStore = require("session-file-store")(session);
const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");

dotenv.config();

if (!process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET must be set in the environment.");
}

const app = express();

app.use('/images', express.static(path.join(__dirname, 'images')));

const PORT = Number(process.env.PORT) || 3000;

function getStorageRoot() {
    if (process.env.PERSISTENT_STORAGE_DIR) {
        return path.resolve(process.env.PERSISTENT_STORAGE_DIR);
    }

    if (process.env.RENDER === "true") {
        try {
            const persistentDisk = fs.statSync("/var/data");
            const parentDirectory = fs.statSync("/var");

            if (
                persistentDisk.isDirectory() &&
                persistentDisk.dev !== parentDirectory.dev
            ) {
                return "/var/data";
            }
        } catch (error) {
            if (error.code !== "ENOENT") {
                throw error;
            }
        }
    }

    return __dirname;
}

const storageRoot = getStorageRoot();


/* =========================================================
   FOLDERS
   ========================================================= */

const uploadsFolder = path.join(storageRoot, "uploads");
const recordingsFolder = path.join(uploadsFolder, "recordings");
const thumbnailsFolder = path.join(uploadsFolder, "thumbnails");
const dataFolder = path.join(storageRoot, "data");
const recordingsFile = path.join(dataFolder, "recordings.json");
const adminLoginAttemptsFile = path.join(dataFolder, "admin-login-attempts.json");
const sessionsFolder = path.join(dataFolder, "sessions");
const MAX_UPLOAD_FILE_SIZE_BYTES = 40 * 1024 * 1024 * 1024;
const MAX_ADMIN_LOGIN_ATTEMPTS = 5;
const UPLOAD_REQUEST_TIMEOUT_MS = 24 * 60 * 60 * 1000;

class PersistentFileStore extends FileStore {

    constructor(options) {
        super({
            ...options,
            retries: 0
        });
    }

    get(sessionId, callback) {
        super.get(sessionId, (error, storedSession) => {
            if (error && error.code === "ENOENT") {
                callback(null, null);
                return;
            }

            callback(error, storedSession);
        });
    }

}

fs.mkdirSync(recordingsFolder, { recursive: true });
fs.mkdirSync(thumbnailsFolder, { recursive: true });
fs.mkdirSync(dataFolder, { recursive: true });
fs.mkdirSync(sessionsFolder, { recursive: true });

if (
    storageRoot !== __dirname &&
    !fs.existsSync(recordingsFile)
) {
    const legacyRecordingsFile =
        path.join(__dirname, "data", "recordings.json");

    if (fs.existsSync(legacyRecordingsFile)) {
        const legacyRecordings = JSON.parse(
            fs.readFileSync(legacyRecordingsFile, "utf8")
        );

        if (!Array.isArray(legacyRecordings)) {
            throw new Error("The existing recordings catalog must be an array.");
        }

        legacyRecordings.forEach((recording) => {
            [
                [
                    "recordingUrl",
                    path.join(__dirname, "uploads", "recordings"),
                    recordingsFolder
                ],
                [
                    "thumbnailUrl",
                    path.join(__dirname, "uploads", "thumbnails"),
                    thumbnailsFolder
                ]
            ].forEach(([urlKey, sourceFolder, targetFolder]) => {
                const filename = path.basename(recording?.[urlKey] || "");

                if (!filename || filename === ".") {
                    return;
                }

                const sourceFile = path.join(sourceFolder, filename);
                const targetFile = path.join(targetFolder, filename);

                if (
                    fs.existsSync(sourceFile) &&
                    !fs.existsSync(targetFile)
                ) {
                    fs.copyFileSync(sourceFile, targetFile);
                }
            });
        });

        fs.copyFileSync(legacyRecordingsFile, recordingsFile);
        console.log("Migrated the existing recordings catalog to persistent storage.");
    }
}

if (!fs.existsSync(recordingsFile)) {
    fs.writeFileSync(recordingsFile, "[]", "utf8");
}

if (!fs.existsSync(adminLoginAttemptsFile)) {
    fs.writeFileSync(adminLoginAttemptsFile, "{}", "utf8");
}

/* =========================================================
   BASIC MIDDLEWARE
   ========================================================= */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));


/* =========================================================
   SESSION
   ========================================================= */

app.use(
    session({
        secret: process.env.SESSION_SECRET,
        store: new PersistentFileStore({
            path: sessionsFolder,
            reapInterval: 3600
        }),

        resave: false,
        saveUninitialized: false,

        cookie: {
            httpOnly: true,
            sameSite: "lax"
        }
    })
);


/* =========================================================
   MULTER STORAGE
   ========================================================= */

const storage = multer.diskStorage({

    destination: function (req, file, cb) {

        if (file.fieldname === "recordingFile") {

            cb(null, recordingsFolder);

        } else if (file.fieldname === "thumbnail") {

            cb(null, thumbnailsFolder);

        } else {

            cb(new Error("Invalid upload field."));

        }

    },

    filename: function (req, file, cb) {

        const extension = path.extname(file.originalname);

        const uniqueName =
            Date.now() +
            "-" +
            crypto.randomBytes(8).toString("hex") +
            extension;

        cb(null, uniqueName);

    }

});


const upload = multer({

    storage: storage,

    limits: {
        fileSize: MAX_UPLOAD_FILE_SIZE_BYTES
    }

});

/* =========================================================
   READ / SAVE RECORDINGS
   ========================================================= */

function readRecordings() {

    try {

        const data =
            fs.readFileSync(recordingsFile, "utf8");

        if (!data.trim()) {
            return [];
        }

        return JSON.parse(data);

    } catch (error) {

        console.error(
            "Could not read recordings.json:",
            error
        );

        return [];

    }

}


function saveRecordings(recordings) {

    fs.writeFileSync(
        recordingsFile,
        JSON.stringify(recordings, null, 2),
        "utf8"
    );

}

function isAdminSession(req) {
    return Boolean(req.session && req.session.isAdmin === true);
}


function getLocalDateKey(date = new Date()) {

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;

}


function rotateRecordingAccessCode(recording, date = new Date()) {

    recording.accessCode =
        crypto.randomInt(10000000, 100000000).toString();
    recording.accessCodeDay = getLocalDateKey(date);
    recording.accessCodeUpdatedAt = date.toISOString();

}


function ensureCurrentRecordingAccessCode(recording, date = new Date()) {

    if (
        !recording.accessCode ||
        recording.accessCodeDay !== getLocalDateKey(date)
    ) {
        rotateRecordingAccessCode(recording, date);
        return true;
    }

    return false;

}


const accessCodeAttempts = new Map();


function hasExceededAccessCodeAttempts(req, recordingId) {

    const now = Date.now();
    const windowMs = 5 * 60 * 1000;
    const key = `${req.ip || req.socket.remoteAddress}:${recordingId}`;
    const attempts = accessCodeAttempts.get(key);

    if (!attempts || now - attempts.startedAt >= windowMs) {
        accessCodeAttempts.set(key, {
            count: 1,
            startedAt: now
        });
        return false;
    }

    if (attempts.count >= 5) {
        return true;
    }

    attempts.count += 1;
    return false;

}


/* =========================================================
   ADMIN AUTHENTICATION
   ========================================================= */

function requireAdmin(req, res, next) {

    try {

        if (isAdminSession(req)) {
            return next();
        }

        return res.status(401).json({

            success: false,
            message: "Admin login required."

        });

    } catch (error) {
        return next(error);
    }

}


function requireAdminPage(req, res, next) {

    try {

        if (!isAdminSession(req)) {
            return res.redirect("/login.html");
        }

        return next();

    } catch (error) {
        return next(error);
    }

}


/* =========================================================
   DELETE UPLOADED FILE
   ========================================================= */

function deleteUploadedFile(fileUrl, folder) {

    if (!fileUrl) {
        return;
    }

    try {

        const filename = path.basename(fileUrl);

        const folderResolved =
            path.resolve(folder);

        const filePath =
            path.resolve(folderResolved, filename);


        if (
            filePath !== folderResolved &&
            filePath.startsWith(
                folderResolved + path.sep
            )
        ) {

            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }

        }

    } catch (error) {

        console.error(
            "Could not delete uploaded file:",
            error
        );

    }

}


function readAdminLoginAttempts() {
    const data = JSON.parse(fs.readFileSync(adminLoginAttemptsFile, "utf8"));

    if (
        !data ||
        typeof data !== "object" ||
        Array.isArray(data) ||
        Object.values(data).some((attempt) => {
            if (!attempt || typeof attempt !== "object" || Array.isArray(attempt)) {
                return true;
            }

            if (!Number.isInteger(attempt.count) || attempt.count < 0 || attempt.count > MAX_ADMIN_LOGIN_ATTEMPTS) {
                return true;
            }

            if (typeof attempt.dayKey !== "string") {
                return true;
            }

            if (attempt.lockedUntil !== null && typeof attempt.lockedUntil !== "string") {
                return true;
            }

            return false;
        })
    ) {
        throw new Error("Admin login attempt data has an invalid format.");
    }

    return data;
}


function saveAdminLoginAttempts(attempts) {
    const temporaryFile =
        `${adminLoginAttemptsFile}.${process.pid}.tmp`;

    try {
        fs.writeFileSync(temporaryFile, JSON.stringify(attempts, null, 2), "utf8");
        fs.renameSync(temporaryFile, adminLoginAttemptsFile);
    } catch (error) {
        if (fs.existsSync(temporaryFile)) {
            try {
                fs.unlinkSync(temporaryFile);
            } catch (cleanupError) {
                console.error("Could not clean up temporary login-attempt data:", cleanupError);
            }
        }

        throw error;
    }
}


function getAdminLoginAttemptKey(req) {
    const clientAddress =
        req.ip || req.socket.remoteAddress || "unknown";

    return crypto
        .createHmac("sha256", process.env.SESSION_SECRET)
        .update(clientAddress)
        .digest("hex");
}

/* =========================================================
   LOGIN
   ========================================================= */

app.post("/api/login", (req, res) => {

    const {
        email,
        password
    } = req.body;


    if (
        typeof email !== "string" ||
        !email.trim() ||
        typeof password !== "string" ||
        !password
    ) {

        return res.status(400).json({

            success: false,
            message: "Email and password are required."

        });

    }

    const emailPattern =
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailPattern.test(email)) {
        return res.status(400).json({
            success: false,
            message: "Please enter a valid email address."
        });
    }

    const now = new Date();
    const dayKey = getLocalDateKey(now);
    const attemptKey = getAdminLoginAttemptKey(req);
    const attempts = readAdminLoginAttempts();
    let loginAttempt = attempts[attemptKey];

    if (!loginAttempt || loginAttempt.dayKey !== dayKey) {
        loginAttempt = {
            count: 0,
            dayKey,
            lockedUntil: null
        };
        attempts[attemptKey] = loginAttempt;
    }

    if (
        loginAttempt.lockedUntil &&
        new Date(loginAttempt.lockedUntil).getTime() > now.getTime()
    ) {
        return res.status(429).json({
            success: false,
            attemptsRemaining: 0,
            lockedUntil: loginAttempt.lockedUntil,
            message: `Too many incorrect passwords. Login is locked until ${new Date(loginAttempt.lockedUntil).toLocaleString()}.`
        });
    }

    if (
        password !==
        process.env.ADMIN_PASSWORD
    ) {
        loginAttempt.count += 1;

        if (loginAttempt.count >= MAX_ADMIN_LOGIN_ATTEMPTS) {
            const lockedUntil = new Date(now);
            lockedUntil.setHours(24, 0, 0, 0);
            loginAttempt.lockedUntil = lockedUntil.toISOString();
            saveAdminLoginAttempts(attempts);

            return res.status(429).json({
                success: false,
                attemptsRemaining: 0,
                lockedUntil: loginAttempt.lockedUntil,
                message: `Too many incorrect passwords. Login is locked until ${lockedUntil.toLocaleString()}.`
            });
        }

        loginAttempt.lockedUntil = null;
        saveAdminLoginAttempts(attempts);

        return res.status(401).json({
            success: false,
            attemptsRemaining: MAX_ADMIN_LOGIN_ATTEMPTS - loginAttempt.count,
            message: `Incorrect password. You have ${MAX_ADMIN_LOGIN_ATTEMPTS - loginAttempt.count} attempt${MAX_ADMIN_LOGIN_ATTEMPTS - loginAttempt.count === 1 ? "" : "s"} remaining before login is locked until tomorrow.`
        });

    }

    loginAttempt.count = 0;
    loginAttempt.lockedUntil = null;
    saveAdminLoginAttempts(attempts);

    req.session.isAdmin = true;


    return res.json({

        success: true,
        message: "Login successful."

    });

});


/* =========================================================
   LOGOUT
   ========================================================= */

app.post("/api/logout", (req, res) => {

    const unlockedRecordingIds =
        req.session?.unlockedRecordings || {};

    const recordings =
        readRecordings();

    let codesChanged = false;

    recordings.forEach((recording) => {
        if (unlockedRecordingIds[recording.id] === true) {
            rotateRecordingAccessCode(recording);
            codesChanged = true;
        }
    });

    if (codesChanged) {
        try {
            saveRecordings(recordings);
        } catch (error) {
            console.error("Could not rotate passwords during logout:", error);
            return res.status(500).json({
                success: false,
                message: "Could not rotate recording passwords during logout."
            });
        }
    }

    req.session.destroy((error) => {

        if (error) {

            console.error(
                "Logout error:",
                error
            );

            return res.status(500).json({

                success: false,
                message: "Could not log out."

            });

        }


        res.json({

            success: true,
            message: "Logged out successfully."

        });

    });

});


/* =========================================================
   PROTECT ADMIN PAGE
   ========================================================= */

app.get("/admin.html", requireAdminPage);

app.get("/edit-recording.html", requireAdminPage);


/* =========================================================
   GET RECORDINGS
   ========================================================= */

app.get("/api/health", (req, res) => {

    res.set("Cache-Control", "no-store");
    res.json({ status: "ok" });

});


app.get("/api/recordings", (req, res) => {

    res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.set("Pragma", "no-cache");

    const recordings = readRecordings();

    let recordingsChanged = false;
    const now = new Date();

    recordings.forEach((recording) => {
        if (ensureCurrentRecordingAccessCode(recording, now)) {
            recordingsChanged = true;
        }
    });

    if (recordingsChanged) {
        saveRecordings(recordings);
    }

    const isAdmin = isAdminSession(req);

    res.json({

        success: true,
        recordings: recordings.map((recording) => {

            const {
                recordingUrl,
                accessCode,
                accessCodeDay,
                accessCodeUpdatedAt,
                ...publicRecording
            } = recording;

            if (!isAdmin) {
                return publicRecording;
            }

            return {
                ...publicRecording,
                recordingUrl:
                    `/api/recordings/${encodeURIComponent(recording.id)}/media`,
                accessCode,
                accessCodeUpdatedAt
            };

        })

    });

});


app.post("/api/recordings/:id/unlock", (req, res) => {

    const recordings = readRecordings();
    const recording = recordings.find(
        (item) => item.id === req.params.id
    );

    if (!recording) {
        return res.status(404).json({
            success: false,
            message: "Recording not found."
        });
    }

    const codeChanged =
        ensureCurrentRecordingAccessCode(recording);

    if (codeChanged) {
        saveRecordings(recordings);
    }

    if (hasExceededAccessCodeAttempts(req, recording.id)) {
        return res.status(429).json({
            success: false,
            message: "Too many attempts. Please wait five minutes and try again."
        });
    }

    const submittedCode =
        String(req.body?.password || "").trim();

    const submittedBuffer =
        Buffer.from(submittedCode);

    const currentBuffer =
        Buffer.from(recording.accessCode);

    if (
        submittedBuffer.length !== currentBuffer.length ||
        !crypto.timingSafeEqual(submittedBuffer, currentBuffer)
    ) {
        return res.status(401).json({
            success: false,
            message: "That password is incorrect. Chat the administrator for the current password."
        });
    }

    rotateRecordingAccessCode(recording);
    saveRecordings(recordings);

    if (!req.session.unlockedRecordings) {
        req.session.unlockedRecordings = {};
    }

    req.session.unlockedRecordings[recording.id] = true;

    return res.json({
        success: true,
        message: "Recording unlocked."
    });

});


app.get("/api/recordings/:id/media", (req, res) => {

    const recordings = readRecordings();
    const recording = recordings.find(
        (item) => item.id === req.params.id
    );

    if (!recording) {
        return res.status(404).send("Recording not found.");
    }

    const isAdmin = isAdminSession(req);

    const isUnlocked =
        req.session &&
        req.session.unlockedRecordings &&
        req.session.unlockedRecordings[recording.id] === true;

    if (!isAdmin && !isUnlocked) {
        return res.status(403).send("Unlock this recording to play it.");
    }

    const filename =
        path.basename(recording.recordingUrl || "");

    if (!filename) {
        return res.status(404).send("Recording file not found.");
    }

    const mediaPath =
        path.join(recordingsFolder, filename);

    if (!fs.existsSync(mediaPath)) {
        return res.status(404).send("Recording file not found.");
    }

    res.set("Cache-Control", "private, no-store");
    res.set("X-Content-Type-Options", "nosniff");

    return res.sendFile(mediaPath, (error) => {
        if (error && !res.headersSent) {
            console.error("Could not serve recording:", error);
            res.status(error.statusCode || 500).end();
        }
    });

});


/* =========================================================
   UPLOAD NEW RECORDING
   ========================================================= */

app.post(
    "/api/recordings",
    requireAdmin,

    upload.fields([
        {
            name: "recordingFile",
            maxCount: 1
        },
        {
            name: "thumbnail",
            maxCount: 1
        }
    ]),

    (req, res) => {

        try {

            const recordingFile =
                req.files?.recordingFile?.[0];

            const thumbnailFile =
                req.files?.thumbnail?.[0];


            const {
                title,
                date,
                speakerName,
                description
            } = req.body;


            if (!title || !date) {

                if (recordingFile) {

                    deleteUploadedFile(
                        `/uploads/recordings/${recordingFile.filename}`,
                        recordingsFolder
                    );

                }

                if (thumbnailFile) {

                    deleteUploadedFile(
                        `/uploads/thumbnails/${thumbnailFile.filename}`,
                        thumbnailsFolder
                    );

                }

                return res.status(400).json({

                    success: false,
                    message: "Title and date are required."

                });

            }


            if (!recordingFile) {

                return res.status(400).json({

                    success: false,
                    message: "Please select a recording file."

                });

            }

            const recordings = readRecordings();


            const id =
                Date.now().toString() +
                "-" +
                crypto.randomBytes(6).toString("hex");


            const recording = {

                id,

                title: title.trim(),

                date,

                speakerName:
                    speakerName
                        ? speakerName.trim()
                        : "",

                description:
                    description
                        ? description.trim()
                        : "",

                type:
                    recordingFile.mimetype,

                originalName:
                    recordingFile.originalname,

                recordingUrl:
                    "/uploads/recordings/" +
                    recordingFile.filename,

                thumbnailUrl:
                    thumbnailFile
                        ? "/uploads/thumbnails/" +
                          thumbnailFile.filename
                        : "",

                createdAt:
                    new Date().toISOString()

            };

            rotateRecordingAccessCode(recording);

            recordings.unshift(recording);

            saveRecordings(recordings);


            return res.status(201).json({

                success: true,
                message: "Recording uploaded successfully.",
                recording

            });

        } catch (error) {

            console.error(
                "Upload error:",
                error
            );

            return res.status(500).json({

                success: false,
                message: "Could not upload recording."

            });

        }

    }
);


/* =========================================================
   EDIT RECORDING
   ========================================================= */

app.put(
    "/api/recordings/:id",
    requireAdmin,

    upload.fields([
        {
            name: "recordingFile",
            maxCount: 1
        },
        {
            name: "thumbnail",
            maxCount: 1
        }
    ]),

    (req, res) => {

        try {

            const recordings = readRecordings();


            const recordingIndex =
                recordings.findIndex(
                    (recording) =>
                        recording.id === req.params.id
                );


            if (recordingIndex === -1) {

                const newRecordingFile =
                    req.files?.recordingFile?.[0];

                const newThumbnailFile =
                    req.files?.thumbnail?.[0];


                if (newRecordingFile) {

                    deleteUploadedFile(
                        `/uploads/recordings/${newRecordingFile.filename}`,
                        recordingsFolder
                    );

                }


                if (newThumbnailFile) {

                    deleteUploadedFile(
                        `/uploads/thumbnails/${newThumbnailFile.filename}`,
                        thumbnailsFolder
                    );

                }


                return res.status(404).json({

                    success: false,
                    message: "Recording not found."

                });

            }


            const oldRecording =
                recordings[recordingIndex];


            const {
                title,
                date,
                speakerName,
                description
            } = req.body;


            if (!title || !date) {

                const newRecordingFile =
                    req.files?.recordingFile?.[0];

                const newThumbnailFile =
                    req.files?.thumbnail?.[0];


                if (newRecordingFile) {

                    deleteUploadedFile(
                        `/uploads/recordings/${newRecordingFile.filename}`,
                        recordingsFolder
                    );

                }


                if (newThumbnailFile) {

                    deleteUploadedFile(
                        `/uploads/thumbnails/${newThumbnailFile.filename}`,
                        thumbnailsFolder
                    );

                }


                return res.status(400).json({

                    success: false,
                    message: "Title and date are required."

                });

            }


            const newRecordingFile =
                req.files?.recordingFile?.[0];

            const newThumbnailFile =
                req.files?.thumbnail?.[0];

            const updatedRecording = {

                ...oldRecording,

                title: title.trim(),

                date,

                speakerName:
                    speakerName
                        ? speakerName.trim()
                        : "",

                description:
                    description
                        ? description.trim()
                        : ""

            };


            if (newRecordingFile) {

                updatedRecording.type =
                    newRecordingFile.mimetype;

                updatedRecording.originalName =
                    newRecordingFile.originalname;

                updatedRecording.recordingUrl =
                    "/uploads/recordings/" +
                    newRecordingFile.filename;

            }


            if (newThumbnailFile) {

                updatedRecording.thumbnailUrl =
                    "/uploads/thumbnails/" +
                    newThumbnailFile.filename;

            }


            recordings[recordingIndex] =
                updatedRecording;


            saveRecordings(recordings);


            if (newRecordingFile) {

                deleteUploadedFile(
                    oldRecording.recordingUrl,
                    recordingsFolder
                );

            }


            if (newThumbnailFile) {

                deleteUploadedFile(
                    oldRecording.thumbnailUrl,
                    thumbnailsFolder
                );

            }


            return res.json({

                success: true,
                message: "Recording updated successfully.",
                recording: updatedRecording

            });

        } catch (error) {

            console.error(
                "Edit recording error:",
                error
            );

            return res.status(500).json({

                success: false,
                message: "Could not update recording."

            });

        }

    }
);


/* =========================================================
   DELETE RECORDING
   ========================================================= */

app.delete(
    "/api/recordings/:id",
    requireAdmin,

    (req, res) => {

        try {

            const recordings =
                readRecordings();


            const recordingIndex =
                recordings.findIndex(
                    (recording) =>
                        recording.id === req.params.id
                );


            if (recordingIndex === -1) {

                return res.status(404).json({

                    success: false,
                    message: "Recording not found."

                });

            }


            const recording =
                recordings[recordingIndex];


            deleteUploadedFile(
                recording.recordingUrl,
                recordingsFolder
            );


            deleteUploadedFile(
                recording.thumbnailUrl,
                thumbnailsFolder
            );


            recordings.splice(
                recordingIndex,
                1
            );


            saveRecordings(recordings);


            return res.json({

                success: true,
                message: "Recording deleted successfully."

            });

        } catch (error) {

            console.error(
                "Delete error:",
                error
            );

            return res.status(500).json({

                success: false,
                message: "Could not delete recording."

            });

        }

    }
);


/* =========================================================
   SERVE PUBLIC THUMBNAILS ONLY
   ========================================================= */

app.use(
    "/uploads/recordings",
    (req, res) => res.sendStatus(404)
);

app.use(
    "/uploads/thumbnails",
    express.static(thumbnailsFolder)
);

app.use(
    "/data",
    (req, res) => res.sendStatus(404)
);

app.use(
    ["/server.js", "/package.json", "/package-lock.json", "/node_modules"],
    (req, res) => res.sendStatus(404)
);

/* =========================================================
   SERVE WEBSITE
   ========================================================= */

app.use(
    express.static(__dirname)
);


/* =========================================================
   MULTER / GENERAL ERROR
   ========================================================= */

app.use((error, req, res, next) => {

    console.error(
        "Server error:",
        error
    );


    if (error instanceof multer.MulterError) {

        if (error.code === "LIMIT_FILE_SIZE") {

            return res.status(400).json({

                success: false,

                message:
                    "The file is too large. Maximum size is 40GB."

            });

        }


        return res.status(400).json({

            success: false,
            message: error.message

        });

    }


    return res.status(500).json({

        success: false,
        message:
            error.message ||
            "Something went wrong."

    });

});


/* =========================================================
   START SERVER
   ========================================================= */

const server = app.listen(PORT, () => {

    console.log(
        `K.S.G.C Recordings server running at http://localhost:${PORT}`
    );

});

server.requestTimeout = UPLOAD_REQUEST_TIMEOUT_MS;