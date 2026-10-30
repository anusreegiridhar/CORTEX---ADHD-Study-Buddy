/**
 * CORTEX — ADHD AI Study Buddy
 * Controller v3.0 // Edgy Cyberpunk & Dynamic Audio/Visual Engine
 */

"use strict";

// =====================================================================
// GLOBAL STATE
// =====================================================================
const STATE = {
  // Study Notes
  currentStudyNotes: null,

  // Multi-Attempt Quiz Tracking & Review
  lastQuizResult: null,
  quizAttempts: {}, // { [quizId]: [{ attempt: 1, score, max_score, pct, timestamp, results }] }

  // Encouragement Ticker
  encouragementIndex: 0,
  encouragementTimer: null,

  // Per-Subject Isolated State Cache
  subjectCache: {},
    profile: null,           // {name, subject, scopedSubject, focusMins, breakMins, examType, style}
    camActive: false,
    camSource: "client-canvas",
    camStream: null,
    camInterval: null,
    frameCounter: 0,
    sfxEnabled: true,
    audioCtx: null,

    // Active Quiz
    quizId: null,
    quizData: null,          // [{question, options, is_revision}]
    quizAnswers: {},         // {index: answer}

    // Pomodoro Timer
    timerInterval: null,
    timerMode: "focus",      // "focus" | "break"
    timerSeconds: 25 * 60,
    timerMax: 25 * 60,
    timerRunning: false,

    // Brain Dump Feed
    bdFilter: "all",         // "all" | "pinned" | "cram" | "revision"
    bdItems: [],             // unified items

    // Break Modal
    breakSeconds: 5 * 60,
    breakInterval: null,

    // Telemetry
    fatigueEvents: 0,
    consecFrames: 0,
    focusScore: 100,

    // Animation Frame IDs
    ambientAnimId: null,
    waveAnimId: null,

    // Multi-subject sessions list (persisted in localStorage)
    sessions: [],            // [{name, subject, scopedSubject, ...profile}]
};

// =====================================================================
// UTILITIES & HELPERS
// =====================================================================
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

function escHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function fmtTime(secs) {
    const m = String(Math.floor(secs / 60)).padStart(2, "0");
    const s = String(secs % 60).padStart(2, "0");
    return `${m}:${s}`;
}

function nowHHMM() {
    return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// =====================================================================
// SYNTHESIZED WEB AUDIO SFX (Zero External Audio Files Needed)
// =====================================================================
function initAudioContext() {
    if (!STATE.audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
            STATE.audioCtx = new AudioContext();
        }
    }
    if (STATE.audioCtx && STATE.audioCtx.state === "suspended") {
        STATE.audioCtx.resume();
    }
}

function playSfx(type = "click") {
    if (!STATE.sfxEnabled) return;
    try {
        initAudioContext();
        if (!STATE.audioCtx) return;
        const ctx = STATE.audioCtx;
        const now = ctx.currentTime;

        if (type === "click") {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "sine";
            osc.frequency.setValueAtTime(800, now);
            osc.frequency.exponentialRampToValueAtTime(1400, now + 0.04);
            gain.gain.setValueAtTime(0.08, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.05);
        } else if (type === "tab") {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "triangle";
            osc.frequency.setValueAtTime(420, now);
            osc.frequency.exponentialRampToValueAtTime(880, now + 0.09);
            gain.gain.setValueAtTime(0.06, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.1);
        } else if (type === "start") {
            [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = "sine";
                osc.frequency.setValueAtTime(freq, now + i * 0.08);
                gain.gain.setValueAtTime(0.1, now + i * 0.08);
                gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.25);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(now + i * 0.08);
                osc.stop(now + i * 0.08 + 0.25);
            });
        } else if (type === "alert") {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "sawtooth";
            osc.frequency.setValueAtTime(440, now);
            osc.frequency.setValueAtTime(320, now + 0.15);
            gain.gain.setValueAtTime(0.12, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.35);
        } else if (type === "badge") {
            [440, 554.37, 659.25, 880, 1108.73].forEach((freq, i) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = "triangle";
                osc.frequency.setValueAtTime(freq, now + i * 0.09);
                gain.gain.setValueAtTime(0.12, now + i * 0.09);
                gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.09 + 0.4);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(now + i * 0.09);
                osc.stop(now + i * 0.09 + 0.4);
            });
        }
    } catch (e) {
        // Audio context may be restricted by autoplay policy
    }
}

// =====================================================================
// TOAST NOTIFICATIONS
// =====================================================================
function toast(title, msg = "", type = "info") {
    const zone = $("#toast-zone");
    const icons = { success: "✓", error: "✕", badge: "🏆", info: "✦" };
    const t = document.createElement("div");
    t.className = `toast t-${type}`;
    t.innerHTML = `
    <div class="toast-icon">${icons[type] || "✦"}</div>
    <div>
      <div class="toast-title">${escHtml(title)}</div>
      ${msg ? `<div class="toast-msg">${escHtml(msg)}</div>` : ""}
    </div>`;
    zone.appendChild(t);
    setTimeout(() => {
        t.style.opacity = "0";
        t.style.transform = "translateY(10px)";
        setTimeout(() => t.remove(), 300);
    }, 4200);
}

// =====================================================================
// API CALL WRAPPER (Flexible & Resilient)
// =====================================================================
async function api(method, path, body = null) {
    const opts = { method, headers: {} };
    if (body) {
        opts.headers["Content-Type"] = "application/json";
        opts.body = JSON.stringify(body);
    }
    const res = await fetch(path, opts);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || err.message || `HTTP ${res.status}`);
    }
    return res.json();
}

// =====================================================================
// DYNAMIC BACKGROUND CANVAS: LIQUID CHROME STARS & NEURAL PARTICLES
// =====================================================================
function initAmbientBackground() {
    const canvas = $("#ambient-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    let w, h;
    let mouse = { x: -1000, y: -1000, targetX: -1000, targetY: -1000 };

    function resize() {
        w = canvas.width = window.innerWidth;
        h = canvas.height = window.innerHeight;
    }
    window.addEventListener("resize", resize);
    resize();

    window.addEventListener("mousemove", (e) => {
        mouse.targetX = e.clientX;
        mouse.targetY = e.clientY;
    });

    // Generate particles & 4-point glass star entities
    const starsCount = 14;
    const particlesCount = 45;

    const stars = Array.from({ length: starsCount }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        size: 14 + Math.random() * 26,
        speedX: (Math.random() - 0.5) * 0.35,
        speedY: (Math.random() - 0.5) * 0.35,
        rot: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.015,
        alpha: 0.15 + Math.random() * 0.45,
        elongation: 1.4 + Math.random() * 0.8,
    }));

    const particles = Array.from({ length: particlesCount }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        r: 1 + Math.random() * 2,
        alpha: 0.2 + Math.random() * 0.5,
    }));

    function draw4PointStar(cx, cy, size, rot, elongation, alpha) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rot);
        ctx.globalAlpha = alpha;

        // Outer glow
        ctx.shadowColor = "#c084fc";
        ctx.shadowBlur = 12;

        ctx.beginPath();
        const half = size / 2;
        const long = half * elongation;
        const pinch = size * 0.18;

        // Diamond curves for liquid glass star entity
        ctx.moveTo(0, -long);
        ctx.quadraticCurveTo(pinch, -pinch, half, 0);
        ctx.quadraticCurveTo(pinch, pinch, 0, long);
        ctx.quadraticCurveTo(-pinch, pinch, -half, 0);
        ctx.quadraticCurveTo(-pinch, -pinch, 0, -long);
        ctx.closePath();

        // Specular liquid chrome gradient
        const grad = ctx.createLinearGradient(-half, -long, half, long);
        grad.addColorStop(0, "rgba(255, 255, 255, 0.9)");
        grad.addColorStop(0.3, "rgba(216, 180, 254, 0.6)");
        grad.addColorStop(0.6, "rgba(147, 51, 234, 0.4)");
        grad.addColorStop(1, "rgba(255, 255, 255, 0.8)");
        ctx.fillStyle = grad;
        ctx.fill();

        // Central bright core
        ctx.beginPath();
        ctx.arc(0, 0, size * 0.08, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();

        ctx.restore();
    }

    function loop() {
        ctx.clearRect(0, 0, w, h);

        // Smooth mouse interpolation
        mouse.x += (mouse.targetX - mouse.x) * 0.05;
        mouse.y += (mouse.targetY - mouse.y) * 0.05;

        // Update & draw particles
        particles.forEach((p) => {
            p.x += p.vx;
            p.y += p.vy;
            if (p.x < 0) p.x = w;
            if (p.x > w) p.x = 0;
            if (p.y < 0) p.y = h;
            if (p.y > h) p.y = 0;

            // Mouse repulsion
            const dx = p.x - mouse.x;
            const dy = p.y - mouse.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 120) {
                p.x += (dx / dist) * 2;
                p.y += (dy / dist) * 2;
            }

            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(192, 132, 252, ${p.alpha})`;
            ctx.shadowColor = "#a855f7";
            ctx.shadowBlur = 6;
            ctx.fill();
        });

        // Update & draw liquid chrome stars
        stars.forEach((s) => {
            s.x += s.speedX;
            s.y += s.speedY;
            s.rot += s.rotSpeed;

            if (s.x < -50) s.x = w + 50;
            if (s.x > w + 50) s.x = -50;
            if (s.y < -50) s.y = h + 50;
            if (s.y > h + 50) s.y = -50;

            draw4PointStar(s.x, s.y, s.size, s.rot, s.elongation, s.alpha);
        });

        STATE.ambientAnimId = requestAnimationFrame(loop);
    }

    loop();
}

// =====================================================================
// DYNAMIC NEURAL FOCUS RHYTHM / AUDIO SPECTRUM CANVAS
// =====================================================================
function initNeuralWaveform() {
    const canvas = $("#neural-wave-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    let w = (canvas.width = canvas.parentElement.clientWidth || 360);
    let h = (canvas.height = 42);

    window.addEventListener("resize", () => {
        if (canvas.parentElement) {
            w = canvas.width = canvas.parentElement.clientWidth;
        }
    });

    let phase = 0;
    const barsCount = 42;

    function renderWave() {
        ctx.clearRect(0, 0, w, h);

        const isRunning = STATE.timerRunning || STATE.camActive;
        const mode = isRunning ? (STATE.focusScore < 70 ? "DROWSY_WAVE" : "FLOW_BURST") : "IDLE_CARRIER";
        const lbl = $("#wave-mode-label");
        if (lbl) lbl.textContent = mode;

        const barW = (w / barsCount) * 0.65;
        const gap = (w / barsCount) * 0.35;

        for (let i = 0; i < barsCount; i++) {
            const x = i * (barW + gap);
            // Generate synthetic rhythm frequency
            const freq1 = Math.sin(phase + i * 0.25);
            const freq2 = Math.cos(phase * 0.7 + i * 0.15);
            let mag = Math.abs(freq1 * 0.6 + freq2 * 0.4);

            if (isRunning) {
                mag = Math.min(1, mag * 1.5 + Math.random() * 0.2);
            } else {
                mag = mag * 0.45;
            }

            const barH = Math.max(4, mag * (h - 8));
            const y = (h - barH) / 2;

            // Color gradient
            const grad = ctx.createLinearGradient(0, y, 0, y + barH);
            if (mode === "DROWSY_WAVE") {
                grad.addColorStop(0, "#f43f5e");
                grad.addColorStop(1, "#fbbf24");
            } else {
                grad.addColorStop(0, "#e879f9");
                grad.addColorStop(0.5, "#a855f7");
                grad.addColorStop(1, "#38bdf8");
            }

            ctx.fillStyle = grad;
            ctx.shadowColor = mode === "DROWSY_WAVE" ? "#f43f5e" : "#c084fc";
            ctx.shadowBlur = isRunning ? 6 : 2;

            // Draw rounded bar
            ctx.beginPath();
            ctx.roundRect ? ctx.roundRect(x, y, barW, barH, 2) : ctx.rect(x, y, barW, barH);
            ctx.fill();
        }

        phase += isRunning ? 0.08 : 0.03;
        STATE.waveAnimId = requestAnimationFrame(renderWave);
    }

    renderWave();
}

// =====================================================================
// HUD CLOCK & SFX TOGGLE
// =====================================================================
function initTopHud() {
    function tickClock() {
        const el = $("#hud-clock");
        if (el) {
            el.textContent = new Date().toLocaleTimeString();
        }
    }
    setInterval(tickClock, 1000);
    tickClock();

    // SFX toggle
    $("#btn-toggle-sfx")?.addEventListener("click", () => {
        STATE.sfxEnabled = !STATE.sfxEnabled;
        const icon = $("#sfx-icon");
        const label = $("#sfx-label");
        if (icon) icon.textContent = STATE.sfxEnabled ? "🔊" : "🔇";
        if (label) label.textContent = STATE.sfxEnabled ? "SFX: ON" : "SFX: OFF";
        playSfx("click");
        toast("Audio Effects", STATE.sfxEnabled ? "SFX Armed" : "SFX Muted", "info");
    });

    // ---- THEME TOGGLE (Light / Dark) ----
    function applyTheme(isDark) {
        const body = document.body;
        const icon = $("#theme-toggle-icon");
        const label = $("#theme-toggle-label");

        if (isDark) {
            body.classList.remove("light-mode");
            if (icon) { icon.textContent = "🌙"; icon.style.transform = "rotate(0deg)"; }
            if (label) label.textContent = "DARK";
        } else {
            body.classList.add("light-mode");
            if (icon) { icon.textContent = "☀️"; icon.style.transform = "rotate(180deg)"; }
            if (label) label.textContent = "LITE";
        }
        localStorage.setItem("cortex_theme", isDark ? "dark" : "light");
    }

    // Restore saved theme on boot
    const savedTheme = localStorage.getItem("cortex_theme") || "dark";
    applyTheme(savedTheme === "dark");

    // Button click handler
    $("#btn-theme-toggle")?.addEventListener("click", () => {
        const isDark = !document.body.classList.contains("light-mode");
        applyTheme(!isDark);
        playSfx("click");
        const msg = document.body.classList.contains("light-mode")
            ? "Switched to Lavender Light Mode" : "Switched to Void Dark Mode";
        toast("Theme", msg, "info");
    });

    // Profile modal triggers
    $("#hud-profile-trigger")?.addEventListener("click", openProfileModal);
    $("#btn-open-profile-sidebar")?.addEventListener("click", openProfileModal);
}


// =====================================================================
// TAB NAVIGATION
// =====================================================================
function initNav() {
    $$(`.nav-item`).forEach((btn) => {
        btn.addEventListener("click", () => {
            playSfx("tab");
            $$(`.nav-item`).forEach((b) => b.classList.remove("active"));
            $$(`.tab-view`).forEach((t) => t.classList.remove("active"));

            btn.classList.add("active");
            const tabId = btn.dataset.tab;
            const targetView = $(`#${tabId}`);
            if (targetView) targetView.classList.add("active");

            // Lazy load tab data
            if (tabId === "tab-notes") loadStudyNotesForSubject();
      if (tabId === "tab-braindump") loadBrainDump();
            if (tabId === "tab-subjects") renderSubjectsSessions();
        });
    });
}

// =====================================================================
// PROFILE & ONBOARDING
// =====================================================================
function initProfile() {
    // Load sessions list from localStorage
    try {
        STATE.sessions = JSON.parse(localStorage.getItem("cortex_sessions") || "[]");
    } catch (e) { STATE.sessions = []; }

    const saved = localStorage.getItem("cortex_profile");
    if (saved) {
        try {
            STATE.profile = JSON.parse(saved);
            applyProfile();
        } catch (e) {
            openProfileModal();
        }
    } else {
        // Default initial profile
        STATE.profile = {
            name: "Anusree",
            subject: "Machine Learning",
            scopedSubject: "anusree__machine_learning",
            focusMins: 25,
            breakMins: 5,
            examType: "mixed",
            style: "theory",
        };
        applyProfile();
    }

    // If current profile not in sessions list, add it
    if (STATE.profile) addSessionIfNew(STATE.profile);
    populateSubjectSwitcher();

    $("#btn-close-profile")?.addEventListener("click", closeProfileModal);

    // Range slider visual values
    const focusSlider = $("#pf-focus");
    const breakSlider = $("#pf-break");
    focusSlider?.addEventListener("input", () => {
        $("#pf-focus-val").textContent = `${focusSlider.value} min`;
    });
    breakSlider?.addEventListener("input", () => {
        $("#pf-break-val").textContent = `${breakSlider.value} min`;
    });

    // Profile Form Submit
    $("#form-profile")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        playSfx("click");

        const name = $("#pf-name").value.trim() || "Student";
        const subject = $("#pf-subject").value.trim() || "General";
        const focusMins = parseInt(focusSlider.value) || 25;
        const breakMins = parseInt(breakSlider.value) || 5;
        const examType = $("#pf-exam-type").value || "mixed";
        const style = $("#pf-style").value || "theory";

        const scopedSubject = `${name.toLowerCase().replace(/[^a-z0-9]/g, "")}__${subject.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;

        const profileData = {
            name,
            subject,
            scopedSubject,
            focusMins,
            breakMins,
            examType,
            style,
        };

        STATE.profile = profileData;
        localStorage.setItem("cortex_profile", JSON.stringify(profileData));
        addSessionIfNew(profileData);
        populateSubjectSwitcher();
        applyProfile();
        closeProfileModal();

        // Sync to backend (accepts both JSON & Form smoothly)
        try {
            const res = await api("POST", "/profiles", {
                name,
                student_name: name,
                focus_minutes: focusMins,
                focus_duration: focusMins,
                break_minutes: breakMins,
                break_duration: breakMins,
                exam_type: examType,
                question_style: style,
                subject_name: subject,
            });
            toast("Profile Synced", `Welcome back, ${name}! Focus blocks ready.`, "success");
        } catch (err) {
            console.warn("Backend profile sync warning:", err);
            toast("Profile Saved Locally", `Active student: ${name}`, "info");
        }
    });
}

function openProfileModal() {
    playSfx("click");
    if (STATE.profile) {
        const p = STATE.profile;
        if ($("#pf-name")) $("#pf-name").value = p.name || "";
        if ($("#pf-subject")) $("#pf-subject").value = p.subject || "";
        if ($("#pf-focus")) $("#pf-focus").value = p.focusMins || 25;
        if ($("#pf-break")) $("#pf-break").value = p.breakMins || 5;
        if ($("#pf-focus-val")) $("#pf-focus-val").textContent = `${p.focusMins || 25} min`;
        if ($("#pf-break-val")) $("#pf-break-val").textContent = `${p.breakMins || 5} min`;
        if ($("#pf-exam-type")) $("#pf-exam-type").value = p.examType || "mixed";
        if ($("#pf-style")) $("#pf-style").value = p.style || "theory";
    }
    const modal = $("#modal-profile");
    if (modal) modal.style.display = "flex";
}

function closeProfileModal() {
    playSfx("click");
    const modal = $("#modal-profile");
    if (modal) modal.style.display = "none";
}

function applyProfile() {
    const p = STATE.profile;
    if (!p) return;

    // Header & sidebar labels
    if ($("#hud-user-label")) $("#hud-user-label").textContent = p.name;
    if ($("#hud-avatar-initial")) $("#hud-avatar-initial").textContent = (p.name[0] || "A").toUpperCase();
    if ($("#sidebar-user-name")) $("#sidebar-user-name").textContent = p.name;
    if ($("#sidebar-subject")) $("#sidebar-subject").textContent = p.subject;
    if ($("#chat-subject-badge")) $("#chat-subject-badge").textContent = p.subject;

    // Sync Timer settings
    STATE.timerSeconds = p.focusMins * 60;
    STATE.timerMax = STATE.timerSeconds;
    STATE.breakSeconds = p.breakMins * 60;
    updateTimerUI();
}

// =====================================================================
// SESSION / SUBJECT MANAGEMENT HELPERS
// =====================================================================
function addSessionIfNew(profile) {
    const key = `${profile.name.toLowerCase()}__${profile.subject.toLowerCase()}`;
    const exists = STATE.sessions.some(
        (s) => s.name.toLowerCase() === profile.name.toLowerCase()
            && s.subject.toLowerCase() === profile.subject.toLowerCase()
    );
    if (!exists) {
        STATE.sessions.push({ ...profile });
        localStorage.setItem("cortex_sessions", JSON.stringify(STATE.sessions));
    }
}

function switchToSession(session) {
    STATE.profile = { ...session };
    localStorage.setItem("cortex_profile", JSON.stringify(STATE.profile));
    applyProfile();
    // Reset brain dump so it loads for new subject
    STATE.bdItems = [];
    toast("Session Switched", `Now studying: ${session.subject} as ${session.name}`, "success");
    playSfx("start");
    // If brain dump tab is active, reload
    if ($("#tab-braindump")?.classList.contains("active")) loadBrainDump();
}

function populateSubjectSwitcher() {
    const sel = $("#sidebar-subject-switcher");
    if (!sel) return;
    sel.innerHTML = `<option value="">— Select Subject —</option>`;
    STATE.sessions.forEach((s, idx) => {
        const active = STATE.profile &&
            s.name.toLowerCase() === STATE.profile.name.toLowerCase() &&
            s.subject.toLowerCase() === STATE.profile.subject.toLowerCase();
        const opt = document.createElement("option");
        opt.value = idx;
        opt.textContent = `${s.name} / ${s.subject}`;
        if (active) opt.selected = true;
        sel.appendChild(opt);
    });

    sel.addEventListener("change", () => {
        const idx = parseInt(sel.value);
        if (!isNaN(idx) && STATE.sessions[idx]) {
            switchToSession(STATE.sessions[idx]);
        }
    });
}

// =====================================================================
// ONBOARDING & CALIBRATION WIZARD CONTROLLER
// =====================================================================
let selectedNotesFile = null;
let currentObStep = 1;

function openOnboardingModal(step = 1) {
    playSfx("click");
    currentObStep = step;
    setObStep(currentObStep);

    // Sync existing profile values into wizard inputs
    if (STATE.profile) {
        const p = STATE.profile;
        if ($("#ob-name")) $("#ob-name").value = p.name || "Anusree";
        if ($("#ob-subject")) $("#ob-subject").value = p.subject || "Machine Learning";
        if ($("#ob-focus-slider")) $("#ob-focus-slider").value = p.focusMins || 25;
        if ($("#ob-focus-dial")) $("#ob-focus-dial").textContent = p.focusMins || 25;
        if ($("#ob-sum-focus")) $("#ob-sum-focus").textContent = `${p.focusMins || 25} MIN`;
        if ($("#ob-break-slider")) $("#ob-break-slider").value = p.breakMins || 5;
        if ($("#ob-break-dial")) $("#ob-break-dial").textContent = p.breakMins || 5;
        if ($("#ob-sum-break")) $("#ob-sum-break").textContent = `${p.breakMins || 5} MIN`;
        if ($("#ob-sum-subject")) $("#ob-sum-subject").textContent = p.subject || "Machine Learning";
        if ($("#ob-exam-type")) $("#ob-exam-type").value = p.examType || "mixed";
        if ($("#ob-style")) $("#ob-style").value = p.style || "theory";

        // Set active preset button highlights
        $$(".ob-preset-btn[data-focus]").forEach((b) => {
            b.classList.toggle("active", parseInt(b.dataset.focus) === (p.focusMins || 25));
        });
        $$(".ob-preset-btn[data-break]").forEach((b) => {
            b.classList.toggle("active", parseInt(b.dataset.break) === (p.breakMins || 5));
        });
    }

    const modal = $("#modal-onboarding");
    if (modal) modal.style.display = "flex";
}

function closeOnboardingModal() {
    playSfx("click");
    const modal = $("#modal-onboarding");
    if (modal) modal.style.display = "none";
}

function setObStep(step) {
    currentObStep = step;

    // Toggle step content views
    for (let i = 1; i <= 4; i++) {
        const content = $(`#ob-step-${i}`);
        const pill = $(`#pill-step-${i}`);
        if (content) content.style.display = (i === step) ? "block" : "none";
        if (pill) {
            pill.classList.toggle("active", i === step);
            pill.classList.toggle("completed", i < step);
        }
    }

    // Prev / Next button states & labels
    const prevBtn = $("#ob-btn-prev");
    const nextBtn = $("#ob-btn-next");
    const nextLabel = $("#ob-next-label");

    if (prevBtn) prevBtn.style.display = (step > 1) ? "inline-flex" : "none";

    if (nextLabel) {
        if (step === 1) nextLabel.textContent = "Next Step: Break Rhythm →";
        else if (step === 2) nextLabel.textContent = "Next Step: Subject & Goals →";
        else if (step === 3) nextLabel.textContent = "Next Step: Upload Notes →";
        else if (step === 4) nextLabel.textContent = "✦ LAUNCH STUDY BUDDY & ARM VISION";
    }
}

function initOnboarding() {
    // Triggers
    $("#hud-onboarding-trigger")?.addEventListener("click", () => openOnboardingModal(1));
    $("#btn-recalibrate-sidebar")?.addEventListener("click", () => openOnboardingModal(1));
    $("#btn-close-onboarding")?.addEventListener("click", closeOnboardingModal);

    // Step Tracker Pills click
    $$(".ob-step-pill").forEach((pill) => {
        pill.addEventListener("click", () => {
            playSfx("click");
            const step = parseInt(pill.dataset.step);
            if (step) setObStep(step);
        });
    });

    // Step 1: Focus Slider & Presets
    const focusSlider = $("#ob-focus-slider");
    const focusDial = $("#ob-focus-dial");
    const sumFocus = $("#ob-sum-focus");

    focusSlider?.addEventListener("input", () => {
        const val = parseInt(focusSlider.value) || 25;
        if (focusDial) focusDial.textContent = val;
        if (sumFocus) sumFocus.textContent = `${val} MIN`;
        $$(".ob-preset-btn[data-focus]").forEach((b) => {
            b.classList.toggle("active", parseInt(b.dataset.focus) === val);
        });
    });

    $$(".ob-preset-btn[data-focus]").forEach((btn) => {
        btn.addEventListener("click", () => {
            playSfx("click");
            const val = parseInt(btn.dataset.focus);
            if (focusSlider) focusSlider.value = val;
            if (focusDial) focusDial.textContent = val;
            if (sumFocus) sumFocus.textContent = `${val} MIN`;
            $$(".ob-preset-btn[data-focus]").forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
        });
    });

    // Step 2: Break Slider & Presets
    const breakSlider = $("#ob-break-slider");
    const breakDial = $("#ob-break-dial");
    const sumBreak = $("#ob-sum-break");

    breakSlider?.addEventListener("input", () => {
        const val = parseInt(breakSlider.value) || 5;
        if (breakDial) breakDial.textContent = val;
        if (sumBreak) sumBreak.textContent = `${val} MIN`;
        $$(".ob-preset-btn[data-break]").forEach((b) => {
            b.classList.toggle("active", parseInt(b.dataset.break) === val);
        });
    });

    $$(".ob-preset-btn[data-break]").forEach((btn) => {
        btn.addEventListener("click", () => {
            playSfx("click");
            const val = parseInt(btn.dataset.break);
            if (breakSlider) breakSlider.value = val;
            if (breakDial) breakDial.textContent = val;
            if (sumBreak) sumBreak.textContent = `${val} MIN`;
            $$(".ob-preset-btn[data-break]").forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
        });
    });

    // Step 3: Identity & Subject Live Sync
    const nameInput = $("#ob-name");
    const subjectInput = $("#ob-subject");
    const sumSubject = $("#ob-sum-subject");

    subjectInput?.addEventListener("input", () => {
        if (sumSubject) sumSubject.textContent = subjectInput.value.trim() || "General Notes";
    });

    // Step 4: Notes Upload Handling
    const dropzone = $("#ob-dropzone");
    const fileInput = $("#ob-file-input");
    const browseBtn = $("#ob-btn-browse");
    const dropInner = $("#ob-dropzone-trigger");
    const selectedBox = $("#ob-file-selected");
    const fileNameEl = $("#ob-file-name");
    const fileSizeEl = $("#ob-file-size");
    const removeBtn = $("#ob-file-remove");

    browseBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        fileInput?.click();
    });

    dropzone?.addEventListener("click", () => fileInput?.click());

    dropzone?.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropzone.classList.add("dragover");
    });

    ["dragleave", "drop"].forEach((ev) => {
        dropzone?.addEventListener(ev, () => dropzone.classList.remove("dragover"));
    });

    dropzone?.addEventListener("drop", (e) => {
        e.preventDefault();
        if (e.dataTransfer?.files?.length) {
            handleSelectedObFile(e.dataTransfer.files[0]);
        }
    });

    fileInput?.addEventListener("change", () => {
        if (fileInput.files?.length) {
            handleSelectedObFile(fileInput.files[0]);
        }
    });

    removeBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        selectedNotesFile = null;
        if (fileInput) fileInput.value = "";
        if (selectedBox) selectedBox.style.display = "none";
        if (dropInner) dropInner.style.display = "block";
    });

    function handleSelectedObFile(file) {
        selectedNotesFile = file;
        playSfx("click");
        if (fileNameEl) fileNameEl.textContent = file.name;
        if (fileSizeEl) fileSizeEl.textContent = `${(file.size / (1024 * 1024)).toFixed(2)} MB`;
        if (dropInner) dropInner.style.display = "none";
        if (selectedBox) selectedBox.style.display = "flex";
    }

    // Skip notes button
    $("#ob-btn-skip-notes")?.addEventListener("click", () => {
        selectedNotesFile = null;
        finishOnboardingAndLaunch();
    });

    // Step Navigation Buttons
    $("#ob-btn-prev")?.addEventListener("click", () => {
        playSfx("click");
        if (currentObStep > 1) setObStep(currentObStep - 1);
    });

    $("#ob-btn-next")?.addEventListener("click", () => {
        playSfx("click");
        if (currentObStep < 4) {
            setObStep(currentObStep + 1);
        } else {
            finishOnboardingAndLaunch();
        }
    });

    // Check first launch
    const onboarded = localStorage.getItem("cortex_onboarded");
    if (!onboarded) {
        // Automatically trigger onboarding wizard on first launch!
        setTimeout(() => {
            openOnboardingModal(1);
        }, 600);
    }
}

async function finishOnboardingAndLaunch() {
    const name = $("#ob-name")?.value.trim() || "Student";
    const subject = $("#ob-subject")?.value.trim() || "General";
    const focusMins = parseInt($("#ob-focus-slider")?.value) || 25;
    const breakMins = parseInt($("#ob-break-slider")?.value) || 5;
    const examType = $("#ob-exam-type")?.value || "mixed";
    const style = $("#ob-style")?.value || "theory";

    const scopedSubject = `${name.toLowerCase().replace(/[^a-z0-9]/g, "")}__${subject.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;

    const profileData = {
        name,
        subject,
        scopedSubject,
        focusMins,
        breakMins,
        examType,
        style,
    };

    STATE.profile = profileData;
    localStorage.setItem("cortex_profile", JSON.stringify(profileData));
    localStorage.setItem("cortex_onboarded", "true");
    addSessionIfNew(profileData);
    populateSubjectSwitcher();
    applyProfile();

    // If a note file was selected, upload and ingest it!
    if (selectedNotesFile) {
        const progressBox = $("#ob-upload-progress");
        const progressBar = $("#ob-upload-bar-fill");
        const statusText = $("#ob-upload-status-text");
        const pctText = $("#ob-upload-pct");

        if (progressBox) progressBox.style.display = "block";

        // Simulate animated upload progress
        let p = 0;
        const pTimer = setInterval(() => {
            p = Math.min(92, p + 12);
            if (progressBar) progressBar.style.width = `${p}%`;
            if (pctText) pctText.textContent = `${p}%`;
        }, 120);

        const formData = new FormData();
        formData.append("file", selectedNotesFile);
        formData.append("user_name", name);
        formData.append("student_name", name);
        formData.append("subject_name", subject);

        try {
            const res = await fetch("/upload-notes", {
                method: "POST",
                body: formData,
            });
            clearInterval(pTimer);

            if (progressBar) progressBar.style.width = "100%";
            if (pctText) pctText.textContent = "100%";
            if (statusText) statusText.textContent = "Ingestion Complete! Vector chunks ready.";

            const data = await res.json();
            toast("Notes Ingested!", `Indexed ${data.chunks_count || data.chunks || 'syllabus'} chunks for ${subject}.`, "badge");
            playSfx("badge");
        } catch (err) {
            clearInterval(pTimer);
            console.warn("Notes upload warning:", err);
            toast("Upload Queued", `Document saved for ${subject}.`, "info");
        }
    }

    // Sync profile to backend
    api("POST", "/profiles", {
        name,
        student_name: name,
        focus_minutes: focusMins,
        focus_duration: focusMins,
        break_minutes: breakMins,
        break_duration: breakMins,
        exam_type: examType,
        question_style: style,
        subject_name: subject,
    }).catch(() => { });

    // Close onboarding modal and celebrate
    closeOnboardingModal();
    playSfx("start");
    toast("Study Buddy Armed!", `Focus sprint set to ${focusMins}m, break interval ${breakMins}m. Optical vision ready!`, "badge");

    // Activate Study Room tab
    const studyTabBtn = $(`#nav-btn-study`);
    if (studyTabBtn) studyTabBtn.click();
}

// =====================================================================
// SUBJECTS TAB RENDERER
// =====================================================================
function initSubjectsTab() {
    $("#btn-add-subject")?.addEventListener("click", () => {
        playSfx("click");
        const card = $("#card-add-subject");
        if (card) card.style.display = card.style.display === "none" ? "block" : "none";
    });

    $("#btn-cancel-add-subject")?.addEventListener("click", () => {
        const card = $("#card-add-subject");
        if (card) card.style.display = "none";
    });

    $("#form-add-subject")?.addEventListener("submit", (e) => {
        e.preventDefault();
        playSfx("click");
        const name = $("#ns-name").value.trim() || "Student";
        const subject = $("#ns-subject").value.trim() || "General";
        const scopedSubject = `${name.toLowerCase().replace(/[^a-z0-9]/g, "")}__${subject.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;

        const newSession = {
            name,
            subject,
            scopedSubject,
            focusMins: STATE.profile?.focusMins || 25,
            breakMins: STATE.profile?.breakMins || 5,
            examType: STATE.profile?.examType || "mixed",
            style: STATE.profile?.style || "theory",
        };

        addSessionIfNew(newSession);
        switchToSession(newSession);
        populateSubjectSwitcher();
        renderSubjectsSessions();

        $("#ns-name").value = "";
        $("#ns-subject").value = "";
        $("#card-add-subject").style.display = "none";
        toast("Subject Created", `'${subject}' vault initialized for ${name}`, "success");
    });
}

function renderSubjectsSessions() {
    const grid = $("#subjects-sessions-grid");
    if (!grid) return;

    if (!STATE.sessions.length) {
        grid.innerHTML = `
      <div class="cortex-card" style="text-align:center;padding:2.5rem 1rem;">
        <span class="star-accent" style="font-size:2rem;">✦</span>
        <h4 style="margin:0.5rem 0 0.25rem;">No Subject Sessions Yet</h4>
        <p class="text-sm text-muted">Click "+ New Subject" to create an isolated knowledge vault for each subject you study.</p>
      </div>`;
        return;
    }

    grid.innerHTML = STATE.sessions.map((s, idx) => {
        const isActive = STATE.profile &&
            s.name.toLowerCase() === STATE.profile.name.toLowerCase() &&
            s.subject.toLowerCase() === STATE.profile.subject.toLowerCase();
        return `
      <div class="cortex-card subject-session-card ${isActive ? "active-session" : ""}" data-idx="${idx}">
        <span class="hud-bracket b-tl"></span>
        <span class="hud-bracket b-tr"></span>
        <div class="subject-card-top">
          <div>
            <div class="subject-card-name mono-code">${escHtml(s.name)}</div>
            <div class="subject-card-subject">${escHtml(s.subject)}</div>
            <div class="mono-xs text-muted" style="margin-top:0.25rem;">VAULT: ${escHtml(s.scopedSubject)}</div>
          </div>
          <div style="display:flex;gap:0.5rem;align-items:center;">
            ${isActive
                ? `<span class="mono-badge cyan">ACTIVE</span>`
                : `<button class="cortex-btn btn-sm btn-glow-purple switch-session-btn" data-idx="${idx}">Switch</button>`
            }
            <button class="cortex-btn btn-xs btn-ghost-cyber delete-session-btn" data-idx="${idx}" title="Remove session">✕</button>
          </div>
        </div>
        <div class="subject-card-meta mono-xs">
          <span>Focus: ${s.focusMins || 25}min</span>
          <span>Break: ${s.breakMins || 5}min</span>
          <span>Exam: ${s.examType || "mixed"}</span>
        </div>
      </div>`;
    }).join("");

    // Switch session
    $$(`.switch-session-btn`).forEach((btn) => {
        btn.addEventListener("click", () => {
            const idx = parseInt(btn.dataset.idx);
            if (STATE.sessions[idx]) {
                switchToSession(STATE.sessions[idx]);
                populateSubjectSwitcher();
                renderSubjectsSessions();
            }
        });
    });

    // Delete session
    $$(`.delete-session-btn`).forEach((btn) => {
        btn.addEventListener("click", () => {
            playSfx("click");
            const idx = parseInt(btn.dataset.idx);
            const removed = STATE.sessions[idx];
            // Don't allow deleting active session
            if (STATE.profile &&
                removed.name.toLowerCase() === STATE.profile.name.toLowerCase() &&
                removed.subject.toLowerCase() === STATE.profile.subject.toLowerCase()) {
                toast("Cannot Delete", "Switch to another session first before removing the active one.", "error");
                return;
            }
            STATE.sessions.splice(idx, 1);
            localStorage.setItem("cortex_sessions", JSON.stringify(STATE.sessions));
            populateSubjectSwitcher();
            renderSubjectsSessions();
            toast("Session Removed", `${removed.subject} vault entry removed.`, "info");
        });
    });
}

// =====================================================================
// BULLETPROOF NOTES UPLOAD (Click + Drag & Drop)
// =====================================================================
function initUpload() {
    const fileInput = $("#quick-upload-input");
    const triggerBtn = $("#btn-trigger-upload");
    const dropzone = $("#chat-dropzone");
    const chatCard = $("#card-ai-doubt-solver");

    if (triggerBtn && fileInput) {
        triggerBtn.addEventListener("click", () => {
            playSfx("click");
            fileInput.click();
        });
    }

    // File picker handler — supports multiple files
    fileInput?.addEventListener("change", async () => {
        const files = Array.from(fileInput.files);
        if (files.length) {
            for (const file of files) {
                await handleFileUpload(file);
            }
        }
        fileInput.value = ""; // Reset for re-selection
    });

    // Drag & drop handlers
    if (chatCard && dropzone) {
        ["dragenter", "dragover"].forEach((evt) => {
            chatCard.addEventListener(evt, (e) => {
                e.preventDefault();
                dropzone.classList.add("active");
            });
        });

        ["dragleave", "drop"].forEach((evt) => {
            chatCard.addEventListener(evt, (e) => {
                e.preventDefault();
                dropzone.classList.remove("active");
            });
        });

        chatCard.addEventListener("drop", async (e) => {
            e.preventDefault();
            dropzone.classList.remove("active");
            if (e.dataTransfer && e.dataTransfer.files.length) {
                const droppedFiles = Array.from(e.dataTransfer.files);
                for (const file of droppedFiles) {
                    await handleFileUpload(file);
                }
            }
        });
    }
}

async function handleFileUpload(file) {
    if (!file) return;

    const wrap = $("#upload-progress-wrap");
    const fill = $("#upload-bar-fill");
    const label = $("#upload-bar-label");
    const pct = $("#upload-bar-pct");

    if (wrap) wrap.style.display = "block";
    if (label) label.textContent = `Ingesting "${file.name}" into ChromaDB vector store...`;
    if (fill) fill.style.width = "0%";
    if (pct) pct.textContent = "0%";

    // Simulated progress while backend processes embeddings
    let prog = 0;
    const progressTimer = setInterval(() => {
        if (prog < 88) {
            prog += Math.floor(Math.random() * 12) + 4;
            if (prog > 88) prog = 88;
            if (fill) fill.style.width = `${prog}%`;
            if (pct) pct.textContent = `${prog}%`;
        }
    }, 350);

    try {
        const user = STATE.profile?.name || "Student";
        const subject = STATE.profile?.subject || "General";

        const formData = new FormData();
        formData.append("file", file);
        formData.append("user_name", user);
        formData.append("student_name", user);
        formData.append("subject_name", subject);

        // Call backend endpoint
        const res = await fetch("/notes/upload", {
            method: "POST",
            body: formData,
        });

        clearInterval(progressTimer);

        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.detail || `Upload error HTTP ${res.status}`);
        }

        const data = await res.json();
        const count = data.chunks_count || data.chunks || 1;

        if (fill) fill.style.width = "100%";
        if (pct) pct.textContent = "100%";
        if (label) label.textContent = `✓ Ingested ${count} knowledge chunks from "${file.name}"`;

        playSfx("badge");
        toast("Notes Ingested Successfully", `${count} chunks vectorized into your brain store`, "success");

        appendBotMsg(
            `I've successfully indexed **"${file.name}"** (${count} chunks)! You can now ask me any specific doubts or click **Quiz Arena** to generate questions. 🧠`,
            "NOTES INGESTED",
            "source-notes"
        );

        // Auto-refresh Brain Dump vault to display extracted high-yield concepts
        loadBrainDump();

        setTimeout(() => {
            if (wrap) wrap.style.display = "none";
        }, 4500);
    } catch (err) {
        clearInterval(progressTimer);
        if (fill) fill.style.width = "100%";
        if (pct) pct.textContent = "FAILED";
        if (label) label.textContent = `✕ Ingestion error: ${err.message}`;
        playSfx("alert");
        toast("Upload Failed", err.message, "error");
        setTimeout(() => {
            if (wrap) wrap.style.display = "none";
        }, 5000);
    }
}

// =====================================================================
// AI DOUBT SOLVER CHAT
// =====================================================================
function initChat() {
    const form = $("#form-ask-doubt");
    const input = $("#doubt-input");

    form?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const query = input.value.trim();
        if (!query) return;

        input.value = "";
        playSfx("click");
        appendUserMsg(query);

        const typingEl = appendTypingIndicator();

        try {
            const user = STATE.profile?.name || "Student";
            const subject = STATE.profile?.subject || "General";

            const res = await api("POST", "/doubts/ask", {
                question: query,
                user_name: user,
                student_name: user,
                subject_name: subject,
            });

            typingEl.remove();

            const sourceLabel = res.source === "notes" ? "📖 FROM YOUR NOTES" : "🌐 GENERAL KNOWLEDGE";
            const sourceClass = res.source === "notes" ? "source-notes" : "";

            appendBotMsg(res.answer, sourceLabel, sourceClass, res.passages || res.note_passages);
            playSfx("click");
        } catch (err) {
            typingEl.remove();
            playSfx("alert");
            appendBotMsg(`Sorry, error querying AI study model: ${err.message}`, "SYSTEM ERROR", "source-notes");
        }
    });

    // Prompt suggestion chips
    $$(".prompt-chip").forEach((chip) => {
        chip.addEventListener("click", () => {
            const p = chip.dataset.prompt;
            if (input && p) {
                input.value = p;
                input.focus();
                playSfx("click");
            }
        });
    });
}

function appendUserMsg(text) {
    const feed = $("#chat-feed");
    if (!feed) return;
    const row = document.createElement("div");
    row.className = "msg-row user-row";
    row.innerHTML = `
    <div class="msg-avatar-col">
      <div class="user-avatar-tag">${(STATE.profile?.name[0] || "U").toUpperCase()}</div>
    </div>
    <div class="msg-bubble user-bubble">
      <div class="bubble-meta">
        <span class="bubble-tag mono-code">YOU</span>
        <span class="bubble-time mono-code">${nowHHMM()}</span>
      </div>
      <div class="bubble-body"><p>${escHtml(text)}</p></div>
    </div>`;
    feed.appendChild(row);
    feed.scrollTop = feed.scrollHeight;
}

function appendBotMsg(text, tag = "CORTEX AI", tagClass = "", passages = []) {
    const feed = $("#chat-feed");
    if (!feed) return;
    const row = document.createElement("div");
    row.className = "msg-row bot-row";

    // Markdown bullet formatting
    let formatted = escHtml(text)
        .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.*?)\*/g, "<em>$1</em>")
        .replace(/`(.*?)`/g, "<code style='background:rgba(255,255,255,0.1);padding:1px 4px;border-radius:3px;'>$1</code>")
        .replace(/\n\n/g, "</p><p>")
        .replace(/\n/g, "<br>");

    let passagesHtml = "";
    if (passages && passages.length) {
        passagesHtml = `
      <details class="note-passage-fold">
        <summary>📖 View verified source citations (${passages.length})</summary>
        ${passages.map((p) => `<p>${escHtml(p)}</p>`).join("")}
      </details>`;
    }

    row.innerHTML = `
    <div class="msg-avatar-col">
      <div class="cortex-bot-avatar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="12 2 2 7 12 12 22 7 12 2"/>
          <polyline points="2 17 12 22 22 17"/>
          <polyline points="2 12 12 17 22 12"/>
        </svg>
      </div>
    </div>
    <div class="msg-bubble bot-bubble">
      <div class="bubble-meta">
        <span class="bubble-tag mono-code ${tagClass}">${tag}</span>
        <span class="bubble-time mono-code">${nowHHMM()}</span>
      </div>
      <div class="bubble-body">
        <p>${formatted}</p>
        ${passagesHtml}
      </div>
    </div>`;

    feed.appendChild(row);
    feed.scrollTop = feed.scrollHeight;
    return row;
}

function appendTypingIndicator() {
    const feed = $("#chat-feed");
    const row = document.createElement("div");
    row.className = "msg-row bot-row";
    row.innerHTML = `
    <div class="msg-avatar-col">
      <div class="cortex-bot-avatar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="12 2 2 7 12 12 22 7 12 2"/>
        </svg>
      </div>
    </div>
    <div class="msg-bubble bot-bubble">
      <div class="typing-dots-pill">
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
      </div>
    </div>`;
    feed.appendChild(row);
    feed.scrollTop = feed.scrollHeight;
    return row;
}

// =====================================================================
// DYNAMIC ADHD ENCOURAGEMENT ENGINE (WORDS OF ENCOURAGEMENT)
// =====================================================================
const ENCOURAGEMENTS = [
  "🧠 High focus unlocked. Progress over perfection.",
  "⚡ Every recall attempt builds stronger synaptic pathways.",
  "✨ Making mistakes is the #1 way your brain learns. Level up!",
  "🎯 Small consistent focus sprints lead to massive exam breakthroughs.",
  "💡 You don't have to be perfect; you just have to stay curious.",
  "🚀 Take a deep breath. You are mastering this material step-by-step.",
  "🔥 Your ADHD brain has immense hyperfocus potential. Harness it!",
  "🌟 Every question you answer today builds bulletproof confidence tomorrow.",
  "🛡️ Reviewing your mistakes transforms weaknesses into your greatest strengths.",
  "✦ Be proud of yourself for showing up today and doing the work."
];

function initEncouragementEngine() {
  const tickerEl = $("#encouragement-ticker-text");
  if (!tickerEl) return;

  function cycleEncouragement() {
    STATE.encouragementIndex = (STATE.encouragementIndex + 1) % ENCOURAGEMENTS.length;
    tickerEl.style.opacity = "0";
    tickerEl.style.transform = "translateY(-4px)";
    setTimeout(() => {
      tickerEl.textContent = ENCOURAGEMENTS[STATE.encouragementIndex];
      tickerEl.style.opacity = "1";
      tickerEl.style.transform = "translateY(0)";
    }, 400);
  }

  if (STATE.encouragementTimer) clearInterval(STATE.encouragementTimer);
  STATE.encouragementTimer = setInterval(cycleEncouragement, 18000);
}

// =====================================================================
// STUDY NOTES CONTROLLER (COMPREHENSIVE CONCEPTUAL GUIDES)
// =====================================================================
function initStudyNotes() {
  // Generate button handlers
  const genBtn = $("#btn-generate-notes");
  const emptyGenBtn = $("#btn-generate-notes-empty");

  const handleGenerate = async () => {
    playSfx("click");
    const user = STATE.profile?.name || "Student";
    const subject = STATE.profile?.subject || "General";
    const topic = ($("#notes-topic-input")?.value || "").trim();

    const loadingState = $("#notes-loading-state");
    const emptyState = $("#notes-empty-state");
    const viewerCard = $("#notes-viewer-card");

    if (emptyState) emptyState.style.display = "none";
    if (viewerCard) viewerCard.style.display = "none";
    if (loadingState) loadingState.style.display = "block";

    // Dynamic loading encouragement
    const quoteEl = $("#notes-loading-quote");
    if (quoteEl) {
      const quotes = [
        "Synthesizing core analogies and foundational intuition...",
        "Structuring formulas, contrasts, and high-yield exam takeaways...",
        "Mastery is built layer-by-layer. You've got this!"
      ];
      let qIdx = 0;
      const qInterval = setInterval(() => {
        qIdx = (qIdx + 1) % quotes.length;
        if (quoteEl) quoteEl.textContent = quotes[qIdx];
      }, 4000);
      loadingState.dataset.quoteInterval = qInterval;
    }

    try {
      const res = await api("POST", "/study-notes/generate", {
        user_name: user,
        subject_name: subject,
        topic: topic,
      });

      if (loadingState?.dataset?.quoteInterval) {
        clearInterval(parseInt(loadingState.dataset.quoteInterval));
      }
      if (loadingState) loadingState.style.display = "none";

      if (res && res.note) {
        STATE.currentStudyNotes = res.note;
        renderStudyNotes(res.note);
        saveCurrentSubjectState();
        playSfx("badge");
        toast("Study Notes Ready", `Generated master guide for ${subject}`, "success");
      } else {
        throw new Error("No notes content returned.");
      }
    } catch (err) {
      if (loadingState?.dataset?.quoteInterval) {
        clearInterval(parseInt(loadingState.dataset.quoteInterval));
      }
      if (loadingState) loadingState.style.display = "none";
      if (emptyState) emptyState.style.display = "block";
      playSfx("alert");
      toast("Notes Generation Error", err.message, "error");
    }
  };

  genBtn?.addEventListener("click", handleGenerate);
  emptyGenBtn?.addEventListener("click", handleGenerate);

  // Copy Markdown Button
  $("#btn-copy-notes")?.addEventListener("click", () => {
    if (!STATE.currentStudyNotes) return;
    const note = STATE.currentStudyNotes;
    const fullText = `# ${note.title}\n\n## Executive Summary\n${note.summary}\n\n## Key Concepts\n${(note.key_concepts || []).map(c => `- ${c}`).join('\n')}\n\n${note.content}`;
    navigator.clipboard.writeText(fullText).then(() => {
      playSfx("click");
      toast("Copied to Clipboard", "Full study guide copied formatted in markdown", "success");
    }).catch(() => {
      toast("Copy Failed", "Please manually copy the notes", "error");
    });
  });

  // Print Button
  $("#btn-print-notes")?.addEventListener("click", () => {
    playSfx("click");
    window.print();
  });
}

async function loadStudyNotesForSubject() {
  const user = STATE.profile?.name || "Student";
  const subject = STATE.profile?.subject || "General";

  const subjBadge = $("#notes-current-subject");
  if (subjBadge) subjBadge.textContent = `SUBJECT: ${subject.toUpperCase()}`;

  // Check if we already have it in STATE
  if (STATE.currentStudyNotes && STATE.currentStudyNotes.subject?.toLowerCase() === subject.toLowerCase()) {
    renderStudyNotes(STATE.currentStudyNotes);
    return;
  }

  try {
    const res = await api("GET", `/study-notes?user_name=${encodeURIComponent(user)}&subject_name=${encodeURIComponent(subject)}`);
    if (res && res.latest_note) {
      STATE.currentStudyNotes = res.latest_note;
      renderStudyNotes(res.latest_note);
    } else {
      STATE.currentStudyNotes = null;
      $("#notes-loading-state").style.display = "none";
      $("#notes-viewer-card").style.display = "none";
      $("#notes-empty-state").style.display = "block";
    }
  } catch (err) {
    console.warn("Could not fetch study notes:", err);
    $("#notes-loading-state").style.display = "none";
    $("#notes-viewer-card").style.display = "none";
    $("#notes-empty-state").style.display = "block";
  }
}

function renderStudyNotes(note) {
  if (!note) return;
  const loadingState = $("#notes-loading-state");
  const emptyState = $("#notes-empty-state");
  const viewerCard = $("#notes-viewer-card");

  if (loadingState) loadingState.style.display = "none";
  if (emptyState) emptyState.style.display = "none";
  if (viewerCard) viewerCard.style.display = "block";

  const titleEl = $("#notes-doc-title");
  const tagEl = $("#notes-doc-subject-tag");
  const dateEl = $("#notes-doc-date");
  const summaryEl = $("#notes-summary-text");
  const conceptsRow = $("#notes-concepts-pills");
  const bodyEl = $("#notes-markdown-container");

  if (titleEl) titleEl.textContent = note.title || "Master Study Guide";
  if (tagEl) tagEl.textContent = (note.subject || "GENERAL").toUpperCase();
  if (dateEl) {
    const d = note.created_at ? new Date(note.created_at).toLocaleDateString() : "Active Sprint";
    dateEl.textContent = `Saved: ${d}`;
  }
  if (summaryEl) summaryEl.textContent = note.summary || "No executive summary available.";

  // Render Key Concepts Pills
  if (conceptsRow) {
    const concepts = note.key_concepts || [];
    conceptsRow.innerHTML = concepts.map(c => `
      <span class="notes-pill">✦ ${escHtml(c)}</span>
    `).join("") || '<span class="text-xs text-muted">Core foundations listed in notes below</span>';
  }

  // Render Markdown Body cleanly
  if (bodyEl) {
    bodyEl.innerHTML = formatMarkdown(note.content || "");
  }

  // Bottom encouragement quote
  const quoteEl = $("#notes-bottom-quote");
  if (quoteEl) {
    const quotes = [
      "True mastery comes from understanding why things work, not just memorizing that they do.",
      "Reviewing these core principles will give you unshakable confidence in the exam hall.",
      "You have an extraordinary mind. Keep reinforcing these mental models!"
    ];
    quoteEl.textContent = `"${quotes[Math.floor(Math.random() * quotes.length)]}"`;
  }
}

function formatMarkdown(md) {
  if (!md) return "";
  let html = escHtml(md);

  // Headers
  html = html.replace(/^### (.*$)/gim, "<h3>$1</h3>");
  html = html.replace(/^## (.*$)/gim, "<h2>$1</h2>");
  html = html.replace(/^# (.*$)/gim, "<h1>$1</h1>");

  // Bold & Italic
  html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.*?)\*/g, "<em>$1</em>");

  // Code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Blockquotes
  html = html.replace(/^> (.*$)/gim, "<blockquote>$1</blockquote>");

  // Unordered list items
  html = html.replace(/^[-*] (.*$)/gim, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>)/gims, "<ul>$1</ul>");
  // Clean multiple uls
  html = html.replace(/<\/ul>\s*<ul>/g, "");

  // Paragraph breaks
  html = html.replace(/\n\n+/g, "</p><p>");
  html = html.replace(/\n/g, "<br>");
  return `<p>${html}</p>`;
}


// =====================================================================
// ADAPTIVE QUIZ ARENA (5, 10, 15 QUESTIONS)
// =====================================================================
function initQuizArena() {
    const form = $("#form-quiz");
    const cancelBtn = $("#btn-cancel-quiz");
    const submitBtn = $("#btn-submit-quiz");

    form?.addEventListener("submit", async (e) => {
        e.preventDefault();
        playSfx("click");

        const quizType = document.querySelector('input[name="quiz_type"]:checked')?.value || "objective";
        const numQ = parseInt(document.querySelector('input[name="num_q"]:checked')?.value || 5);
        const topic = $("#quiz-topic").value.trim();

        const genBtn = $("#btn-gen-quiz");
        if (genBtn) {
            genBtn.disabled = true;
            genBtn.innerHTML = '<span class="btn-chrome-text">⚡ GENERATING LIVE QUESTIONS...</span>';
        }

        try {
            const user = STATE.profile?.name || "Student";
            const subject = STATE.profile?.subject || "General";
            const style = STATE.profile?.style || "theory";

            const data = await api("POST", "/quiz/generate", {
                user_name: user,
                student_name: user,
                subject_name: subject,
                quiz_type: quizType,
                num_questions: numQ,
                topic: topic,
                style: style,
            });

            STATE.quizId = data.quiz_id;
            STATE.quizData = data.questions || [];
            STATE.quizAnswers = {};

            if (!STATE.quizData || STATE.quizData.length === 0) {
                throw new Error("No questions returned. Upload notes first so Cortex can extract material!");
            }

            playSfx("start");
            renderActiveQuiz(quizType, data.review_questions || 0);
        } catch (err) {
            playSfx("alert");
            toast("Quiz Generation Failed", err.message, "error");
        } finally {
            if (genBtn) {
                genBtn.disabled = false;
                genBtn.innerHTML = '<span class="btn-chrome-text">⚡ GENERATE ADAPTIVE QUIZ</span>';
            }
        }
    });

    cancelBtn?.addEventListener("click", () => {
        playSfx("click");
        $("#quiz-setup-panel").style.display = "block";
        $("#quiz-active-panel").style.display = "none";
        $("#quiz-results-panel").style.display = "none";
        STATE.quizId = null;
        STATE.quizData = null;
        STATE.quizAnswers = {};
    });

    submitBtn?.addEventListener("click", submitQuiz);
}

function renderActiveQuiz(quizType, reviewCount = 0) {
    const setupPanel = $("#quiz-setup-panel");
    const activePanel = $("#quiz-active-panel");
    const resultsPanel = $("#quiz-results-panel");
    const list = $("#quiz-questions-list");

    if (setupPanel) setupPanel.style.display = "none";
    if (activePanel) activePanel.style.display = "block";
    if (resultsPanel) resultsPanel.style.display = "none";

    // Badges
    const typeBadge = $("#q-type-badge");
    const revBadge = $("#q-review-badge");
    if (typeBadge) typeBadge.textContent = quizType.toUpperCase();
    if (revBadge) {
        if (reviewCount > 0) {
            revBadge.style.display = "inline-flex";
            revBadge.textContent = `${reviewCount} SM-2 REVISION`;
        } else {
            revBadge.style.display = "none";
        }
    }

    updateQuizProgressBar(0, STATE.quizData.length);
    if (!list) return;
    list.innerHTML = "";

    STATE.quizData.forEach((q, idx) => {
        const card = document.createElement("div");
        card.className = "q-block";
        card.dataset.index = idx;

        let content = `
      <div class="q-header-row">
        <span class="q-num-tag">[ QUESTION ${String(idx + 1).padStart(2, "0")} ]</span>
        ${q.is_revision ? '<span class="mono-badge amber">SM-2 DUE</span>' : ""}
      </div>
      <div class="q-text-body">${escHtml(q.question)}</div>`;

        if (quizType === "objective" && q.options && q.options.length) {
            content += `<div class="q-options-grid">`;
            q.options.forEach((opt, optIdx) => {
                const letter = String.fromCharCode(65 + optIdx);
                content += `
          <div class="q-option-row" data-qidx="${idx}" data-optidx="${optIdx}">
            <div class="q-opt-marker">${letter}</div>
            <div class="q-opt-text">${escHtml(opt)}</div>
          </div>`;
            });
            content += `</div>`;
        } else {
            content += `
        <textarea class="q-theory-textarea" rows="3" placeholder="Type your conceptual explanation here..." data-qidx="${idx}"></textarea>`;
        }

        card.innerHTML = content;
        list.appendChild(card);
    });

    // Attach selection listeners
    $$(".q-option-row").forEach((optRow) => {
        optRow.addEventListener("click", () => {
            playSfx("click");
            const qIdx = parseInt(optRow.dataset.qidx);
            const optIdx = parseInt(optRow.dataset.optidx);

            $$(`.q-option-row[data-qidx="${qIdx}"]`).forEach((r) => r.classList.remove("selected"));
            optRow.classList.add("selected");

            STATE.quizAnswers[qIdx] = optIdx;
            updateQuizProgressBar(Object.keys(STATE.quizAnswers).length, STATE.quizData.length);
        });
    });

    $$(".q-theory-textarea").forEach((ta) => {
        ta.addEventListener("input", () => {
            const qIdx = parseInt(ta.dataset.qidx);
            STATE.quizAnswers[qIdx] = ta.value.trim();
            updateQuizProgressBar(Object.keys(STATE.quizAnswers).length, STATE.quizData.length);
        });
    });
}

function updateQuizProgressBar(done, total) {
    const pct = total ? Math.round((done / total) * 100) : 0;
    const fill = $("#quiz-prog-fill");
    const lbl = $("#quiz-prog-label");
    if (fill) fill.style.width = `${pct}%`;
    if (lbl) lbl.textContent = `${done} / ${total} ANSWERED`;
}

async function submitQuiz() {
  if (!STATE.quizData) return;

  const submitBtn = $("#btn-submit-quiz");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Grading Submissions...";
  }

  try {
    const user = STATE.profile?.name || "Student";
    const subject = STATE.profile?.subject || "General";

    const answersList = STATE.quizData.map((q, i) => {
      return STATE.quizAnswers[i] !== undefined ? STATE.quizAnswers[i] : null;
    });

    const submissionsPayload = STATE.quizData.map((q, i) => {
      let ans = STATE.quizAnswers[i];
      if (typeof ans === "number" && q.options) ans = q.options[ans];
      return {
        question: q.question,
        answer: ans || "",
        is_revision: q.is_revision || false,
      };
    });

    const result = await api("POST", "/quiz/submit", {
      quiz_id: STATE.quizId,
      user_name: user,
      subject_name: subject,
      answers: answersList,
      submissions: submissionsPayload,
    });

    STATE.lastQuizResult = result;

    // Track multiple attempts for this quiz
    const qid = STATE.quizId || "current";
    if (!STATE.quizAttempts[qid]) STATE.quizAttempts[qid] = [];
    const attemptNum = STATE.quizAttempts[qid].length + 1;
    STATE.quizAttempts[qid].push({
      attempt: attemptNum,
      score: result.score,
      max_score: result.max_score,
      percentage: result.percentage,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      results: result.results || result.feedback || []
    });

    playSfx(result.score > 0 ? "badge" : "click");
    renderQuizResults(result);

    // Save subject state and refresh brain dump so pinned mistakes appear immediately
    saveCurrentSubjectState();
    loadBrainDump();

    if (result.mistakes_pinned_to_vault > 0) {
      toast("Mistakes Pinned", `${result.mistakes_pinned_to_vault} missed concepts pinned to Brain Dump as top priority!`, "warning");
    }
  } catch (err) {
    playSfx("alert");
    toast("Grading Error", err.message, "error");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit & Grade Answers →";
    }
  }
}

function retakeCurrentQuiz() {
  if (!STATE.quizData || !STATE.quizData.length) {
    toast("No Active Quiz", "Please generate a quiz sprint first.", "info");
    return;
  }
  playSfx("click");
  // Reset answers
  STATE.quizAnswers = {};

  const setupPanel = $("#quiz-setup-panel");
  const activePanel = $("#quiz-active-panel");
  const resultsPanel = $("#quiz-results-panel");

  if (setupPanel) setupPanel.style.display = "none";
  if (resultsPanel) resultsPanel.style.display = "none";
  if (activePanel) activePanel.style.display = "block";

  // Re-render questions cleanly with cleared answers
  const quizType = STATE.quizData[0]?.options ? "objective" : "subjective";
  renderActiveQuiz(quizType, 0);
  window.scrollTo({ top: 0, behavior: "smooth" });
  toast("Retrying Quiz Sprint", "Answer each question and see if your recall improved!", "info");
}

function renderQuizResults(res) {
  const activePanel = $("#quiz-active-panel");
  const resultsPanel = $("#quiz-results-panel");
  if (activePanel) activePanel.style.display = "none";
  if (!resultsPanel) return;
  resultsPanel.style.display = "block";

  const score = res.score !== undefined ? res.score : 0;
  const maxScore = res.max_score || (res.results ? res.results.length : 1);
  const pct = res.percentage !== undefined ? res.percentage : Math.round((score / maxScore) * 100);

  // Motivational encouragement from gamification or curated quotes
  let encouragement = res.encouragement_message;
  if (!encouragement && typeof res.encouragement === "object") {
    encouragement = res.encouragement.message;
  }
  if (!encouragement) {
    if (pct >= 80) encouragement = "Outstanding recall accuracy! Your neural connections are solidifying rapidly.";
    else if (pct >= 50) encouragement = "Solid effort! Reviewing the questions you missed is where 90% of real learning occurs.";
    else encouragement = "Every mistake is a neural springboard. Review each question below, check your pinned vault, and retake!";
  }

  // Quiz questions review list (support results and feedback keys)
  const items = res.results || res.feedback || [];
  const wrongCount = res.wrong_count !== undefined ? res.wrong_count : items.filter(it => !it.is_correct && it.score < 3).length;
  const correctCount = res.correct_count !== undefined ? res.correct_count : (items.length - wrongCount);

  // Attempts history badge row
  const qid = STATE.quizId || "current";
  const attempts = STATE.quizAttempts[qid] || [];
  let attemptsHtml = "";
  if (attempts.length > 1) {
    attemptsHtml = `
      <div class="quiz-attempts-history-bar">
        <span class="mono-code text-xs text-muted">ATTEMPT HISTORY:</span>
        ${attempts.map((att, i) => `
          <span class="attempt-pill ${i === attempts.length - 1 ? 'current' : ''}">
            #${att.attempt}: ${att.score}/${att.max_score} (${att.percentage}%)
          </span>
        `).join("")}
      </div>`;
  }

  // Pinned mistakes alert banner
  let mistakesBanner = "";
  if (wrongCount > 0) {
    mistakesBanner = `
      <div class="mistake-pinned-banner">
        <div class="mistake-pinned-text">
          <span class="pinned-badge-tag">TOP PRIORITY</span>
          <span><strong>${wrongCount} missed concept${wrongCount > 1 ? "s" : ""}</strong> automatically pinned to your Brain Dump as high-priority exam cards!</span>
        </div>
        <button class="cortex-btn btn-xs btn-glow-purple" id="btn-jump-braindump">View in Brain Dump →</button>
      </div>`;
  }

  // Review Filter Bar
  const filterBarHtml = `
    <div class="quiz-review-filter-bar">
      <button class="quiz-filter-btn active" data-filter="all">All Questions (${items.length})</button>
      <button class="quiz-filter-btn" data-filter="mistakes">⚠️ Mistakes Only (${wrongCount})</button>
      <button class="quiz-filter-btn" data-filter="correct">✓ Correct (${correctCount})</button>
    </div>`;

  // Render question review cards
  let reviewCardsHtml = '<div class="quiz-feedback-list" id="quiz-review-items-container">';
  items.forEach((item, idx) => {
    const isOk = item.is_correct || (item.score !== undefined && item.score >= 3);
    const cardStatusClass = isOk ? "review-correct" : "review-mistake";
    const statusBadge = isOk
      ? `<span class="mono-badge green">✓ CORRECT</span>`
      : `<span class="mono-badge rose">✕ NEEDS REVIEW</span><span class="pinned-badge-tag">PINNED TO BRAIN DUMP</span>`;

    let optionsMarkup = "";
    if (item.options && item.options.length) {
      optionsMarkup = `<div class="q-review-options-list">`;
      item.options.forEach((optText, optIdx) => {
        const letter = String.fromCharCode(65 + optIdx);
        const isUserChoice = item.your_answer === optIdx;
        const isTarget = item.correct_answer === optIdx;

        let optClass = "q-review-opt";
        let optTag = "";

        if (isUserChoice && isTarget) {
          optClass += " user-correct";
          optTag = `<span class="mono-badge green">Your Answer ✓</span>`;
        } else if (isUserChoice && !isTarget) {
          optClass += " user-wrong";
          optTag = `<span class="mono-badge rose">Your Answer ✕</span>`;
        } else if (isTarget) {
          optClass += " correct-target";
          optTag = `<span class="mono-badge green">Correct Answer ✓</span>`;
        }

        optionsMarkup += `
          <div class="${optClass}">
            <div style="display:flex;align-items:center;gap:0.6rem;">
              <span class="q-opt-marker">${letter}</span>
              <span>${escHtml(optText)}</span>
            </div>
            ${optTag}
          </div>`;
      });
      optionsMarkup += `</div>`;
    } else {
      // Subjective answers
      optionsMarkup = `
        <div style="margin:0.75rem 0; font-size:0.88rem; background:rgba(255,255,255,0.02); padding:0.75rem; border-radius:6px; border:1px solid rgba(255,255,255,0.06);">
          <div style="margin-bottom:0.35rem;"><strong class="text-accent">Your Response:</strong> ${escHtml(item.your_answer || "No response submitted.")}</div>
          ${item.model_answer ? `<div style="margin-top:0.35rem;"><strong style="color:var(--emerald-live);">Model Answer:</strong> ${escHtml(item.model_answer)}</div>` : ""}
          ${item.missed_points && item.missed_points.length ? `<div style="margin-top:0.35rem; color:#fca5a5;"><strong>Missed Key Points:</strong> ${item.missed_points.map(p => escHtml(p)).join("; ")}</div>` : ""}
        </div>`;
    }

    const explanation = item.explanation || item.feedback || "";
    const explanationMarkup = explanation ? `
      <div class="q-explanation-box">
        <strong>💡 Key Takeaway & Intuition:</strong> ${escHtml(explanation)}
      </div>` : "";

    reviewCardsHtml += `
      <div class="q-block ${cardStatusClass}" data-is-correct="${isOk}" style="border-left: 3px solid ${isOk ? "var(--emerald-live)" : "var(--rose-drowsy)"};">
        <div class="q-header-row" style="display:flex; justify-content:space-between; align-items:center;">
          <span class="q-num-tag">[ QUESTION ${String(idx + 1).padStart(2, "0")} ]</span>
          <div style="display:flex;gap:0.4rem;align-items:center;">
            ${statusBadge}
          </div>
        </div>
        <div class="q-text-body" style="margin:0.75rem 0;">${escHtml(item.question)}</div>
        ${optionsMarkup}
        ${explanationMarkup}
      </div>`;
  });
  reviewCardsHtml += "</div>";

  resultsPanel.innerHTML = `
    <div class="results-hero-box">
      <div class="results-score-big">${score} / ${maxScore}</div>
      <div class="results-pct-tag">${pct}% MASTERY INDEX</div>
      <p class="results-encouragement">"${encouragement}"</p>
      ${attemptsHtml}
      <div style="display:flex;gap:0.75rem;justify-content:center;margin-top:1.5rem;flex-wrap:wrap;">
        <button class="cortex-btn btn-glow-purple" id="btn-retake-quiz">🔄 Retake This Quiz</button>
        <button class="cortex-btn btn-outline-cyber" id="btn-quiz-new-sprint">⚡ Take Another Sprint</button>
      </div>
    </div>
    ${mistakesBanner}
    ${filterBarHtml}
    ${reviewCardsHtml}`;

  // Attach button listeners
  $("#btn-retake-quiz")?.addEventListener("click", retakeCurrentQuiz);

  $("#btn-quiz-new-sprint")?.addEventListener("click", () => {
    playSfx("click");
    resultsPanel.style.display = "none";
    $("#quiz-setup-panel").style.display = "block";
    STATE.quizId = null;
    STATE.quizData = null;
    STATE.quizAnswers = {};
  });

  $("#btn-jump-braindump")?.addEventListener("click", () => {
    playSfx("tab");
    $$(".nav-item").forEach(b => b.classList.remove("active"));
    $$(".tab-view").forEach(t => t.classList.remove("active"));
    $("#nav-btn-braindump")?.classList.add("active");
    $("#tab-braindump")?.classList.add("active");
    loadBrainDump();
  });

  // Filter tabs listeners (All / Mistakes Only / Correct)
  $$(".quiz-filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      playSfx("click");
      $$(".quiz-filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const filter = btn.dataset.filter;

      $$("#quiz-review-items-container .q-block").forEach(card => {
        const isCorrect = card.dataset.isCorrect === "true";
        if (filter === "all") {
          card.style.display = "block";
        } else if (filter === "mistakes") {
          card.style.display = isCorrect ? "none" : "block";
        } else if (filter === "correct") {
          card.style.display = isCorrect ? "block" : "none";
        }
      });
    });
  });
}

// UNIFIED BRAIN DUMP FEED (CRAM VAULT + REVISION)
// =====================================================================
function initBrainDump() {
    $("#btn-add-manual-cram")?.addEventListener("click", () => {
        playSfx("click");
        $("#modal-add-cram").style.display = "flex";
    });

    $("#btn-close-cram")?.addEventListener("click", () => {
        playSfx("click");
        $("#modal-add-cram").style.display = "none";
    });

    // Manual Form
    $("#form-add-cram")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        playSfx("click");

        const cat = $("#cram-cat").value;
        const title = $("#cram-title").value.trim();
        const content = $("#cram-content").value.trim();
        const pin = $("#cram-pin").checked;

        if (!title || !content) return;

        try {
            const user = STATE.profile?.name || "Student";
            const subject = STATE.profile?.subject || "General";

            await api("POST", "/vault/add", {
                user_name: user,
                subject_name: subject,
                title,
                content,
                category: cat,
                is_pinned: pin,
                pinned: pin,
            });

            toast("Card Saved", `"${title}" pinned to your vault`, "success");
            $("#modal-add-cram").style.display = "none";
            $("#cram-title").value = "";
            $("#cram-content").value = "";
            loadBrainDump();
        } catch (err) {
            toast("Error Saving", err.message, "error");
        }
    });

    // AI High Yield Extract Button
    $("#btn-ai-extract")?.addEventListener("click", async () => {
        playSfx("click");
        const btn = $("#btn-ai-extract");
        btn.disabled = true;
        btn.textContent = "⚡ Scanning Notes...";

        try {
            const user = STATE.profile?.name || "Student";
            const subject = STATE.profile?.subject || "General";

            const res = await api("POST", "/vault/ai-extract", {
                user_name: user,
                subject_name: subject,
                count: 5,
            });

            const count = res.points?.length || 5;
            playSfx("badge");
            toast("High-Yield Points Extracted", `${count} key exam concepts saved to vault!`, "success");
            loadBrainDump();
        } catch (err) {
            playSfx("alert");
            toast("Extraction Failed", err.message, "error");
        } finally {
            btn.disabled = false;
            btn.textContent = "⚡ AI Extract Points";
        }
    });

    // Filter pills
    $$(".filter-pill").forEach((pill) => {
        pill.addEventListener("click", () => {
            playSfx("click");
            $$(".filter-pill").forEach((p) => p.classList.remove("active"));
            pill.classList.add("active");
            STATE.bdFilter = pill.dataset.filter;
            renderBrainDumpGrid();
        });
    });
}

async function loadBrainDump() {
    const user = STATE.profile?.name || "Student";
    const subject = STATE.profile?.subject || "General";

    const grid = $("#braindump-grid");
    if (grid) {
        grid.innerHTML = `
      <div class="cortex-card" style="grid-column: 1 / -1; text-align: center; padding: 2rem 1rem;">
        <span class="star-accent" style="font-size: 1.5rem;">⚡</span>
        <p class="text-sm text-muted">Loading brain dump for <strong>${escHtml(subject)}</strong>...</p>
      </div>`;
    }

    try {
        const [cramRes, revRes] = await Promise.all([
            api("GET", `/vault/list?user_name=${encodeURIComponent(user)}&subject_name=${encodeURIComponent(subject)}`).catch(() => ({ items: [] })),
            api("GET", `/revision/due?user_name=${encodeURIComponent(user)}&subject_name=${encodeURIComponent(subject)}`).catch(() => ({ items: [] })),
        ]);

        const cramItems = (cramRes.items || []).map(it => ({ ...it, type: it.type || "cram" }));
        const revItems = (revRes.items || []).map(it => ({ ...it, type: "revision" }));

        STATE.bdItems = [...cramItems, ...revItems];
        renderBrainDumpGrid();
    } catch (err) {
        console.warn("Failed loading brain dump:", err);
        if (grid) {
            grid.innerHTML = `
        <div class="cortex-card" style="grid-column: 1 / -1; text-align: center; padding: 2rem 1rem;">
          <p class="text-sm text-muted">Failed to load brain dump. Check the server connection.</p>
        </div>`;
        }
    }
}

function renderBrainDumpGrid() {
    const grid = $("#braindump-grid");
    if (!grid) return;

    let filtered = STATE.bdItems;
    if (STATE.bdFilter === "pinned") {
        filtered = filtered.filter((i) => i.pinned);
    } else if (STATE.bdFilter === "cram") {
        filtered = filtered.filter((i) => i.type !== "revision");
    } else if (STATE.bdFilter === "revision") {
        filtered = filtered.filter((i) => i.type === "revision");
    }

    // Sort: pinned first
    filtered.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

    if (!filtered.length) {
        grid.innerHTML = `
      <div class="cortex-card" style="grid-column: 1 / -1; text-align: center; padding: 2.5rem 1rem;">
        <span class="star-accent" style="font-size: 2rem;">✦</span>
        <h4 style="margin: 0.5rem 0 0.25rem;">No Cram Cards Ingested Yet</h4>
        <p class="text-sm text-muted">Upload notes and click "⚡ AI Extract Points" or add manual cheat-sheet formulas.</p>
      </div>`;
        return;
    }

    grid.innerHTML = filtered
        .map((item) => {
            const isPinned = item.pinned;
            const isRev = item.type === "revision";
            return `
        <div class="cram-feed-card ${isPinned ? "pinned" : ""} ${isRev ? "revision-item" : ""}">
          <div>
            <div class="cram-top-row">
              <span class="cram-category-badge">${escHtml(item.category || "Core Concept")}</span>
              <div class="cram-actions">
                ${!isRev
                    ? `<button class="cram-icon-btn pin-btn" data-id="${item.id}" title="Pin">${isPinned ? "📌" : "📍"}</button>
                       <button class="cram-icon-btn del-btn" data-id="${item.id}" title="Delete">✕</button>`
                    : ""
                }
              </div>
            </div>
            <h4 class="cram-title">${escHtml(item.title)}</h4>
            <div class="cram-body">${escHtml(item.content)}</div>
          </div>
          <div class="cram-footer-row">
            <span>${isRev ? "🧠 SM-2 SPACED REVISION" : "LAST-MINUTE EXAM CRAM"}</span>
            <span>${item.created_at ? new Date(item.created_at).toLocaleDateString() : "ACTIVE"}</span>
          </div>
        </div>`;
        })
        .join("");

    // Attach card action listeners
    $$(".pin-btn").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            playSfx("click");
            const id = btn.dataset.id;
            const user = STATE.profile?.name || "Student";
            try {
                await api("POST", `/vault/pin/${id}?user_name=${encodeURIComponent(user)}`);
                loadBrainDump();
            } catch (e) { }
        });
    });

    $$(".del-btn").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            playSfx("click");
            const id = btn.dataset.id;
            const user = STATE.profile?.name || "Student";
            try {
                await api("DELETE", `/vault/delete/${id}?user_name=${encodeURIComponent(user)}`);
                loadBrainDump();
            } catch (e) { }
        });
    });
}

// =====================================================================
// YOLO FOCUS MONITOR & OPTICAL WEBCAM SENSING
// =====================================================================
function initVisionSystem() {
    const toggleBtn = $("#btn-toggle-cam");
    const startInline = $("#btn-start-cam-inline");
    const camSelect = $("#cam-source-select");

    toggleBtn?.addEventListener("click", toggleCamera);
    startInline?.addEventListener("click", toggleCamera);

    camSelect?.addEventListener("change", () => {
        STATE.camSource = camSelect.value;
        if (STATE.camActive) {
            stopCamera();
            startCamera();
        }
    });

    $("#btn-overlay-break")?.addEventListener("click", () => {
        playSfx("click");
        $("#fatigue-overlay").style.display = "none";
        openBreakModal();
    });

    $("#btn-dismiss-fatigue")?.addEventListener("click", () => {
        playSfx("click");
        $("#fatigue-overlay").style.display = "none";
    });
}

async function toggleCamera() {
    playSfx("click");
    if (STATE.camActive) {
        stopCamera();
    } else {
        await startCamera();
    }
}

async function startCamera() {
    const video = $("#client-webcam");
    const canvas = $("#client-canvas");
    const placeholder = $("#cam-placeholder");
    const hud = $("#cam-hud");
    const hwImg = $("#hardware-stream-img");
    const btnText = $("#cam-btn-text");

    if (STATE.camSource === "hardware-feed") {
        if (placeholder) placeholder.style.display = "none";
        if (hwImg) {
            hwImg.src = "/video-feed";
            hwImg.style.display = "block";
        }
        if (hud) hud.style.display = "flex";
        if (btnText) btnText.textContent = "Stop Cam";
        STATE.camActive = true;
        toast("OpenCV Hardware Vision Live", "Streaming direct annotated frames", "info");
        return;
    }

    // Client Canvas Webcam Mode
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 480 } },
        });
        STATE.camStream = stream;
        if (video) {
            video.srcObject = stream;
            video.style.display = "block";
        }
        if (placeholder) placeholder.style.display = "none";
        if (hwImg) hwImg.style.display = "none";
        if (hud) hud.style.display = "flex";
        if (btnText) btnText.textContent = "Stop Cam";
        STATE.camActive = true;

        // Start frame polling to YOLO backend
        startFrameAnalysisLoop();
        toast("AI Vision Online", "YOLO fatigue detection running at 1 FPS", "success");
    } catch (err) {
        toast("Webcam Permission Denied", err.message, "error");
    }
}

function stopCamera() {
    if (STATE.camStream) {
        STATE.camStream.getTracks().forEach((t) => t.stop());
        STATE.camStream = null;
    }
    if (STATE.camInterval) {
        clearInterval(STATE.camInterval);
        STATE.camInterval = null;
    }
    const video = $("#client-webcam");
    const placeholder = $("#cam-placeholder");
    const hud = $("#cam-hud");
    const hwImg = $("#hardware-stream-img");
    const btnText = $("#cam-btn-text");

    if (video) video.style.display = "none";
    if (hwImg) {
        hwImg.src = "";
        hwImg.style.display = "none";
    }
    if (placeholder) placeholder.style.display = "flex";
    if (hud) hud.style.display = "none";
    if (btnText) btnText.textContent = "Start Cam";
    STATE.camActive = false;
}

function startFrameAnalysisLoop() {
    const video = $("#client-webcam");
    const canvas = $("#client-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    STATE.camInterval = setInterval(async () => {
        if (!STATE.camActive || !video || video.readyState !== 4) return;

        canvas.width = 320;
        canvas.height = 240;
        ctx.drawImage(video, 0, 0, 320, 240);
        const b64 = canvas.toDataURL("image/jpeg", 0.6);

        STATE.frameCounter++;
        const frameLabel = $("#hud-frame-counter");
        if (frameLabel) frameLabel.textContent = `FRAME: ${String(STATE.frameCounter).padStart(4, "0")}`;

        try {
            const res = await api("POST", "/focus/analyze-frame", { image_base64: b64 });
            handleVisionAnalysisResult(res);
        } catch (e) {
            // Backend might be warming up
        }
    }, 1200);
}

function handleVisionAnalysisResult(res) {
    if (!res) return;

    const stateText = $("#hud-state-text");
    const stateDot = $("#hud-dot");
    const confVal = $("#hud-conf-val");
    const mEvents = $("#m-fatigue-events");
    const mFrames = $("#m-consec-frames");
    const mScore = $("#m-focus-score");
    const globalLabel = $("#global-focus-label");

    const state = res.state || "FOCUSED";
    const isDrowsy = state === "DROWSY" || state === "FATIGUED";

    if (stateText) stateText.textContent = state;
    if (confVal) confVal.textContent = `${Math.round((res.confidence || 0.95) * 100)}%`;
    if (mEvents) mEvents.textContent = `${res.fatigue_events_5m || 0} / 3`;
    if (mFrames) mFrames.textContent = res.consecutive_drowsy_frames || 0;
    if (mScore) mScore.textContent = `${Math.round((res.focus_score || 1) * 100)}%`;

    if (stateDot) {
        if (isDrowsy) stateDot.classList.add("drowsy");
        else stateDot.classList.remove("drowsy");
    }

    if (globalLabel) {
        globalLabel.textContent = isDrowsy ? "DROWSY_DETECTED" : "HYPERFOCUS_ACTIVE";
    }

    // Trigger alert if fatigue exceeds threshold
    if (isDrowsy && (res.consecutive_drowsy_frames >= 2 || res.fatigue_events_5m >= 3)) {
        const overlay = $("#fatigue-overlay");
        if (overlay && overlay.style.display !== "flex") {
            overlay.style.display = "flex";
            playSfx("alert");
        }
    }
}

// =====================================================================
// POMODORO TIMER & SMART BREAK RECHARGE
// =====================================================================
function initPomodoro() {
    $("#btn-timer-start")?.addEventListener("click", toggleTimer);
    $("#btn-timer-pause")?.addEventListener("click", pauseTimer);
    $("#btn-timer-reset")?.addEventListener("click", resetTimer);

    // Preset buttons (15m, 25m, 45m)
    $$(".preset-tag").forEach((btn) => {
        btn.addEventListener("click", () => {
            playSfx("click");
            $$(".preset-tag").forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            const mins = parseInt(btn.dataset.preset);
            STATE.timerSeconds = mins * 60;
            STATE.timerMax = STATE.timerSeconds;
            pauseTimer();
            updateTimerUI();
        });
    });

    $("#btn-end-break")?.addEventListener("click", () => {
        playSfx("click");
        closeBreakModal();
        STATE.timerMode = "focus";
        STATE.timerSeconds = (STATE.profile?.focusMins || 25) * 60;
        STATE.timerMax = STATE.timerSeconds;
        updateTimerUI();
    });
}

function toggleTimer() {
    playSfx("click");
    if (STATE.timerRunning) {
        pauseTimer();
    } else {
        startTimer();
    }
}

function startTimer() {
    STATE.timerRunning = true;
    playSfx("start");

    const btn = $("#btn-timer-start");
    const pauseBtn = $("#btn-timer-pause");
    if (btn) btn.innerHTML = '<span class="btn-chrome-text">⏸ Pause Block</span>';
    if (pauseBtn) pauseBtn.disabled = false;

    STATE.timerInterval = setInterval(() => {
        if (STATE.timerSeconds > 0) {
            STATE.timerSeconds--;
            updateTimerUI();
        } else {
            // Completed block
            pauseTimer();
            handleBlockFinished();
        }
    }, 1000);
}

function pauseTimer() {
    STATE.timerRunning = false;
    if (STATE.timerInterval) {
        clearInterval(STATE.timerInterval);
        STATE.timerInterval = null;
    }
    const btn = $("#btn-timer-start");
    const pauseBtn = $("#btn-timer-pause");
    if (btn) btn.innerHTML = '<span class="btn-chrome-text">⚡ Resume Session</span>';
    if (pauseBtn) pauseBtn.disabled = true;
}

function resetTimer() {
    pauseTimer();
    playSfx("click");
    STATE.timerSeconds = STATE.timerMax;
    updateTimerUI();
}

function updateTimerUI() {
    const timeEl = $("#timer-time");
    const ring = $("#ring-progress");
    if (timeEl) timeEl.textContent = fmtTime(STATE.timerSeconds);

    if (ring && STATE.timerMax > 0) {
        const fraction = (STATE.timerMax - STATE.timerSeconds) / STATE.timerMax;
        const offset = 276.46 * (1 - fraction);
        ring.style.strokeDashoffset = offset;
    }
}

function handleBlockFinished() {
    playSfx("badge");
    toast("Focus Block Completed!", "Awesome work. Time for a regenerative cognitive break.", "badge");

    // Log session to backend
    const user = STATE.profile?.name || "Student";
    const subject = STATE.profile?.subject || "General";
    const duration = Math.round(STATE.timerMax / 60);

    api("POST", "/log-study-session", {
        user_name: user,
        student_name: user,
        subject_name: subject,
        duration_minutes: duration,
        completed: true,
        focus_score: 1.0,
        fatigue_events: STATE.fatigueEvents,
    }).catch(() => { });

    openBreakModal();
}

function openBreakModal() {
    const modal = $("#modal-break");
    if (modal) modal.style.display = "flex";

    STATE.breakSeconds = (STATE.profile?.breakMins || 5) * 60;
    const breakCountdown = $("#break-countdown");
    const breatheLabel = $("#breathe-label");

    let phase = 0;
    if (STATE.breakInterval) clearInterval(STATE.breakInterval);

    STATE.breakInterval = setInterval(() => {
        if (STATE.breakSeconds > 0) {
            STATE.breakSeconds--;
            if (breakCountdown) breakCountdown.textContent = fmtTime(STATE.breakSeconds);

            // Inhale / exhale cycle every 4s
            phase = (phase + 1) % 8;
            if (breatheLabel) {
                breatheLabel.textContent = phase < 4 ? "INHALE" : "EXHALE";
            }
        } else {
            clearInterval(STATE.breakInterval);
            toast("Break Complete", "Ready for your next high-yield study sprint!", "success");
        }
    }, 1000);
}

function closeBreakModal() {
    const modal = $("#modal-break");
    if (modal) modal.style.display = "none";
    if (STATE.breakInterval) {
        clearInterval(STATE.breakInterval);
        STATE.breakInterval = null;
    }
}

// =====================================================================
// INITIALIZATION ON DOM READY
// =====================================================================
document.addEventListener("DOMContentLoaded", () => {
    initAmbientBackground();
    initNeuralWaveform();
    initTopHud();
    initNav();
    initProfile();
    initOnboarding();
    initUpload();
    initChat();
    initQuizArena();
    initBrainDump();
    initVisionSystem();
    initPomodoro();
    initSubjectsTab();
});

