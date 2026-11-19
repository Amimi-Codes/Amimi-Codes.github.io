// Rising bubbles on a full-screen canvas, for the trip from the crossroads to the surface.
// One bubble is drawn once and stamped at different sizes, so hundreds stay cheap.
// riseBubbles({ spawnMs, totalMs, rate }) -> the canvas (removed when done)
//   spawnMs: how long new bubbles keep coming from below; totalMs: when to stop drawing
//   rate: bubbles per second at the start (it ramps up 3x while spawning)
// prefill: true starts with bubbles already spread over the screen (the arrival side)
window.riseBubbles = function ({ spawnMs = 900, totalMs = 1400, rate = 120, prefill = false } = {}) {
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;z-index:1000;pointer-events:none";
  document.body.append(canvas);
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const W = innerWidth, H = innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);

  // the bubble sprite: clear middle, bright rim, a highlight up and to the left
  const S = 128, sprite = document.createElement("canvas");
  sprite.width = sprite.height = S;
  const g = sprite.getContext("2d");
  const body = g.createRadialGradient(S / 2, S / 2, S * 0.2, S / 2, S / 2, S / 2);
  body.addColorStop(0, "rgba(180,250,255,0.04)");
  body.addColorStop(0.75, "rgba(160,240,250,0.16)");
  body.addColorStop(0.93, "rgba(220,255,255,0.75)");
  body.addColorStop(1, "rgba(220,255,255,0)");
  g.fillStyle = body;
  g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); g.fill();
  g.fillStyle = "rgba(255,255,255,0.9)";
  g.beginPath(); g.ellipse(S * 0.34, S * 0.3, S * 0.12, S * 0.07, -0.6, 0, Math.PI * 2); g.fill();

  const bubbles = [];
  const add = (y) => {
    const r = 3 + Math.pow(Math.random(), 2.2) * 42;
    bubbles.push({ x: Math.random() * W, y, r, vy: 380 + Math.random() * 520 + r * 9, wob: Math.random() * 6.28, amp: 4 + Math.random() * 14 });
  };
  if (prefill) for (let i = 0; i < 160; i++) add(Math.random() * H * 1.1);

  const start = performance.now();
  let last = start, owed = 0;
  (function tick(now) {
    const t = now - start, dt = Math.min(now - last, 50) / 1000;
    last = now;
    if (t < spawnMs) {
      owed += rate * (1 + 2 * (t / spawnMs)) * dt;
      for (; owed >= 1; owed--) add(H + 50 + Math.random() * 80);
    }
    ctx.clearRect(0, 0, W, H);
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      b.y -= b.vy * dt;
      if (b.y < -b.r * 2) { bubbles.splice(i, 1); continue; }
      const x = b.x + Math.sin(b.wob + t * 0.006) * b.amp;
      ctx.drawImage(sprite, x - b.r, b.y - b.r, b.r * 2, b.r * 2);
    }
    if (t < totalMs && (t < spawnMs || bubbles.length)) requestAnimationFrame(tick);
    else canvas.remove();
  })(start);
  return canvas;
};

// Arriving from the crossroads (home.html sets the class): the last bubbles clear upwards.
if (document.documentElement.classList.contains("arrive-surface")) {
  window.riseBubbles({ spawnMs: 250, totalMs: 1500, rate: 60, prefill: true });
}
