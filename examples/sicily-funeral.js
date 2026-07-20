(() => {
  // Winding country road: S-curve from background hill to foreground
  const WP = [[-11, -14], [-6, -9], [-4.5, -3], [-1, 2], [3, 5.5]];
  const segs = [];
  let total = 0;
  for (let i = 0; i < WP.length - 1; i++) {
    const [x0, z0] = WP[i], [x1, z1] = WP[i + 1];
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
    segs.push({ x0, z0, dx, dz, len, start: total, ry: (Math.atan2(dx, dz) * 180) / Math.PI });
    total += len;
  }
  const posAt = (s, lat = 0) => {
    s = Math.max(0, Math.min(s, total - 0.01));
    const g = segs.find((g) => s <= g.start + g.len) || segs[segs.length - 1];
    const f = (s - g.start) / g.len;
    const nx = g.dz / g.len, nz = -g.dx / g.len;
    return { x: g.x0 + g.dx * f + nx * lat, z: g.z0 + g.dz * f + nz * lat, ry: g.ry };
  };

  const D = 12, SPEED = 0.85; // somber funeral pace, m/s; priest reaches road's end at t=12
  const walker = (kind, color, s0, lat = 0, y = 0, scale = 1) => {
    const keys = [];
    for (let t = 0; t <= D; t += 3) {
      const p = posAt(s0 + SPEED * t, lat);
      keys.push({ t, pos: [+p.x.toFixed(2), y, +p.z.toFixed(2)], ry: +p.ry.toFixed(1), scale });
    }
    return { kind, color, ease: 'linear', keys };
  };
  const fixed = (kind, color, x, y, z, ry, scale) =>
    ({ kind, color, keys: [{ t: 0, pos: [x, y, z], ry, scale }] });

  const objects = [];

  // road bed (dusty strips along each bend)
  for (const g of segs) {
    objects.push(fixed('box', '#8a7f6a',
      +(g.x0 + g.dx / 2).toFixed(2), 0.02, +(g.z0 + g.dz / 2).toFixed(2),
      +g.ry.toFixed(1), [2.6, 0.04, +(g.len + 0.7).toFixed(2)]));
  }

  // the procession: priest leads, casket with two pallbearer pairs, mourners trail
  objects.push(walker('person', '#d8d3c8', 14.5));
  objects.push(walker('person', '#1e1e22', 12.6, 0.55));
  objects.push(walker('person', '#1e1e22', 12.6, -0.55));
  objects.push(walker('person', '#26262b', 11.7, 0.55));
  objects.push(walker('person', '#26262b', 11.7, -0.55));
  objects.push(walker('box', '#3a2f28', 12.15, 0, 1.15, [0.55, 0.4, 1.7])); // carried casket
  const mourners = ['#1e1e22', '#2a2530', '#26262b', '#232028', '#2d2a33', '#1b1b1f'];
  [10.2, 9.0, 7.7, 6.6, 5.2, 4.0].forEach((s, i) =>
    objects.push(walker('person', mourners[i], s, i % 2 ? -0.35 : 0.35)));

  // cypress trees lining the bends
  [[0.9, 2.4], [3.2, -2.6], [6.5, 2.5], [9.8, -2.4], [13.4, 2.6], [17.2, -2.5], [22, -2.6]]
    .forEach(([s, lat]) => {
      const p = posAt(s, lat);
      objects.push(fixed('cone', '#2f4a2f', +p.x.toFixed(2), 2.1, +p.z.toFixed(2), 0, [0.8, 3.5, 0.8]));
    });

  // low stone walls
  [[2, 1.9], [5, 1.9], [12, -1.9], [15, -1.9], [19.5, 1.9]].forEach(([s, lat]) => {
    const p = posAt(s, lat);
    objects.push(fixed('box', '#9a8f7d', +p.x.toFixed(2), 0.25, +p.z.toFixed(2), +p.ry.toFixed(1), [2.4, 0.5, 0.35]));
  });

  // chapel on the far hill
  objects.push(fixed('box', '#d8cdb8', -14.5, 1.25, -17.5, 15, [3, 2.5, 3]));
  objects.push(fixed('cone', '#a05a3c', -14.5, 3.4, -17.5, 15, [4.6, 1.5, 4.6]));

  // 1930s camera: locked tripod position, one slow stately pan following the
  // procession from the far bend to the foreground, deep-focus 36mm-ish fov,
  // only a breath of drift forward. No crane, no handheld.
  // positioned off to the side so the final bend reads in profile, not head-on
  const camera = { keys: [
    { t: 0,  pos: [10.8, 2.7, 4.8],  lookAt: [-7.5, 1, -9.5], fov: 36 },
    { t: 6,  pos: [10.6, 2.65, 4.8], lookAt: [-2.5, 1, -2],   fov: 36 },
    { t: 12, pos: [10.4, 2.6, 4.8],  lookAt: [1.5, 1, 4.8],   fov: 36 },
  ] };

  window.app.buildFromSpec({ duration: D, objects, camera });
  return 'built ' + objects.length + ' objects, road ' + total.toFixed(1) + 'm';
})()
