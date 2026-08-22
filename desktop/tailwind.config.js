/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Brand palette: the red of the Indonesian flag. Paired with the white
        // background it gives the app the merah-putih identity.
        brand: {
          50: '#fdecee',
          100: '#fad9dd',
          200: '#f6d2d6',
          400: '#e4606b',
          500: '#d92038',
          600: '#c21322',
          700: '#a50f1c',
          800: '#7d0a17',
          900: '#5c0711',
          950: '#3d040b',
        },
        orange: {
          500: '#eb8b3d',
          600: '#e67e22',
          700: '#c26216',
        },
        emerald: {
          500: '#3aa96a',
          600: '#2c8c52',
          700: '#237042',
        },
        amber: {
          500: '#b98200',
          600: '#9a6b00',
        },
        // Neutral greys, warm. The scale runs from the paper the content sits
        // on down to the near-black behind it, so light mode reads top-down and
        // dark mode reads bottom-up through the same values -- which is what
        // lets one set of classes dress both.
        //
        // The dark end stops short of the chrome's own black on purpose. It
        // used to end exactly there, and in dark mode that made the sidebar and
        // the page beside it the same colour: the frame and the picture ran
        // into each other with nothing to say where one stopped. Chrome is
        // darker than the ground it frames, and the ground is darker than the
        // panels on it, in both themes.
        ink: {
          50: '#fcfbfb',
          100: '#f7f6f5',
          150: '#eeebe9',
          200: '#e6e3e1',
          300: '#d6d1ce',
          400: '#a29c99',
          500: '#8b8683',
          600: '#6e6a67',
          700: '#4a4644',
          800: '#322d2f',
          900: '#262123',
          950: '#1e1a1c',
        },
        // The title bar and the sidebar. Near-black in both themes rather than
        // a shade of the ground: they are the frame the app is set in, and a
        // frame that changes colour with the picture stops being one.
        chrome: {
          bg: '#171416',
          raised: '#221d1f',
          line: '#332c2e',
          track: '#373033',
          text: '#f2efee',
          muted: '#cfc9c6',
          dim: '#9a9390',
          faint: '#6f6764',
        },
      },
      fontFamily: {
        // Plex over the system face: the interface is a table of measurements,
        // and Plex's figures are drawn to be read as numbers rather than as
        // text that happens to be numeric. System faces stay behind it for the
        // moment before the file loads.
        sans: [
          '"IBM Plex Sans Variable"',
          '"IBM Plex Sans"',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'sans-serif',
        ],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      // The type scale, which is the mockup's rather than Tailwind's. Its
      // steps fall between the default ones -- 11.5, 12.5, 13 where Tailwind
      // has 12 and 14 -- so they were being written as bracketed pixel values
      // at forty-odd call sites: a scale that existed only as a habit, and one
      // typo away from a forty-first size nobody meant to invent.
      //
      // Named for what each step is for rather than how big it is, so a change
      // of mind about a size is a change in one place and not a search for a
      // number.
      fontSize: {
        // The mono caps that label columns and sections: small enough to read
        // as a label rather than as a value, tracked out so it stays legible.
        micro: ['10.5px', { lineHeight: '14px', letterSpacing: '0.08em' }],
        tiny: ['11px', '16px'],
        // Mono values in a table or a rail: ids, digests, ports, versions.
        code: ['11.5px', '17px'],
        // Secondary text -- a muted cell, a tab, a filter, a back link.
        small: ['12.5px', '18px'],
        // What the app is read at: rows, subtitles, the text of a dialog.
        body: ['13px', '19px'],
        // A named thing: a nav entry, a card's title, a setting.
        item: ['13.5px', '20px'],
        // A dialog's heading.
        title: ['19px', { lineHeight: '1.25', letterSpacing: '-0.2px' }],
        // A page's heading.
        page: ['23px', { lineHeight: '1.2', letterSpacing: '-0.3px' }],
        // The one big number on a statistic.
        figure: ['27px', { lineHeight: '1', letterSpacing: '-0.5px' }],
      },
      boxShadow: {
        md: '0 4px 12px rgba(23, 20, 22, 0.08)',
        panel: '0 8px 32px rgba(23, 20, 22, 0.18)',
        window: '0 24px 60px rgba(20, 16, 16, 0.28)',
      },
      transitionDuration: {
        DEFAULT: '150ms',
      },
    },
  },
  plugins: [],
};
