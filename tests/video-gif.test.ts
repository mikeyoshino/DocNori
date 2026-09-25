import test from "node:test";
import assert from "node:assert/strict";
import {
  validateVideo,
  settings,
} from "../src/SabuySign.Web/Client/video-gif/settings";
test("video limits reject oversized, invalid and overly long input", () => {
  assert.throws(() => validateVideo(200000001, 10, 1920, 1080));
  assert.throws(() => validateVideo(1, Infinity, 1920, 1080));
  assert.throws(() => validateVideo(1, 3601, 3840, 2160));
  assert.doesNotThrow(() => validateVideo(200000000, 60, 1080, 1920));
});
test("GIF settings preserve portrait bounds and validate selected interval", () => {
  const s = settings(1, 6, 10, 1080, 1920, "medium", false);
  assert.deepEqual([s.width, s.height, s.fps, s.duration], [270, 480, 10, 5]);
  assert.throws(() => settings(0, 31, 40, 640, 480, "small", false));
  assert.throws(() => settings(-1, 3, 10, 640, 480, "small", false));
  assert.throws(() => settings(2, 1, 10, 640, 480, "small", false));
  assert.throws(() => settings(0, 11, 10, 640, 480, "small", false));
  assert.equal(settings(0, 1, 2, 100, 100, "large", true).width, 100);
});
