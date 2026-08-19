//go:build !production

package main

// isPackaged is the equivalent of Electron's app.isPackaged, and it has to be
// decided at build time rather than guessed from the path.
//
// Guessing was wrong in a way that mattered: a bundle built locally to test
// lives in a .app just as the installed one does, so a path check called it
// packaged and pointed it at ~/.dermaga -- the socket the installed Dermaga is
// holding. The build under test then drove the installed app's agent, which is
// the exact confusion the separate development socket exists to prevent.
const isPackaged = false
