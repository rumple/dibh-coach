// Demo mode's simulated chest, so the app can be tried without a sensor. Pressing the button is a deep
// breath; with auto-breathe on, the chest also breathes in whenever breathingIn() says so, so no taps are needed.
const Demo = { held: false, v: 0, timer: null };
const demoBtn = document.getElementById('demoBtn');

export function startDemo({ feed, breathingIn }) {
  demoBtn.hidden = false;
  if (Demo.timer) return;
  Demo.timer = setInterval(() => {
    const t = performance.now() / 1000;
    const deep = Demo.held || breathingIn();
    Demo.v += ((deep ? 1 : 0) - Demo.v) * 0.05;
    const tidal = deep ? 0 : 0.12 * Math.sin((t * 2 * Math.PI) / 4.5);
    const chest = Demo.v + tidal + (Math.random() - 0.5) * 0.03;
    feed(...Core.demoTilt(chest), t);
  }, 16);
}
export function stopDemo() { clearInterval(Demo.timer); Demo.timer = null; Demo.held = false; demoBtn.hidden = true; }
const press = on => e => { e.preventDefault(); Demo.held = on; demoBtn.classList.toggle('held', on); };
demoBtn.addEventListener('pointerdown', press(true));
for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) demoBtn.addEventListener(ev, press(false));
