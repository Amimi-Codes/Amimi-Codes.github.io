// The quill cursor on the contact page's scroll. Only the quill pen and its studio shadow are
// taken from Amy's "Calligrapher's Quill" studio (its Royal Gold & Black finish); they are drawn
// once into a small canvas that becomes the cursor image, with the nib tip as the hotspot.
// Until this runs (or if it can't), shore.css falls back to assets/shore/quill-cursor.png.
(() => {
  function mulberry32(seed) {
    return function () {
      let t = (seed += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const p = {
    nibStops: ['#5c3a14', '#b8863b', '#f5d78e', '#fff4cc', '#c9933b', '#4d2e0c'],
    nibStroke: '#3b2208',
    engravingColor: 'rgba(62, 36, 9, 0.72)',
    engravingHighlight: 'rgba(255, 248, 214, 0.55)',
    collarStops: ['#121215', '#3b3c42', '#17171a', '#09090b'],
    trimRingStops: ['#734b1a', '#e6be6a', '#fff1bd', '#8c5c20'],
    barrelStops: ['#09090b', '#2b2d33', '#494c54', '#16171a', '#050507'],
    rachisStops: ['#382311', '#9c6f3e', '#d6a469', '#57371a'],
    featherBase: '#0b0c0e',
    featherMid: '#1c1e24',
    featherSheen: '#383d47',
    featherRim: 'rgba(235, 240, 250, 0.78)'
  };

  function getRachisY(x) {
    const norm = (x - 150) / 520;
    if (norm <= 0) return 0;
    return -Math.pow(norm, 1.38) * 46 + Math.sin(norm * Math.PI) * 8;
  }
  function getRachisSlope(x) {
    return (getRachisY(x + 1) - getRachisY(x - 1)) / 2;
  }

  const featherGeometry = (function buildProceduralFeatherData() {
    const rand = mulberry32(84729);
    const barbs = [], downyFibers = [];
    const startX = 152, endX = 668, totalBarbs = 295;
    const upperSplits = [0.22, 0.38, 0.56, 0.73, 0.86];
    const lowerSplits = [0.18, 0.34, 0.51, 0.69, 0.83, 0.91];
    for (let i = 0; i < totalBarbs; i++) {
      const t = i / (totalBarbs - 1);
      const x = startX + t * (endX - startX);
      const env = Math.sin(Math.pow(t, 0.72) * Math.PI);
      const tipTaper = Math.pow(1 - t, 0.35);
      let upperLen = (14 + 62 * env * tipTaper) * (0.94 + rand() * 0.12);
      let upperAngleOffset = 0;
      for (const sp of upperSplits) {
        const dist = t - sp;
        if (Math.abs(dist) < 0.022) {
          upperAngleOffset += dist > 0 ? 0.085 : -0.065;
          if (Math.abs(dist) < 0.006) upperLen *= 0.68;
        }
      }
      let lowerLen = (16 + 76 * Math.sin(Math.pow(t, 0.68) * Math.PI) * tipTaper) * (0.94 + rand() * 0.12);
      let lowerAngleOffset = 0;
      for (const sp of lowerSplits) {
        const dist = t - sp;
        if (Math.abs(dist) < 0.025) {
          lowerAngleOffset += dist > 0 ? -0.09 : 0.075;
          if (Math.abs(dist) < 0.0065) lowerLen *= 0.64;
        }
      }
      barbs.push({
        t, x, shaftY: getRachisY(x), slope: getRachisSlope(x), upperLen, lowerLen, upperAngleOffset, lowerAngleOffset,
        shadeVariant: rand(), thickness: 0.85 + rand() * 0.75, curveBend: 0.25 + t * 0.22 + (rand() - 0.5) * 0.06, isHighlightBarb: rand() > 0.84
      });
    }
    for (let i = 0; i < 38; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const baseX = startX + 2 + rand() * 34;
      const angle = side * (0.65 + rand() * 0.75);
      downyFibers.push({
        baseX, baseY: getRachisY(baseX), len: 14 + rand() * 24, angle, ctrlAngle: angle + (rand() - 0.5) * 0.5,
        alpha: 0.35 + rand() * 0.45, width: 0.45 + rand() * 0.5
      });
    }
    return { barbs, downyFibers, startX, endX };
  })();

  function drawQuillPen(c, light) {
    c.save();
    renderFeatherPlume(c, light);
    renderRachis(c, light);
    renderMetallicNib(c);
    renderGrippingBarrel(c, light);
    c.restore();
  }

  // the engraved metallic nib; its writing tip is at local (0, 0)
  function renderMetallicNib(c) {
    c.save();
    const nibGrad = c.createLinearGradient(0, -24, 105, 24);
    p.nibStops.forEach((col, idx) => nibGrad.addColorStop(idx / (p.nibStops.length - 1), col));
    c.beginPath();
    c.moveTo(0, 0);
    c.bezierCurveTo(22, -2.5, 42, -8, 62, -19.5);
    c.bezierCurveTo(72, -23.5, 82, -21, 90, -16.5);
    c.lineTo(118, -13.5);
    c.lineTo(118, 13.5);
    c.lineTo(90, 16.5);
    c.bezierCurveTo(82, 21, 72, 23.5, 62, 19.5);
    c.bezierCurveTo(42, 8, 22, 2.5, 0, 0);
    c.closePath();
    c.fillStyle = nibGrad;
    c.fill();
    c.lineWidth = 1.1;
    c.strokeStyle = p.nibStroke;
    c.stroke();

    c.save();
    c.clip();
    const upperBevel = c.createLinearGradient(15, -22, 65, -2);
    upperBevel.addColorStop(0, 'rgba(255,255,255,0.45)');
    upperBevel.addColorStop(0.5, 'rgba(255,255,255,0.08)');
    upperBevel.addColorStop(1, 'rgba(0,0,0,0.22)');
    c.fillStyle = upperBevel;
    c.fillRect(0, -25, 120, 25);
    const lowerBevel = c.createLinearGradient(15, 2, 65, 22);
    lowerBevel.addColorStop(0, 'rgba(0,0,0,0.18)');
    lowerBevel.addColorStop(0.55, 'rgba(255,255,255,0.28)');
    lowerBevel.addColorStop(1, 'rgba(0,0,0,0.45)');
    c.fillStyle = lowerBevel;
    c.fillRect(0, 0, 120, 25);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(18, -1.6);
    c.bezierCurveTo(38, -5.5, 55, -12, 66, -16.2);
    c.bezierCurveTo(75, -18.5, 84, -15.5, 92, -13);
    c.strokeStyle = p.engravingColor;
    c.lineWidth = 0.85;
    c.stroke();
    c.beginPath();
    c.moveTo(18, 1.6);
    c.bezierCurveTo(38, 5.5, 55, 12, 66, 16.2);
    c.bezierCurveTo(75, 18.5, 84, 15.5, 92, 13);
    c.stroke();
    [-1, 1].forEach((dir) => {
      c.beginPath();
      c.moveTo(46, dir * 5.2);
      c.bezierCurveTo(54, dir * 11, 66, dir * 14, 71, dir * 9.5);
      c.bezierCurveTo(75, dir * 5.8, 66, dir * 4.2, 63, dir * 8.2);
      c.bezierCurveTo(61, dir * 11.2, 74, dir * 15, 84, dir * 10.5);
      c.strokeStyle = p.engravingHighlight;
      c.lineWidth = 1.0;
      c.stroke();
      c.strokeStyle = p.engravingColor;
      c.lineWidth = 0.75;
      c.stroke();
      c.beginPath();
      c.arc(82, dir * 7.5, 3.6, 0, Math.PI * 1.65);
      c.stroke();
    });
    c.beginPath();
    c.ellipse(95, 0, 6.5, 9.5, 0, 0, Math.PI * 2);
    c.strokeStyle = p.engravingColor;
    c.lineWidth = 0.8;
    c.stroke();
    c.restore();

    c.beginPath();
    c.moveTo(42.5, 0);
    c.bezierCurveTo(42.5, -3.4, 47.5, -4.4, 49.2, -1.5);
    c.bezierCurveTo(50.5, -0.3, 51.5, 0, 51.5, 0);
    c.bezierCurveTo(51.5, 0, 50.5, 0.3, 49.2, 1.5);
    c.bezierCurveTo(47.5, 4.4, 42.5, 3.4, 42.5, 0);
    c.closePath();
    c.fillStyle = '#111114';
    c.fill();
    c.lineWidth = 0.7;
    c.strokeStyle = p.engravingHighlight;
    c.stroke();
    c.beginPath();
    c.moveTo(0.8, 0);
    c.lineTo(42.5, 0);
    c.strokeStyle = '#0e0e11';
    c.lineWidth = 0.85;
    c.stroke();
    const tipGrad = c.createRadialGradient(2.2, -0.6, 0.2, 2.2, 0, 2.8);
    tipGrad.addColorStop(0, '#ffffff');
    tipGrad.addColorStop(0.6, p.nibStops[2]);
    tipGrad.addColorStop(1, p.nibStroke);
    c.beginPath();
    c.arc(2.2, 0, 2.1, 0, Math.PI * 2);
    c.fillStyle = tipGrad;
    c.fill();
    c.restore();
  }

  // the black lacquered gripping barrel and its turned collars
  function renderGrippingBarrel(c, light) {
    c.save();
    const nibShadow = c.createLinearGradient(98, 0, 108, 0);
    nibShadow.addColorStop(0, 'rgba(0,0,0,0)');
    nibShadow.addColorStop(1, 'rgba(0,0,0,0.65)');
    c.fillStyle = nibShadow;
    c.fillRect(98, -14, 10, 28);
    const bodyGrad = c.createLinearGradient(0, -21, 0, 21);
    p.barrelStops.forEach((col, i) => bodyGrad.addColorStop(i / (p.barrelStops.length - 1), col));
    c.beginPath();
    c.moveTo(120, -16.5);
    c.bezierCurveTo(148, -14.2, 198, -16.2, 232, -19.5);
    c.lineTo(232, 19.5);
    c.bezierCurveTo(198, 16.2, 148, 14.2, 120, 16.5);
    c.closePath();
    c.fillStyle = bodyGrad;
    c.fill();
    const glossGrad = c.createLinearGradient(120, -9, 232, -11);
    glossGrad.addColorStop(0, 'rgba(255,255,255,0.12)');
    glossGrad.addColorStop(0.5, `rgba(255,255,255,${0.26 * light})`);
    glossGrad.addColorStop(1, 'rgba(255,255,255,0.14)');
    c.beginPath();
    c.moveTo(122, -9.5);
    c.bezierCurveTo(155, -8.2, 195, -9.5, 230, -11.5);
    c.lineTo(230, -7.2);
    c.bezierCurveTo(195, -5.5, 155, -4.5, 122, -5.8);
    c.closePath();
    c.fillStyle = glossGrad;
    c.fill();
    function drawTurnedRing(x, width, radiusY, stops) {
      const rg = c.createLinearGradient(0, -radiusY, 0, radiusY);
      stops.forEach((col, idx) => rg.addColorStop(idx / (stops.length - 1), col));
      c.beginPath();
      c.roundRect(x, -radiusY, width, radiusY * 2, width * 0.45);
      c.fillStyle = rg;
      c.fill();
      c.strokeStyle = 'rgba(0,0,0,0.65)';
      c.lineWidth = 0.8;
      c.stroke();
    }
    drawTurnedRing(105, 6.5, 16.8, p.collarStops);
    drawTurnedRing(111.5, 3.2, 15.6, p.trimRingStops);
    drawTurnedRing(114.5, 7.5, 18.2, p.collarStops);
    drawTurnedRing(229, 4.0, 20.2, p.trimRingStops);
    drawTurnedRing(233, 7.2, 22.4, p.collarStops);
    drawTurnedRing(240.2, 6.8, 22.8, p.collarStops);
    drawTurnedRing(247, 6.5, 21.8, p.collarStops);
    drawTurnedRing(253.5, 3.2, 19.5, p.trimRingStops);
    c.beginPath();
    c.ellipse(256.5, 0, 2.5, 17, 0, 0, Math.PI * 2);
    c.fillStyle = '#050507';
    c.fill();
    c.restore();
  }

  // the curved feather spine
  function renderRachis(c, light) {
    c.save();
    c.translate(104, 0);
    const { startX, endX } = featherGeometry;
    const steps = 90, topPts = [], botPts = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = startX + t * (endX - startX);
      const y = getRachisY(x);
      const angle = Math.atan(getRachisSlope(x));
      const nx = -Math.sin(angle), ny = Math.cos(angle);
      const halfThick = 3.4 * Math.pow(1 - t, 0.78) + 0.2;
      topPts.push({ x: x + nx * halfThick, y: y + ny * halfThick });
      botPts.push({ x: x - nx * halfThick, y: y - ny * halfThick });
    }
    c.beginPath();
    c.moveTo(topPts[0].x, topPts[0].y);
    for (let i = 1; i < topPts.length; i++) c.lineTo(topPts[i].x, topPts[i].y);
    for (let i = botPts.length - 1; i >= 0; i--) c.lineTo(botPts[i].x, botPts[i].y);
    c.closePath();
    const rachisGrad = c.createLinearGradient(startX, 0, endX, -45);
    p.rachisStops.forEach((col, idx) => rachisGrad.addColorStop(idx / (p.rachisStops.length - 1), col));
    c.fillStyle = rachisGrad;
    c.fill();
    c.beginPath();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = startX + t * (endX - startX);
      const y = getRachisY(x) - 0.6 * (1 - t);
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.strokeStyle = `rgba(255, 245, 225, ${0.48 * light})`;
    c.lineWidth = 1.15;
    c.stroke();
    c.restore();
  }

  // the feather: hundreds of barbs with sheen and rim light, and downy fibres at the base
  function renderFeatherPlume(c, light) {
    c.save();
    c.translate(104, 0);
    c.beginPath();
    const first = featherGeometry.barbs[0];
    c.moveTo(first.x, first.shaftY);
    for (let i = 0; i < featherGeometry.barbs.length; i += 2) {
      const b = featherGeometry.barbs[i];
      const baseAngle = Math.atan(b.slope) - (0.58 - b.t * 0.24) + b.upperAngleOffset;
      c.lineTo(b.x + Math.cos(baseAngle) * (b.upperLen * 0.94), b.shaftY + Math.sin(baseAngle) * (b.upperLen * 0.94));
    }
    for (let i = featherGeometry.barbs.length - 1; i >= 0; i -= 2) {
      const b = featherGeometry.barbs[i];
      const baseAngle = Math.atan(b.slope) + (0.62 - b.t * 0.25) + b.lowerAngleOffset;
      c.lineTo(b.x + Math.cos(baseAngle) * (b.lowerLen * 0.94), b.shaftY + Math.sin(baseAngle) * (b.lowerLen * 0.94));
    }
    c.closePath();
    c.fillStyle = p.featherBase;
    c.fill();

    c.lineCap = 'round';
    for (const f of featherGeometry.downyFibers) {
      c.beginPath();
      c.moveTo(f.baseX, f.baseY);
      c.quadraticCurveTo(f.baseX + Math.cos(f.ctrlAngle) * (f.len * 0.55), f.baseY + Math.sin(f.ctrlAngle) * (f.len * 0.55), f.baseX + Math.cos(f.angle) * f.len, f.baseY + Math.sin(f.angle) * f.len);
      c.strokeStyle = `rgba(38, 41, 48, ${f.alpha})`;
      c.lineWidth = f.width;
      c.stroke();
    }

    for (const b of featherGeometry.barbs) {
      const shaftAngle = Math.atan(b.slope);
      const uAngle = shaftAngle - (0.62 - b.t * 0.28) + b.upperAngleOffset;
      const uEndX = b.x + Math.cos(uAngle) * b.upperLen, uEndY = b.shaftY + Math.sin(uAngle) * b.upperLen;
      const uGrad = c.createLinearGradient(b.x, b.shaftY, uEndX, uEndY);
      uGrad.addColorStop(0, p.featherBase);
      uGrad.addColorStop(0.45, b.isHighlightBarb ? p.featherSheen : p.featherMid);
      uGrad.addColorStop(0.82, p.featherBase);
      uGrad.addColorStop(1, light > 0.35 ? p.featherRim : p.featherMid);
      c.beginPath();
      c.moveTo(b.x, b.shaftY);
      c.quadraticCurveTo(b.x + Math.cos(uAngle - b.curveBend) * (b.upperLen * 0.52), b.shaftY + Math.sin(uAngle - b.curveBend) * (b.upperLen * 0.52), uEndX, uEndY);
      c.strokeStyle = uGrad;
      c.lineWidth = b.thickness * 1.35;
      c.stroke();

      const lAngle = shaftAngle + (0.66 - b.t * 0.29) + b.lowerAngleOffset;
      const lEndX = b.x + Math.cos(lAngle) * b.lowerLen, lEndY = b.shaftY + Math.sin(lAngle) * b.lowerLen;
      const lGrad = c.createLinearGradient(b.x, b.shaftY, lEndX, lEndY);
      lGrad.addColorStop(0, p.featherBase);
      lGrad.addColorStop(0.38, p.featherMid);
      lGrad.addColorStop(0.68, b.isHighlightBarb ? p.featherSheen : p.featherMid);
      lGrad.addColorStop(0.92, p.featherBase);
      lGrad.addColorStop(1, light > 0.45 ? `rgba(220, 228, 240, ${0.42 * light})` : p.featherBase);
      c.beginPath();
      c.moveTo(b.x, b.shaftY);
      c.quadraticCurveTo(b.x + Math.cos(lAngle + b.curveBend) * (b.lowerLen * 0.52), b.shaftY + Math.sin(lAngle + b.curveBend) * (b.lowerLen * 0.52), lEndX, lEndY);
      c.strokeStyle = lGrad;
      c.lineWidth = b.thickness * 1.45;
      c.stroke();
    }

    c.save();
    c.globalCompositeOperation = 'screen';
    for (const bandT of [0.28, 0.54, 0.78]) {
      const bx = featherGeometry.startX + bandT * (featherGeometry.endX - featherGeometry.startX);
      const by = getRachisY(bx);
      const sheenRad = c.createRadialGradient(bx + 18, by - 14, 4, bx + 18, by - 14, 72);
      sheenRad.addColorStop(0, `rgba(185, 200, 225, ${0.14 * light})`);
      sheenRad.addColorStop(1, 'rgba(185, 200, 225, 0)');
      c.fillStyle = sheenRad;
      c.beginPath();
      c.arc(bx + 18, by - 14, 72, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
    c.restore();
  }

  // ---- the cursor: the quill and its studio shadow, nib down at the bottom left ----
  const SIZE = 120;                       // cursor image size in CSS pixels
  const ANGLE = (-52 * Math.PI) / 180;    // writing angle
  const SCALE = 0.17;                     // the quill is ~772 units long
  const TIP = { x: 5, y: SIZE - 6 };      // where the nib tip lands: the cursor's hotspot
  try {
    const dpr = 1; // cursor images are drawn at CSS pixels
    const cv = document.createElement('canvas');
    cv.width = cv.height = SIZE * dpr;
    const c = cv.getContext('2d');
    if (!c || !c.roundRect) return;
    c.scale(dpr, dpr);
    c.translate(TIP.x, TIP.y);
    c.rotate(ANGLE);
    c.scale(SCALE, SCALE);
    // Soft contact & ambient studio shadow
    c.save();
    c.translate(16, 28);
    c.filter = `blur(${(14 * SCALE).toFixed(1)}px)`;
    c.globalAlpha = 0.24;
    drawQuillPen(c, 0.05);
    c.restore();
    // the quill
    drawQuillPen(c, 0.75);
    const url = cv.toDataURL('image/png');
    document.documentElement.style.setProperty('--quill-cursor', `url("${url}") ${TIP.x} ${TIP.y}, text`);
  } catch (e) {
    /* keep the PNG fallback */
  }
})();
