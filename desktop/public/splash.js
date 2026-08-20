// The splash's behaviour, in a file of its own.
//
// It used to be an inline <script>, which worked in development and did nothing
// at all in a packaged build: production applies a Content-Security-Policy of
// `default-src 'self'`, and that blocks inline scripts. The splash sat there
// showing its first frame -- "Starting...", no version, no steps -- with no
// error anywhere the user would see.
//
// It listens to the same events the window does, through the runtime it
// imports for itself.
const { Events, Call, Flags } = await import('/wails/runtime.js');

// The bootstrap, in order. Only one is ever shown at a time -- a list of
  // five ticks is a progress bar with extra steps, and this reads as calmer.
  const STEPS = [
    ['agent', 'Starting the agent'],
    ['brew', 'Checking Homebrew'],
    ['cli', 'Checking the container CLI'],
    ['services', 'Checking container services'],
    ['ui', 'Loading your containers'],
  ];

  const labels = new Map(STEPS);
  const done = new Set();

  const now = document.getElementById('now');
  const count = document.getElementById('count');
  const bar = document.getElementById('bar');

  const setup = document.getElementById('setup');
  const setupTitle = document.getElementById('setup-title');
  const setupLine = document.getElementById('setup-line');

  const version = new URLSearchParams(location.search).get('version');
  const badge = document.getElementById('version');
  if (version && badge) badge.textContent = `v${version}`;

  Events.On('splash:step', ({ data: { id, state, label } }) => {
    if (!labels.has(id)) return;

    if (state === 'done') done.add(id);
    if (label) labels.set(id, label);

    // Failed steps keep their message on screen; the app opens anyway and
    // says more there than a splash line can.
    now.textContent = labels.get(id);
    count.textContent = `${Math.min(done.size + (state === 'done' ? 0 : 1), STEPS.length)} of ${STEPS.length}`;
    bar.style.width = `${(done.size / STEPS.length) * 100}%`;
  });

  Events.On('splash:setup', ({ data: { title, line, done: finished } }) => {
    setup.classList.toggle('on', !finished);
    if (title) setupTitle.textContent = title;
    if (line) setupLine.textContent = line;
  });

  Events.On('splash:fatal', ({ data: { title, detail } }) => {
    document.body.dataset.fatal = 'true';
    document.getElementById('fatal-title').textContent = title;
    document.getElementById('fatal-detail').textContent = detail;
  });

  document.getElementById('quit').addEventListener('click', () => {
    void Call.ByName(Flags.GetFlag('bridge') + '.Quit');
  });
