// --- 圓的設定（已保留） ---
let circles = [];
const COLORS = ['#cdb4db', '#ffc8dd', '#ffafcc', '#bde0fe', '#a2d2ff'];
const NUM_CIRCLES = 40; // 改為更多圓，原本 20

let particles = [];
const EXPLOSION_PARTICLES = 50;
const GRAVITY = 0.15;

// 新增計分
let score = 0;

// 新增：比對顏色的輔助函式
function componentToHex(c) {
    let h = Math.round(c).toString(16);
    return h.length === 1 ? '0' + h : h;
}
function getHexFromColor(col) {
    const r = red(col), g = green(col), b = blue(col);
    return ('#' + componentToHex(r) + componentToHex(g) + componentToHex(b)).toLowerCase();
}

// 新增：自動爆破時間設定（避免未定義錯誤）
const AUTO_MIN_INTERVAL = 800; // 最小間隔（毫秒）
const AUTO_MAX_INTERVAL = 3000; // 最大間隔（毫秒）
let nextAutoExplosion = 0;

// --- 新增：Audio 相關設定與函式 ---
let audioCtx = null;

// 快取：key -> { buffer, promise }
const audioDownloadCache = {};

// 根據參數建立快取 key
function getAudioCacheKey(duration, intensity, tone) {
    return `${Math.round(duration * 100)}_${Math.round(intensity * 100)}_${Math.round(tone)}`;
}

// 確保有可用的 AudioContext（在 user gesture 後可 resume）
function ensureAudioContext() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    // 嘗試在第一次使用者互動時自動 resume（安全註冊一次性監聽器）
    if (audioCtx.state === 'suspended') {
        const resumeOnce = () => {
            audioCtx.resume().then(() => {
                console.log('AudioContext resumed via user interaction');
            }).catch(() => {});
            document.removeEventListener('click', resumeOnce);
            document.removeEventListener('touchstart', resumeOnce);
        };
        document.addEventListener('click', resumeOnce, { once: true });
        document.addEventListener('touchstart', resumeOnce, { once: true });
    }
}

// 更換為「低頻、輕柔的泡泡破掉」即時音效（短促低頻 thump + 柔和噪聲）
function playExplosionSoundLive(duration = 0.18, intensity = 0.3, tone = 220) {
    ensureAudioContext();
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().then(() => {
            playExplosionSoundLive(duration, intensity, tone);
        }).catch(() => {});
        return;
    }

    const ctx = audioCtx;
    const now = ctx.currentTime;
    // 限制為短促聲響，避免過長
    const dur = Math.max(0.06, Math.min(0.28, duration));

    // 低頻 thump（主要能量來源，柔和且快速衰減）
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const startFreq = Math.max(60, tone * 0.4);
    const endFreq = Math.max(40, tone * 0.25);
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(endFreq, now + Math.min(0.09, dur));

    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(0.28 * intensity, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + Math.min(0.15, dur));

    // 溫和低通噪聲與輕微高頻成分（給破裂質感但不響亮）
    const sampleRate = ctx.sampleRate;
    const buf = ctx.createBuffer(1, Math.max(1, Math.floor(sampleRate * dur)), sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
        // 較小幅度的隨機噪聲並快速衰減
        let t = i / data.length;
        let env = Math.exp(-12 * t);
        data[i] = (Math.random() * 2 - 1) * env * (0.6 * intensity);
    }
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = buf;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800; // 限制高頻，讓整體更柔和

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 120; // 去除非常低的 DC 成分

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.18 * intensity, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    // 連線：noise -> hp -> lp -> noiseGain -> dest
    noiseSrc.connect(hp);
    hp.connect(lp);
    lp.connect(noiseGain);
    noiseGain.connect(ctx.destination);

    // 連線 thump
    osc.connect(thumpGain);
    thumpGain.connect(ctx.destination);

    // 啟動
    noiseSrc.start(now);
    osc.start(now);

    // 停止時間
    noiseSrc.stop(now + dur + 0.02);
    osc.stop(now + Math.min(0.16, dur + 0.02));
}

// 更換為對應的離線快取渲染（低頻、輕柔泡泡聲）
function createAndGetExplosionBuffer(duration = 0.18, intensity = 0.3, tone = 220) {
    const key = getAudioCacheKey(duration, intensity, tone);

    if (audioDownloadCache[key] && audioDownloadCache[key].buffer) {
        return Promise.resolve(audioDownloadCache[key].buffer);
    }
    if (audioDownloadCache[key] && audioDownloadCache[key].promise) {
        return audioDownloadCache[key].promise;
    }

    const sampleRate = 44100;
    const dur = Math.max(0.06, Math.min(0.28, duration));
    const length = Math.max(1, Math.floor(sampleRate * dur));
    const offline = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(2, length, sampleRate);

    // 低頻 thump（osc）
    const osc = offline.createOscillator();
    osc.type = 'sine';
    const startFreq = Math.max(60, tone * 0.4);
    const endFreq = Math.max(40, tone * 0.25);
    osc.frequency.setValueAtTime(startFreq, 0);
    osc.frequency.exponentialRampToValueAtTime(endFreq, Math.min(0.09, dur));

    const thumpGain = offline.createGain();
    thumpGain.gain.setValueAtTime(0.28 * intensity, 0);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, Math.min(0.15, dur));

    // 噪聲 buffer（柔和）
    const noiseBuf = offline.createBuffer(1, length, sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < length; i++) {
        let t = i / length;
        let env = Math.exp(-12 * t);
        nd[i] = (Math.random() * 2 - 1) * env * (0.6 * intensity);
    }
    const noiseSource = offline.createBufferSource();
    noiseSource.buffer = noiseBuf;

    const lp = offline.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;

    const hp = offline.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 120;

    const noiseGain = offline.createGain();
    noiseGain.gain.setValueAtTime(0.18 * intensity, 0);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, dur);

    // connect
    noiseSource.connect(hp);
    hp.connect(lp);
    lp.connect(noiseGain);
    noiseGain.connect(offline.destination);

    osc.connect(thumpGain);
    thumpGain.connect(offline.destination);

    noiseSource.start(0);
    osc.start(0);
    noiseSource.stop(dur);
    osc.stop(Math.min(0.16, dur + 0.01));

    const renderPromise = offline.startRendering().then(function(renderedBuffer) {
        audioDownloadCache[key] = { buffer: renderedBuffer };
        return renderedBuffer;
    }).catch(function(err) {
        console.error("Offline rendering failed:", err);
        if (audioDownloadCache[key] && audioDownloadCache[key].promise) delete audioDownloadCache[key];
        throw err;
    });

    audioDownloadCache[key] = { promise: renderPromise };
    return renderPromise;
}

// 產生 WAV 並自動下載（使用 OfflineAudioContext），但會使用快取避免重複渲染與下載
function createExplosionWavAndDownload(duration = 1.0, intensity = 0.8, tone = 150, filenameBase = "explosion") {
    const key = getAudioCacheKey(duration, intensity, tone);
    const filename = `${filenameBase}_${key}.wav`;

    // 若已有完成的快取，直接下載（不重新產生）
    if (audioDownloadCache[key] && audioDownloadCache[key].url) {
        triggerDownload(audioDownloadCache[key].url, filename);
        return;
    }

    // 若正在產生中，等 promise 完成後下載
    if (audioDownloadCache[key] && audioDownloadCache[key].promise) {
        audioDownloadCache[key].promise.then(url => {
            triggerDownload(url, filename);
        }).catch(err => {
            console.error('audio render failed (cached promise):', err);
        });
        return;
    }

    // 開始離線渲染並將 promise 存入快取
    const sampleRate = 44100;
    const length = Math.floor(sampleRate * duration);
    const offline = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(2, length, sampleRate);

    // noise buffer (mono)
    const noiseBuf = offline.createBuffer(1, length, sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < length; i++) {
        nd[i] = (Math.random() * 2 - 1) * (1 - i / length);
    }
    const noiseSource = offline.createBufferSource();
    noiseSource.buffer = noiseBuf;

    const noiseFilter = offline.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = Math.max(400, tone * 2);

    const noiseGain = offline.createGain();
    noiseGain.gain.setValueAtTime(intensity * 0.8, 0);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, duration);

    // thump oscillator
    const osc = offline.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(Math.max(60, tone / 2), 0);
    const oscGain = offline.createGain();
    oscGain.gain.setValueAtTime(intensity * 0.6, 0);
    oscGain.gain.exponentialRampToValueAtTime(0.001, Math.min(0.4, duration));

    // connect
    noiseSource.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(offline.destination);

    osc.connect(oscGain);
    oscGain.connect(offline.destination);

    noiseSource.start(0);
    osc.start(0);
    noiseSource.stop(duration + 0.05);
    osc.stop(Math.min(0.5, duration));

    const renderPromise = offline.startRendering().then(function(renderedBuffer) {
        const wavView = bufferToWav(renderedBuffer);
        const blob = new Blob([wavView], { type: "audio/wav" });
        const url = URL.createObjectURL(blob);
        // 儲存完成結果（覆寫 promise）
        audioDownloadCache[key] = { url: url, blob: blob };
        triggerDownload(url, filename);
        return url;
    }).catch(function(err) {
        console.error("Offline rendering failed:", err);
        // 清除失敗的快取條目
        if (audioDownloadCache[key] && audioDownloadCache[key].promise) delete audioDownloadCache[key];
        throw err;
    });

    // 暫存 promise，避免重複渲染
    audioDownloadCache[key] = { promise: renderPromise };
    return;
}

// helper: convert AudioBuffer -> WAV (Float32 -> 16bit PCM)
function bufferToWav(buffer) {
    const numOfChan = buffer.numberOfChannels;
    const length = buffer.length * numOfChan * 2 + 44;
    const buf = new ArrayBuffer(length);
    const view = new DataView(buf);

    function writeString(view, offset, string) {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    }
    let offset = 0;
    writeString(view, offset, 'RIFF'); offset += 4;
    view.setUint32(offset, 36 + buffer.length * numOfChan * 2, true); offset += 4;
    writeString(view, offset, 'WAVE'); offset += 4;
    writeString(view, offset, 'fmt '); offset += 4;
    view.setUint32(offset, 16, true); offset += 4;
    view.setUint16(offset, 1, true); offset += 2; // PCM
    view.setUint16(offset, numOfChan, true); offset += 2;
    view.setUint32(offset, buffer.sampleRate, true); offset += 4;
    view.setUint32(offset, buffer.sampleRate * numOfChan * 2, true); offset += 4;
    view.setUint16(offset, numOfChan * 2, true); offset += 2;
    view.setUint16(offset, 16, true); offset += 2;
    writeString(view, offset, 'data'); offset += 4;
    view.setUint32(offset, buffer.length * numOfChan * 2, true); offset += 4;

    // write interleaved samples
    const interleaved = new Int16Array(buffer.length * numOfChan);
    let idx = 0;
    for (let i = 0; i < buffer.length; i++) {
        for (let ch = 0; ch < numOfChan; ch++) {
            const channelData = buffer.getChannelData(ch);
            let sample = channelData[i];
            sample = Math.max(-1, Math.min(1, sample));
            interleaved[idx++] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        }
    }
    // write PCM samples
    for (let i = 0; i < interleaved.length; i++, offset += 2) {
        view.setInt16(offset, interleaved[i], true);
    }
    return view;
}

function setup() {
    createCanvas(windowWidth, windowHeight);

    // 初始化圓
    circles = [];
    for (let i = 0; i < NUM_CIRCLES; i++) {
        circles.push(makeCircle(i));
    }

    // 不再安排自動爆破（由使用者點擊觸發）
    // scheduleNextAutoExplosion();
}

function makeCircle(id) {
    return {
        id: id,
        x: random(width),
        y: random(height),
        r: random(50, 200), // 大小
        color: color(random(COLORS)), // 顏色
        alpha: random(80, 255),
        speed: random(1, 5), // 上升速度
        exploding: false,
        pendingParticles: 0
    };
}

function draw() {
    background('#fefae0'); // 背景顏色（已保留）
    noStroke();

    // 顯示左上固定文字
    textSize(32);
    textAlign(LEFT, TOP);
    fill('#a76e4c');
    noStroke();
    text('414730944', 10, 10);

    // 顯示右上分數（同顏色、同大小）
    textAlign(RIGHT, TOP);
    text(String(score), width - 10, 10);

    //（移除自動隨機爆破呼叫：僅由 mousePressed 觸發爆破）
    // 更新並畫出圓（若未爆破），並在右上方畫小方塊圖案
    for (let c of circles) {
        if (!c.exploding) {
            c.y -= c.speed; // 圓上升
            if (c.y + c.r / 2 < 0) { // 若完全移出畫面頂端，從底部重生
                c.y = height + c.r / 2;
                c.x = random(width);
                c.r = random(50, 200);
                c.color = color(random(COLORS));
                c.alpha = random(80, 255);
                c.speed = random(1, 5);
            }
            c.color.setAlpha(c.alpha);
            fill(c.color);
            circle(c.x, c.y, c.r);

            // 右上方的小方塊（放在圓的 1/4 右上位置）
            let squareSize = c.r / 6;
            let angle = -PI / 4;
            let distance = c.r / 2 * 0.65;
            let squareCenterX = c.x + cos(angle) * distance;
            let squareCenterY = c.y + sin(angle) * distance;
            fill(255, 255, 255, 140);
            noStroke();
            rectMode(CENTER);
            rect(squareCenterX, squareCenterY, squareSize, squareSize);
        }
    }

    // 更新並畫出粒子
    for (let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i];
        p.vy += GRAVITY * p.weight;
        p.x += p.vx;
        p.y += p.vy;
        p.life--;
        p.alpha = map(p.life, 0, p.maxLife, 0, p.initAlpha);
        fill(red(p.col), green(p.col), blue(p.col), p.alpha);
        noStroke();
        circle(p.x, p.y, p.size);

        if (p.life <= 0) {
            // 通知所屬圓：一個粒子結束
            if (p.parentId != null) {
                let parent = circles.find(cc => cc.id === p.parentId);
                if (parent) {
                    parent.pendingParticles = max(0, parent.pendingParticles - 1);
                    // 所有粒子結束，重生圓
                    if (parent.pendingParticles === 0 && parent.exploding) {
                        respawnCircle(parent);
                    }
                }
            }
            particles.splice(i, 1);
        }
    }
}

function respawnCircle(c) {
    c.exploding = false;
    c.x = random(width);
    c.y = height + c.r / 2 + random(20, 200);
    c.r = random(50, 200);
    c.color = color(random(COLORS));
    c.alpha = random(80, 255);
    c.speed = random(1, 5);
    c.pendingParticles = 0;
}

// 安排下一次自動爆破時間
function scheduleNextAutoExplosion() {
    nextAutoExplosion = millis() + random(AUTO_MIN_INTERVAL, AUTO_MAX_INTERVAL);
}

// 隨機選一或少數尚未爆破的圓來爆破（提高機率）
function triggerRandomExplosion() {
    let candidates = circles.filter(c => !c.exploding);
    if (candidates.length === 0) return;

    // 選一個隨機候選並爆破
    let c = random(candidates);
    explodeCircle(c);

    // 提高群體爆發機率到 0.65，並擴大同時爆破數量上限到 5
    if (random() < 0.65) {
        let others = candidates.filter(cc => cc.id !== c.id);
        shuffle(others, true);
        let toExplode = floor(random(1, min(5, others.length + 1)));
        for (let i = 0; i < toExplode; i++) {
            explodeCircle(others[i]);
        }
    }
}

function explodeCircle(c) {
    // 使用離線渲染的快取音檔播放（若尚未產生，會先用即時合成提供回饋，再播放快取檔）
    let dur = map(c.r, 50, 200, 0.6, 1.6);
    let intensity = map(c.r, 50, 200, 0.6, 1.2);
    let tone = map(c.r, 50, 200, 120, 220);

    ensureAudioContext();

    const key = getAudioCacheKey(dur, intensity, tone);
    if (audioDownloadCache[key] && audioDownloadCache[key].buffer) {
        // 立即播放快取檔
        playCachedBuffer(audioDownloadCache[key].buffer, 0, 1.0);
    } else {
        // 尚未產生或正在產生：先用即時合成快速回饋（避免無聲），然後播放快取檔或等候產生完成後播放
        playExplosionSoundLive(dur * 0.6, intensity * 0.9, tone); // 較短的即時回饋
        createAndGetExplosionBuffer(dur, intensity, tone).then(buf => {
            playCachedBuffer(buf, 0, 1.0);
        }).catch(err => {
            // 若離線渲染失敗，已用即時聲音回饋
            console.error('createAndGetExplosionBuffer failed:', err);
        });
    }

    // 原爆破粒子邏輯（不變）
    c.exploding = true;
    let count = floor(map(c.r, 50, 200, EXPLOSION_PARTICLES * 0.6, EXPLOSION_PARTICLES * 1.6));
    count = constrain(count, 8, 180);
    c.pendingParticles = count;

    let baseR = red(c.color), baseG = green(c.color), baseB = blue(c.color);
    for (let i = 0; i < count; i++) {
        let angle = random(TWO_PI);
        let speed = random(1, 6) * (0.8 + random());
        let vx = cos(angle) * speed + (c.speed * 0.2);
        let vy = sin(angle) * speed;
        let size = random(c.r * 0.03, c.r * 0.15);
        let life = floor(random(30, 90));
        let pcol = color(baseR + random(-20, 20), baseG + random(-20, 20), baseB + random(-20, 20));
        particles.push({
            x: c.x + cos(angle) * random(0, c.r / 4),
            y: c.y + sin(angle) * random(0, c.r / 4),
            vx: vx,
            vy: vy,
            weight: random(0.8, 1.8),
            size: size,
            col: pcol,
            life: life,
            maxLife: life,
            initAlpha: random(150, 255),
            alpha: 255,
            parentId: c.id
        });
    }
}

function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
    for (let c of circles) {
        c.x = random(width);
        c.y = random(height);
    }
}

// 播放已快取的 AudioBuffer
function playCachedBuffer(buffer, when = 0, gainValue = 1.0) {
    if (!buffer) return;
    ensureAudioContext();

    const startPlay = () => {
        const src = audioCtx.createBufferSource();
        src.buffer = buffer;
        const g = audioCtx.createGain();
        // 使用較保守的增益乘數，避免音量過大
        g.gain.setValueAtTime(gainValue * 0.6, audioCtx.currentTime + when);
        src.connect(g);
        g.connect(audioCtx.destination);
        try {
            src.start(audioCtx.currentTime + when);
        } catch (e) {
            console.warn('playCachedBuffer start failed:', e);
        }
    };

    if (audioCtx.state === 'suspended') {
        audioCtx.resume().then(startPlay).catch(err => {
            console.warn('AudioContext resume failed or blocked:', err);
        });
    } else {
        startPlay();
    }
}

// 嘗試在使用者互動時啟動 AudioContext（避免瀏覽器阻擋）
// 改寫 mousePressed 為「解鎖音訊 + 點擊圓觸發爆破与計分」
function mousePressed() {
    ensureAudioContext();
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
    }

    // 檢查是否點到圓（優先第一個命中的圓）
    for (let c of circles) {
        if (!c.exploding) {
            let d = dist(mouseX, mouseY, c.x, c.y);
            if (d <= c.r / 2) {
                // 計分：點到 #cdb4db 加一分，其他顏色減一分
                let hex = getHexFromColor(c.color);
                if (hex === '#cdb4db') score += 1;
                else score -= 1;

                // 觸發該圓爆破
                explodeCircle(c);
                break; // 只處理一個圓
            }
        }
    }
}
function touchStarted() {
    // 同 mousePressed 行為（觸控）
    ensureAudioContext();
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
    }

    for (let c of circles) {
        if (!c.exploding) {
            let d = dist(touchX || mouseX, touchY || mouseY, c.x, c.y);
            if (d <= c.r / 2) {
                let hex = getHexFromColor(c.color);
                if (hex === '#cdb4db') score += 1;
                else score -= 1;
                explodeCircle(c);
                break;
            }
        }
    }
}