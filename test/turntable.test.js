// Plattenspieler: Tonarm-Geometrie (Nadel landet auf dem gewünschten Radius).
import assert from 'node:assert/strict';
import { test } from 'node:test';

const { TT, armAngle } = await import('../client/src/scene/turntable.js');

const stylusAt = (psi) => ({
  x: TT.pivot.x + Math.sin(psi) * TT.arm.L,
  z: TT.pivot.z + Math.cos(psi) * TT.arm.L
});

test('Nadel steht auf dem gewünschten Radius über der Platte', () => {
  for (const r of [TT.vinyl.outer, 120, 90, TT.vinyl.inner, TT.cd.outer, TT.cd.inner]) {
    const s = stylusAt(armAngle(r));
    const dist = Math.hypot(s.x - TT.platter.x, s.z - TT.platter.z);
    assert.ok(Math.abs(dist - r) < 1e-6, `Radius ${r}: ${dist}`);
    assert.ok(s.z > TT.platter.z - 1, 'Nadel liegt auf der vorderen Seite');
  }
});

test('Arm schwenkt beim Abspielen gleichmäßig nach innen', () => {
  let prev = armAngle(TT.vinyl.outer);
  for (let r = TT.vinyl.outer - 5; r >= TT.vinyl.inner; r -= 5) {
    const psi = armAngle(r);
    assert.ok(psi < prev, `bei ${r} mm`);
    prev = psi;
  }
});

test('Ruheposition liegt neben dem Teller', () => {
  const s = stylusAt(TT.arm.rest);
  assert.ok(Math.hypot(s.x - TT.platter.x, s.z - TT.platter.z) > TT.platter.r + 10);
});
